import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Text, useApp, useInput, useStdin, useStdout, type Key } from 'ink';
import { formatCost, formatTokens, type UsageAggregate } from '@larecode/core';
import { getTheme, type Theme, type ThemeName } from './theme.js';
import { emptyInput, handleInput, type InputState, type KeyEvent } from './input.js';
import { COMMANDS, filterCommands } from './palette.js';
import { appendChunk, type ChatMessage } from './messages.js';

export interface PermissionPrompt {
  tool: string;
  group: string;
  detail?: string;
}

export type PermissionConfirm = (request: PermissionPrompt) => Promise<boolean>;

export interface ModelCatalog {
  provider: string;
  models: string[];
}

export interface AppProps {
  provider?: string;
  model?: string;
  catalogs?: ModelCatalog[];
  onSelectModel?: (provider: string, model: string) => void;
  theme?: ThemeName;
  version?: string;
  initialMessages?: ChatMessage[];
  getUsage?: () => UsageAggregate;
  onClear?: () => void;
  runTurn?: (
    prompt: string,
    onChunk: (chunk: string) => void,
    signal: AbortSignal,
    agent: 'plan' | 'build',
    confirm?: PermissionConfirm
  ) => Promise<void>;
  runSubagentTurn?: (
    prompt: string,
    onChunk: (chunk: string) => void,
    signal: AbortSignal
  ) => Promise<void>;
}

export const HELP_TEXT =
  'enter send · ctrl+j newline · esc stop · tab agent · @general subagent · / commands · ctrl+c quit';

const GENERAL_PREFIX = /^@general\b\s*([\s\S]*)$/;
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const HOME_KEYS = new Set(['\x1b[H', '\x1bOH', '\x1b[1~', '\x1b[7~']);
const END_KEYS = new Set(['\x1b[F', '\x1bOF', '\x1b[4~', '\x1b[8~']);
const PLACEHOLDERS = [
  'Fix a TODO in the codebase',
  'What is the tech stack of this project?',
  'Fix broken tests',
];

const LOGO_LEFT = [
  '█    █▀▀█ █▀▀▄ █▀▀▀',
  '█    █▀▀█ █▀▀▄ █▀▀ ',
  '█    █  █ █  █ █▄▄ ',
  '▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀',
];
const LOGO_RIGHT = [
  '█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀',
  '█    █  █ █  █ █▀▀ ',
  '█▄▄▄ █▄▄█ █▄▄▀ █▄▄ ',
  '▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀',
];

interface PendingPermission {
  request: PermissionPrompt;
  resolve: (approved: boolean) => void;
}

type PopupState =
  { kind: 'model'; index: number } | { kind: 'theme'; index: number } | { kind: 'help' };

const THEME_CHOICES: ThemeName[] = ['dark', 'light'];

export function App({
  provider: initialProvider,
  model = 'no model',
  catalogs = [],
  onSelectModel,
  theme: initialTheme = 'dark',
  version = '0.1.1',
  initialMessages = [],
  getUsage,
  onClear,
  runTurn,
  runSubagentTurn,
}: AppProps) {
  const { exit } = useApp();
  const { internal_eventEmitter } = useStdin();
  const { stdout } = useStdout();
  const rawInput = useRef('');
  const inputHandlerRef = useRef<(raw: string, key: Key) => void>(() => {});
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [usage, setUsage] = useState<UsageAggregate | null>(null);
  const [input, setInput] = useState<InputState>(emptyInput());
  const inputRef = useRef(input);
  const [agent, setAgent] = useState<'plan' | 'build'>('plan');
  const [currentProvider, setCurrentProvider] = useState(initialProvider);
  const [currentModel, setCurrentModel] = useState(model);
  const [themeName, setThemeName] = useState<ThemeName>(initialTheme);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [frame, setFrame] = useState(0);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const updateInput = (next: InputState): void => {
    inputRef.current = next;
    setInput(next);
  };

  useEffect(() => {
    const record = (chunk: string): void => {
      rawInput.current = chunk;
    };
    internal_eventEmitter.on('input', record);
    return () => {
      internal_eventEmitter.removeListener('input', record);
    };
  }, [internal_eventEmitter]);

  const theme = getTheme(themeName);
  const home = messages.length === 0;
  const agentLabel = agent === 'plan' ? 'Plan' : 'Build';
  const columns = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;
  const promptWidth = home ? Math.min(75, Math.max(20, columns - 4)) : columns;
  const popupWidth = Math.min(60, Math.max(24, columns - 8));
  const popupLimit = Math.max(4, Math.min(10, rows - 12));
  const palette = !popup && paletteOpen(input.text) ? filterCommands(input.text) : [];
  const selected = Math.min(paletteIndex, Math.max(0, palette.length - 1));
  const modelChoices = catalogs.flatMap((catalog) =>
    catalog.models.map((entry) => ({ provider: catalog.provider, model: entry }))
  );
  const usageLabel =
    usage && usage.totalTokens.total > 0
      ? `${formatTokens(usage.totalTokens.total)} tok · ${formatCost(usage.totalCost.totalCost)}`
      : undefined;

  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setFrame((current) => current + 1), 80);
    return () => clearInterval(timer);
  }, [streaming]);

  const addNote = (text: string): void => {
    setMessages((current) => [...current, { role: 'note', text }]);
  };

  const runCommand = (raw: string): void => {
    const [name, ...args] = raw.trim().split(/\s+/);
    switch (name) {
      case '/help':
        setPopup({ kind: 'help' });
        break;
      case '/clear':
        setMessages([]);
        onClear?.();
        break;
      case '/theme': {
        const next = args[0]?.toLowerCase();
        if (next === 'dark' || next === 'light') {
          setThemeName(next);
          break;
        }
        setPopup({ kind: 'theme', index: THEME_CHOICES.indexOf(themeName) });
        break;
      }
      case '/model': {
        if (args.length === 0) {
          if (modelChoices.length === 0) {
            addNote('no models configured');
            break;
          }
          const index = modelChoices.findIndex(
            (choice) => choice.provider === currentProvider && choice.model === currentModel
          );
          setPopup({ kind: 'model', index: Math.max(0, index) });
          break;
        }
        const nextProvider = args.length > 1 ? args[0] : currentProvider;
        const nextModel = args.length > 1 ? args.slice(1).join(' ') : args[0];
        if (!nextProvider) {
          addNote('usage: /model <provider> <model>');
          break;
        }
        if (!onSelectModel) {
          addNote('no model switcher connected');
          break;
        }
        try {
          onSelectModel(nextProvider, nextModel);
          setCurrentProvider(nextProvider);
          setCurrentModel(nextModel);
          addNote(`model → ${nextProvider}/${nextModel}`);
        } catch (error) {
          addNote(`error: ${error instanceof Error ? error.message : String(error)}`);
        }
        break;
      }
      case '/exit':
        exit();
        break;
      default:
        addNote(`unknown command: ${name}`);
    }
  };

  const confirmPermission = (request: PermissionPrompt): Promise<boolean> =>
    new Promise((resolve) => setPermission({ request, resolve }));

  const streamTurn = async (
    invoke: (
      prompt: string,
      onChunk: (chunk: string) => void,
      signal: AbortSignal
    ) => Promise<void>,
    prompt: string
  ): Promise<void> => {
    setMessages((current) => [...current, { role: 'agent', text: '' }]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await invoke(
        prompt,
        (chunk) => setMessages((current) => appendChunk(current, chunk)),
        controller.signal
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        addNote(`error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      if (getUsage) setUsage(getUsage());
    }
  };

  const submit = async (value: string): Promise<void> => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    updateInput(emptyInput());
    setPaletteIndex(0);

    if (trimmed.startsWith('/')) {
      runCommand(trimmed);
      return;
    }
    if (streaming) return;

    setMessages((current) => [...current, { role: 'user', text: trimmed }]);

    const general = GENERAL_PREFIX.exec(trimmed);
    if (general) {
      const prompt = general[1].trim();
      if (!prompt) {
        addNote('@general needs a prompt');
        return;
      }
      if (!runSubagentTurn) {
        addNote('no subagent connected');
        return;
      }
      await streamTurn((next, onChunk, signal) => runSubagentTurn(next, onChunk, signal), prompt);
      return;
    }

    if (!runTurn) {
      addNote('no agent connected');
      return;
    }
    await streamTurn(
      (next, onChunk, signal) => runTurn(next, onChunk, signal, agent, confirmPermission),
      trimmed
    );
  };

  const handleKey = (raw: string, key: Key): void => {
    const terminalBackspace =
      key.delete && (rawInput.current === '\x7f' || rawInput.current === '\x1b\x7f');
    const keyFlags = terminalBackspace
      ? { ...key, backspace: true, delete: false }
      : HOME_KEYS.has(rawInput.current)
        ? { ...key, home: true }
        : END_KEYS.has(rawInput.current)
          ? { ...key, end: true }
          : key;
    const event: KeyEvent = { input: raw, key: keyFlags };

    if (permission) {
      const answer = raw.toLowerCase();
      if (answer === 'y') {
        permission.resolve(true);
        setPermission(null);
      } else if (answer === 'n' || key.escape || (key.ctrl && raw === 'c')) {
        permission.resolve(false);
        setPermission(null);
      }
      return;
    }

    if (popup) {
      if (key.ctrl && raw === 'c') {
        exit();
        return;
      }
      if (key.escape) {
        setPopup(null);
        return;
      }
      if (popup.kind === 'help') {
        if (key.return) setPopup(null);
        return;
      }
      const count = popup.kind === 'model' ? modelChoices.length : THEME_CHOICES.length;
      if (key.upArrow) {
        setPopup({ ...popup, index: Math.max(0, popup.index - 1) });
        return;
      }
      if (key.downArrow) {
        setPopup({ ...popup, index: Math.min(count - 1, popup.index + 1) });
        return;
      }
      if (key.return) {
        if (popup.kind === 'model') {
          const choice = modelChoices[popup.index];
          if (choice) {
            try {
              onSelectModel?.(choice.provider, choice.model);
              setCurrentProvider(choice.provider);
              setCurrentModel(choice.model);
            } catch (error) {
              addNote(`error: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } else {
          setThemeName(THEME_CHOICES[popup.index] ?? themeName);
        }
        setPopup(null);
        return;
      }
      return;
    }

    if (key.escape && palette.length > 0) {
      updateInput(emptyInput());
      setPaletteIndex(0);
      return;
    }

    if (key.escape || (key.ctrl && raw === 'c')) {
      if (streaming) {
        abortRef.current?.abort();
        addNote('interrupted');
      } else if (key.ctrl && raw === 'c') {
        exit();
      }
      return;
    }

    if (palette.length > 0) {
      if (key.upArrow) {
        setPaletteIndex(Math.max(0, selected - 1));
        return;
      }
      if (key.downArrow) {
        setPaletteIndex(Math.min(palette.length - 1, selected + 1));
        return;
      }
      if (key.tab) {
        const command = palette[selected];
        updateInput({ text: `${command.name} `, cursor: command.name.length + 1 });
        return;
      }
      if (key.return) {
        runCommand(palette[selected].name);
        updateInput(emptyInput());
        setPaletteIndex(0);
        return;
      }
    }

    if (key.tab && !streaming) {
      setAgent((current) => (current === 'plan' ? 'build' : 'plan'));
      return;
    }

    const outcome = handleInput(inputRef.current, event);
    if (outcome.type === 'submit') {
      void submit(outcome.value);
      return;
    }
    if (outcome.type === 'changed') {
      setPaletteIndex(0);
      updateInput(outcome.state);
    }
  };

  useEffect(() => {
    inputHandlerRef.current = handleKey;
  });

  const dispatchInput = useCallback((raw: string, key: Key) => {
    inputHandlerRef.current(raw, key);
  }, []);

  useInput(dispatchInput);

  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {home ? (
          <Home theme={theme} rows={rows} columns={columns}>
            <Prompt
              width={promptWidth}
              input={input}
              theme={theme}
              agent={agentLabel}
              model={currentModel}
              streaming={streaming}
              frame={frame}
              session={false}
              usage={undefined}
            />
          </Home>
        ) : (
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {visibleMessages(messages, rows - 8).map((message, index) => (
              <MessageRow
                key={index}
                message={message}
                theme={theme}
                agent={agentLabel}
                model={currentModel}
                width={columns}
              />
            ))}
          </Box>
        )}
      </Box>

      {permission ? (
        <PermissionPanel permission={permission.request} theme={theme} width={columns} />
      ) : home ? null : (
        <Prompt
          width={promptWidth}
          input={input}
          theme={theme}
          agent={agentLabel}
          model={currentModel}
          streaming={streaming}
          frame={frame}
          session={true}
          usage={usageLabel}
        />
      )}

      {home && (
        <Box
          width={columns}
          flexDirection="row"
          justifyContent="space-between"
          paddingX={2}
          paddingY={rows >= 16 ? 1 : 0}
        >
          <Text color={theme.muted}>~</Text>
          <Text color={theme.muted}>{version}</Text>
        </Box>
      )}

      {popup || palette.length > 0 ? (
        <Box
          position="absolute"
          width={columns}
          height={rows}
          justifyContent="center"
          alignItems="center"
        >
          {popup?.kind === 'model' ? (
            <ListPopup
              title={`models · ${popup.index + 1}/${modelChoices.length}`}
              items={modelChoices.map((choice) => `${choice.provider}/${choice.model}`)}
              selected={popup.index}
              footer="↑↓ move · enter select · esc close"
              theme={theme}
              width={popupWidth}
              limit={popupLimit}
            />
          ) : popup?.kind === 'theme' ? (
            <ListPopup
              title={`theme · ${THEME_CHOICES[popup.index]}`}
              items={THEME_CHOICES}
              selected={popup.index}
              footer="↑↓ move · enter select · esc close"
              theme={theme}
              width={popupWidth}
              limit={popupLimit}
            />
          ) : popup?.kind === 'help' ? (
            <Popup
              title="help"
              body={[HELP_TEXT, COMMANDS.map((command) => command.name).join('  ')]}
              footer="esc close"
              theme={theme}
              width={popupWidth}
            />
          ) : (
            <ListPopup
              title={`commands · ${selected + 1}/${palette.length}`}
              items={palette.map((command) => `${command.name} ${command.description}`)}
              selected={selected}
              footer="tab complete · ↑↓ move · enter run · esc close"
              theme={theme}
              width={popupWidth}
              limit={popupLimit}
            />
          )}
        </Box>
      ) : null}
    </Box>
  );
}

function Home({
  theme,
  rows,
  columns,
  children,
}: {
  theme: Theme;
  rows: number;
  columns: number;
  children: ReactNode;
}) {
  return (
    <Box flexGrow={1} flexDirection="column" alignItems="center" paddingX={2}>
      <Box flexGrow={1} minHeight={0} />
      <Box height={rows < 16 ? 1 : 3} flexShrink={0} />
      {columns >= 44 && (
        <Box flexDirection="column" flexShrink={0}>
          {LOGO_LEFT.map((line, index) => (
            <Box key={index} flexDirection="row" gap={1}>
              <Text color={theme.muted}>{line}</Text>
              <Text color={theme.text} bold>
                {LOGO_RIGHT[index]}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      <Box height={1} flexShrink={0} />
      <Box
        width={Math.min(75, Math.max(20, columns - 4))}
        paddingTop={1}
        flexDirection="column"
        flexShrink={0}
      >
        {children}
      </Box>
      <Box flexGrow={1} minHeight={0} />
    </Box>
  );
}

function Prompt({
  width,
  input,
  theme,
  agent,
  model,
  streaming,
  frame,
  session,
  usage,
}: {
  width: number;
  input: InputState;
  theme: Theme;
  agent: string;
  model: string;
  streaming: boolean;
  frame: number;
  session: boolean;
  usage?: string;
}) {
  const empty = input.text.length === 0;
  const placeholder = `Ask anything… "${PLACEHOLDERS[0]}"`;
  const inner = Math.max(1, width - 5);
  const textLines = empty
    ? [{ content: <Text color={theme.muted}>{placeholder}</Text>, length: placeholder.length }]
    : wrapLine(input.text, Math.max(1, inner - 1)).map((line, index, all) => ({
        content: (
          <Text color={theme.text}>
            {line}
            {index === all.length - 1 ? <Text color={theme.accent}>▌</Text> : null}
          </Text>
        ),
        length: line.length + (index === all.length - 1 ? 1 : 0),
      }));
  const meta = `${agent} · ${model}`;
  const lines = [
    ...textLines,
    { content: <Text> </Text>, length: 1 },
    {
      content: (
        <Text>
          <Text color={theme.accent}>{agent}</Text>
          <Text color={theme.muted}> · </Text>
          <Text color={theme.text}>{model}</Text>
        </Text>
      ),
      length: meta.length,
    },
  ];
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Panel
        width={width}
        background={theme.promptBg}
        borderColor={theme.accent}
        paddingTop={1}
        lines={lines}
      />
      <Box flexDirection="row">
        <Text color={theme.accent}>╹</Text>
        <Text backgroundColor={theme.promptBg} color={theme.promptBg}>
          {'▀'.repeat(Math.max(0, width - 1))}
        </Text>
      </Box>
      <Box
        width={width}
        flexDirection="row"
        justifyContent="space-between"
        gap={2}
        paddingX={2}
        height={1}
      >
        {streaming ? (
          <Text>
            <Text color={theme.accent}>{SPINNER[frame % SPINNER.length]}</Text>
            <Text color={theme.text}>{' esc'}</Text>
            <Text color={theme.muted}>{' interrupt'}</Text>
          </Text>
        ) : (
          <Text color={theme.muted}>{homeLabel()}</Text>
        )}
        <Box flexDirection="row" gap={2}>
          {usage ? <Text color={theme.muted}>{usage}</Text> : null}
          {!session || !usage ? (
            <Text>
              <Text color={theme.text} bold>
                tab
              </Text>
              <Text color={theme.muted}>{' agents'}</Text>
            </Text>
          ) : null}
          <Text>
            <Text color={theme.text} bold>
              ctrl+p
            </Text>
            <Text color={theme.muted}>{' commands'}</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function windowItems<T>(
  items: T[],
  selected: number,
  limit: number
): { items: T[]; start: number } {
  const start = Math.max(0, Math.min(selected - Math.floor(limit / 2), items.length - limit));
  return { items: items.slice(start, start + limit), start };
}

function Popup({
  title,
  lines = [],
  body,
  active,
  footer,
  theme,
  width,
}: {
  title: string;
  lines?: string[];
  body?: string[];
  active?: number;
  footer: string;
  theme: Theme;
  width: number;
}) {
  const inner = Math.max(1, width - 2);
  const row = (text: string, color: string, key: string | number) => (
    <Text key={key} backgroundColor={theme.panel} color={color}>
      {` ${text.slice(0, inner - 2).padEnd(inner - 2)} `}
    </Text>
  );
  const content = body
    ? body
        .flatMap((text) => wrapLine(text, inner))
        .map((line, index) => row(line, theme.text, index))
    : lines.map((line, index) =>
        row(
          `${index === active ? '❯ ' : '  '}${line}`,
          index === active ? theme.text : theme.muted,
          index
        )
      );
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={theme.border}
      flexShrink={0}
    >
      {row(title, theme.accent, 'title')}
      {content}
      {row(footer, theme.muted, 'footer')}
    </Box>
  );
}

function ListPopup({
  title,
  items,
  selected,
  footer,
  theme,
  width,
  limit,
}: {
  title: string;
  items: string[];
  selected: number;
  footer: string;
  theme: Theme;
  width: number;
  limit: number;
}) {
  const visible = windowItems(items, selected, limit);
  return (
    <Popup
      title={title}
      lines={visible.items}
      active={selected - visible.start}
      footer={footer}
      theme={theme}
      width={width}
    />
  );
}

function PermissionPanel({
  permission,
  theme,
  width,
}: {
  permission: PermissionPrompt;
  theme: Theme;
  width: number;
}) {
  const title = `permission: ${permission.group} · ${permission.tool} · y/n`;
  const detail = permission.detail?.slice(0, Math.max(1, width - 8));
  return (
    <Panel
      width={width}
      background={theme.panel}
      borderColor={theme.warning}
      paddingTop={1}
      paddingBottom={1}
      marginBottom={1}
      lines={[
        { content: <Text color={theme.warning}>{title}</Text>, length: title.length },
        ...(detail
          ? [{ content: <Text color={theme.muted}>{detail}</Text>, length: detail.length }]
          : []),
        {
          content: (
            <Text>
              <Text color={theme.text} bold>
                y
              </Text>
              <Text color={theme.muted}>{' allow  '}</Text>
              <Text color={theme.text} bold>
                n
              </Text>
              <Text color={theme.muted}>{' deny'}</Text>
            </Text>
          ),
          length: 15,
        },
      ]}
    />
  );
}

function MessageRow({
  message,
  theme,
  agent,
  model,
  width,
}: {
  message: ChatMessage;
  theme: Theme;
  agent: string;
  model: string;
  width: number;
}) {
  if (message.role === 'user') {
    return (
      <Panel
        width={width}
        background={theme.panel}
        borderColor={theme.accent}
        paddingTop={1}
        paddingBottom={1}
        marginBottom={1}
        lines={wrapLine(message.text, Math.max(1, width - 5)).map((line) => ({
          content: <Text color={theme.text}>{line}</Text>,
          length: line.length,
        }))}
      />
    );
  }
  if (message.role === 'tool') {
    return (
      <Panel
        width={width}
        background={theme.panel}
        borderColor={theme.border}
        paddingTop={1}
        paddingBottom={1}
        marginBottom={1}
        lines={wrapLine(message.text, Math.max(1, width - 5)).map((line) => ({
          content: <Text color={theme.muted}>{line}</Text>,
          length: line.length,
        }))}
      />
    );
  }
  if (message.role === 'note') {
    return (
      <Box paddingLeft={3} marginBottom={1}>
        <Text color={theme.muted}>
          <Text color={theme.border}>» </Text>
          {message.text}
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box paddingLeft={3} flexDirection="column">
        {message.text.split('\n').map((line, index) => (
          <Text key={index} color={isToolLine(line) ? theme.muted : theme.text} wrap="wrap">
            {line.length > 0 ? line : ' '}
          </Text>
        ))}
      </Box>
      <Box paddingLeft={3} paddingTop={1} flexDirection="row" gap={1}>
        <Text color={theme.accent}>▣</Text>
        <Text color={theme.text}>{agent}</Text>
        <Text color={theme.muted}>·</Text>
        <Text color={theme.muted}>{model}</Text>
      </Box>
    </Box>
  );
}

function isToolLine(line: string): boolean {
  return line.startsWith('⎿') || line.startsWith('✓') || line.startsWith('✗');
}

function homeLabel(): string {
  return shortenHome(process.cwd());
}

function shortenHome(directory: string): string {
  const home = process.env.HOME;
  if (home && directory === home) return '~';
  if (home && directory.startsWith(`${home}/`)) return `~${directory.slice(home.length)}`;
  return directory;
}

function Panel({
  width,
  background,
  borderColor,
  paddingTop = 0,
  paddingBottom = 0,
  marginBottom = 0,
  lines,
}: {
  width: number;
  background: string;
  borderColor: string;
  paddingTop?: number;
  paddingBottom?: number;
  marginBottom?: number;
  lines: { content: ReactNode; length: number }[];
}) {
  const inner = Math.max(1, width - 5);
  const rows = [
    ...Array.from({ length: paddingTop }, () => ({ content: ' ', length: 1 })),
    ...lines,
    ...Array.from({ length: paddingBottom }, () => ({ content: ' ', length: 1 })),
  ];
  return (
    <Box flexDirection="column" width={width} marginBottom={marginBottom} flexShrink={0}>
      {rows.map((line, index) => (
        <Box key={index} flexDirection="row" flexShrink={0}>
          <Text backgroundColor={background} color={borderColor}>
            ┃
          </Text>
          <Text backgroundColor={background}>
            {'  '}
            {line.content}
            {' '.repeat(Math.max(0, inner - line.length))}
            {'  '}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function wrapLine(text: string, width: number): string[] {
  const limit = Math.max(1, width);
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw.length === 0) {
      lines.push(' ');
      continue;
    }
    let rest = raw;
    while (rest.length > limit) {
      let cut = rest.lastIndexOf(' ', limit);
      if (cut <= 0) cut = limit;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^ +/, '');
    }
    lines.push(rest);
  }
  return lines;
}

function paletteOpen(text: string): boolean {
  return text.startsWith('/') && !/\s/.test(text);
}

function messageWeight(message: ChatMessage): number {
  const lines = Math.max(1, message.text.split('\n').length);
  if (message.role === 'user' || message.role === 'tool') return lines + 3;
  if (message.role === 'note') return 2;
  return lines + 2;
}

function visibleMessages(messages: ChatMessage[], budget: number): ChatMessage[] {
  const limit = Math.max(4, budget);
  const visible: ChatMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const weight = messageWeight(message);
    if (visible.length > 0 && used + weight > limit) break;
    used += weight;
    visible.unshift(message);
  }
  const first = visible[0];
  if (first && messageWeight(first) > limit) {
    visible[0] = {
      ...first,
      text: first.text
        .split('\n')
        .slice(-Math.max(1, limit - 3))
        .join('\n'),
    };
  }
  return visible;
}
