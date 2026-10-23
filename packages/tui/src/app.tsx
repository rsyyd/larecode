import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Text, useApp, useInput, useStdin, useStdout, type Key } from 'ink';
import {
  VERSION,
  formatCost,
  formatTokens,
  type ContextReport,
  type UsageAggregate,
} from '@larecode/core';
import { getTheme, type Theme, type ThemeName } from './theme.js';
import { emptyInput, handleInput, type InputState, type KeyEvent } from './input.js';
import { COMMANDS, filterCommands } from './palette.js';
import { copyToClipboard, exportConversation } from './export.js';
import { discoverFiles, insertMention, matchFiles, mentionQuery } from './mentions.js';
import { appendChunk, type ChatMessage } from './messages.js';
import { compactToolText, looksLikeDiff, markdownLines, type SpanKind } from './markdown.js';
import { searchMessages } from './search.js';

export interface PermissionPrompt {
  tool: string;
  group: string;
  detail?: string;
}

export type PermissionConfirm = (request: PermissionPrompt) => Promise<boolean>;

export interface ModelCatalog {
  provider: string;
  models: string[];
  unavailable?: string[];
}

export interface SessionSummary {
  id: string;
  title?: string;
  provider?: string;
  model?: string;
  updatedAt?: string | number;
}

export interface AppProps {
  provider?: string;
  model?: string;
  catalogs?: ModelCatalog[];
  onSelectModel?: (provider: string, model: string) => void;
  sessions?: SessionSummary[];
  onResumeSession?: (id: string) => ChatMessage[] | undefined;
  sessionId?: string;
  theme?: ThemeName;
  version?: string;
  initialMessages?: ChatMessage[];
  getUsage?: () => UsageAggregate;
  getContext?: () => ContextReport;
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
  'enter send · ctrl+j newline · esc stop · tab agent · pgup/pgdn scroll · @general subagent · / commands · ctrl+c quit';

const NEXT_ACTIONS: Record<string, string> = {
  RATE_LIMITED: 'wait a moment and retry',
  PROVIDER_TIMEOUT: 'retry or switch models',
  PROVIDER_AUTH_FAILED: 'check the provider API key',
  PROVIDER_UNAVAILABLE: 'check the provider endpoint',
  NETWORK_ERROR: 'check the connection and retry',
  EMPTY_RESPONSE: 'retry the turn',
  PATCH_CONFLICT: 're-read the file and retry',
};

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const details = error as { code?: unknown; retryable?: unknown };
  const code = typeof details.code === 'string' ? details.code : undefined;
  if (!code) return error.message;
  const action = NEXT_ACTIONS[code] ?? (details.retryable === true ? 'retry the turn' : undefined);
  return `${code}: ${error.message}${action ? ` · ${action}` : ''}`;
}

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
  | { kind: 'model'; index: number }
  | { kind: 'theme'; index: number }
  | { kind: 'sessions'; index: number }
  | { kind: 'help' };

interface PickerRow {
  text: string;
  header?: boolean;
  item?: number;
  disabled?: boolean;
}

function modelListing(catalogs: ModelCatalog[]): {
  choices: { provider: string; model: string; unavailable: boolean }[];
  rows: PickerRow[];
} {
  const choices: { provider: string; model: string; unavailable: boolean }[] = [];
  const rows: PickerRow[] = [];
  for (const catalog of catalogs) {
    rows.push({ text: catalog.provider, header: true });
    for (const model of catalog.models) {
      const unavailable = catalog.unavailable?.includes(model) ?? false;
      rows.push({
        text: `${model}${unavailable ? ' · unavailable' : ''}`,
        item: choices.length,
        disabled: unavailable,
      });
      choices.push({ provider: catalog.provider, model, unavailable });
    }
  }
  return { choices, rows };
}

const THEME_CHOICES: ThemeName[] = ['dark', 'light'];

function sessionTitle(session: SessionSummary): string {
  const title = (session.title ?? 'untitled').slice(0, 40);
  return session.model ? `${title} · ${session.model}` : title;
}

export function App({
  provider: initialProvider,
  model = 'no model',
  catalogs = [],
  onSelectModel,
  sessions = [],
  onResumeSession,
  sessionId: initialSessionId,
  theme: initialTheme = 'dark',
  version = VERSION,
  initialMessages = [],
  getUsage,
  getContext,
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
  const [currentSessionId, setCurrentSessionId] = useState(initialSessionId);
  const [themeName, setThemeName] = useState<ThemeName>(initialTheme);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });
  const [frame, setFrame] = useState(0);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [sessionFilter, setSessionFilter] = useState('');
  const filesLoaded = useRef(false);
  const [queue, setQueue] = useState<string[]>([]);
  const queueRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const setQueued = (next: string[]): void => {
    queueRef.current = next;
    setQueue(next);
  };

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

  useEffect(() => {
    if (!stdout) return;
    const onResize = (): void => {
      setSize({
        columns: stdout.columns ?? 80,
        rows: stdout.rows ?? 24,
      });
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  useEffect(() => {
    if (filesLoaded.current || !input.text.includes('@')) return;
    filesLoaded.current = true;
    setFiles(discoverFiles(process.cwd()));
  }, [input.text]);

  const theme = getTheme(themeName);
  const home = messages.length === 0;
  const agentLabel = agent === 'plan' ? 'Plan' : 'Build';
  const columns = Math.max(1, size.columns - 1);
  const rows = Math.max(1, size.rows - 1);
  const promptWidth = home ? Math.min(75, Math.max(20, columns - 4)) : columns;
  const popupWidth = Math.min(60, Math.max(24, columns - 2));
  const popupLimit = Math.max(1, Math.min(10, rows - 6));
  const palette = !popup && paletteOpen(input.text) ? filterCommands(input.text) : [];
  const selected = Math.min(paletteIndex, Math.max(0, palette.length - 1));
  const mention = mentionQuery(input.text, input.cursor);
  const mentionMatches = !popup && !streaming && mention !== null ? matchFiles(files, mention) : [];
  const selectedMention = Math.min(mentionIndex, Math.max(0, mentionMatches.length - 1));
  const listedSessions = sessionFilter
    ? sessions.filter((session) =>
        `${sessionTitle(session)} ${session.id}`.toLowerCase().includes(sessionFilter)
      )
    : sessions;
  const { choices: modelChoices, rows: modelRows } = modelListing(catalogs);
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
      case '/new':
        setMessages([]);
        onClear?.();
        setScrollOffset(0);
        break;
      case '/sessions': {
        const filter = args.join(' ').trim().toLowerCase();
        const listed = filter
          ? sessions.filter((session) =>
              `${sessionTitle(session)} ${session.id}`.toLowerCase().includes(filter)
            )
          : sessions;
        if (listed.length === 0) {
          addNote(filter ? `no sessions matching "${filter}"` : 'no saved sessions');
          break;
        }
        const index = Math.max(
          0,
          listed.findIndex((session) => session.id === currentSessionId)
        );
        setSessionFilter(filter);
        setPopup({ kind: 'sessions', index });
        break;
      }
      case '/status': {
        const lines = [
          `agent ${agentLabel}`,
          `model ${currentProvider ?? '?'}/${currentModel}`,
          ...(usage && usage.totalTokens.total > 0
            ? [
                `tokens ${formatTokens(usage.totalTokens.total)}`,
                `cost ${formatCost(usage.totalCost.totalCost)}`,
              ]
            : []),
          ...(queue.length > 0 ? [`queued ${queue.length}`] : []),
        ];
        addNote(lines.join(' · '));
        break;
      }
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
          addNote(`error: ${describeError(error)}`);
        }
        break;
      }
      case '/copy': {
        const last = [...messages].reverse().find((message) => message.role === 'agent');
        if (!last) {
          addNote('no answer to copy');
          break;
        }
        addNote(
          copyToClipboard(last.text)
            ? 'copied the last answer'
            : 'clipboard unavailable · use /export <file>'
        );
        break;
      }
      case '/export': {
        const path = args[0] ?? `larecode-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
        try {
          addNote(`exported ${exportConversation(messages, path)}`);
        } catch (error) {
          addNote(`export failed: ${describeError(error)}`);
        }
        break;
      }
      case '/search': {
        const query = args.join(' ').trim();
        if (query.length === 0) {
          addNote('usage: /search <text>');
          break;
        }
        const hits = searchMessages(messages, query);
        if (hits.length === 0) {
          addNote(`no matches for "${query}"`);
          break;
        }
        const hit = hits[hits.length - 1];
        if (hit) {
          setScrollOffset(messages.length - 1 - hit.index);
          setNotice(`${hits.length} match${hits.length === 1 ? '' : 'es'} · ${hit.preview}`);
        }
        break;
      }
      case '/context': {
        const report = getContext?.();
        if (!report) {
          addNote('context report unavailable');
          break;
        }
        addNote(
          `context ${report.used}/${report.total} tok · repo map ${report.sources.repoMap ? 'on' : 'off'} · ${report.sources.retrievalFiles} files · ${report.sources.memoryEntries} memories`
        );
        const sections = report.sections
          .filter((section) => section.tokens > 0)
          .map((section) => `${section.name} ${section.tokens}${section.truncated ? ' (cut)' : ''}`)
          .join(' · ');
        if (sections) addNote(sections);
        if (report.sources.instructions.length > 0) {
          addNote(`instructions: ${report.sources.instructions.join(', ')}`);
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
        addNote(`error: ${describeError(error)}`);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      if (getUsage) setUsage(getUsage());
      const next = queueRef.current.shift();
      if (next !== undefined) {
        setQueued([...queueRef.current]);
        void submit(next);
      }
    }
  };

  const submit = async (value: string): Promise<void> => {
    setNotice(null);
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    setScrollOffset(0);
    updateInput(emptyInput());
    setPaletteIndex(0);

    if (trimmed.startsWith('/')) {
      runCommand(trimmed);
      return;
    }
    if (streaming) {
      const next = [...queueRef.current, trimmed];
      setQueued(next);
      addNote(`queued · ${next.length} waiting`);
      return;
    }

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
      const count =
        popup.kind === 'model'
          ? modelChoices.length
          : popup.kind === 'sessions'
            ? listedSessions.length
            : THEME_CHOICES.length;
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
          if (choice && !choice.unavailable) {
            try {
              onSelectModel?.(choice.provider, choice.model);
              setCurrentProvider(choice.provider);
              setCurrentModel(choice.model);
            } catch (error) {
              addNote(`error: ${describeError(error)}`);
            }
          }
        } else if (popup.kind === 'sessions') {
          const session = listedSessions[popup.index];
          if (session) {
            const restored = onResumeSession?.(session.id);
            if (!restored) {
              addNote(`session ${session.id} could not be loaded`);
            } else {
              setMessages(restored);
              setCurrentSessionId(session.id);
              setScrollOffset(0);
              addNote(`resumed ${session.id}`);
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

    if (mentionMatches.length > 0) {
      if (key.upArrow) {
        setMentionIndex(Math.max(0, selectedMention - 1));
        return;
      }
      if (key.downArrow) {
        setMentionIndex(Math.min(mentionMatches.length - 1, selectedMention + 1));
        return;
      }
      if (key.tab || key.return) {
        const path = mentionMatches[selectedMention];
        if (path) {
          updateInput(insertMention(inputRef.current.text, inputRef.current.cursor, path));
          setMentionIndex(0);
        }
        return;
      }
    }

    if (key.pageUp && messages.length > 0) {
      setScrollOffset((current) => Math.min(current + Math.max(1, rows - 10), messages.length - 1));
      return;
    }

    if (key.pageDown) {
      setScrollOffset((current) => Math.max(0, current - Math.max(1, rows - 10)));
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
        if (queueRef.current.length > 0) setQueued([]);
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
      setMentionIndex(0);
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
              queued={queue.length}
            />
          </Home>
        ) : (
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {visibleMessages(messages, rows - 8, scrollOffset).map((message, index) => (
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

      {notice ? (
        <Box paddingX={2} flexShrink={0}>
          <Text color={theme.muted} wrap="truncate-end">
            {notice}
          </Text>
        </Box>
      ) : null}

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
          queued={queue.length}
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

      {popup || palette.length > 0 || mentionMatches.length > 0 ? (
        <Box
          position="absolute"
          width={columns}
          height={rows}
          justifyContent="center"
          alignItems="center"
        >
          {popup?.kind === 'model' ? (
            <PickerPopup
              title={`models · ${modelChoices[popup.index]?.provider ?? '?'} · ${popup.index + 1}/${modelChoices.length}`}
              rows={modelRows}
              selected={popup.index}
              footer={listFooter(popupWidth)}
              theme={theme}
              width={popupWidth}
              limit={popupLimit}
            />
          ) : popup?.kind === 'theme' ? (
            <ListPopup
              title={`theme · ${THEME_CHOICES[popup.index]}`}
              items={THEME_CHOICES}
              selected={popup.index}
              footer={listFooter(popupWidth)}
              theme={theme}
              width={popupWidth}
              limit={popupLimit}
            />
          ) : popup?.kind === 'sessions' ? (
            <ListPopup
              title={`sessions${sessionFilter ? ` · ${sessionFilter}` : ''} · ${popup.index + 1}/${listedSessions.length}`}
              items={listedSessions.map((session) => sessionTitle(session))}
              selected={popup.index}
              footer={listFooter(popupWidth)}
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
          ) : mentionMatches.length > 0 ? (
            <ListPopup
              title={`files · @${mention ?? ''} · ${selectedMention + 1}/${mentionMatches.length}`}
              items={mentionMatches}
              selected={selectedMention}
              footer="tab or enter insert · ↑↓ choose"
              theme={theme}
              width={popupWidth}
              limit={popupLimit}
            />
          ) : (
            <ListPopup
              title={`commands · ${selected + 1}/${palette.length}`}
              items={palette.map((command) => `${command.name} ${command.description}`)}
              selected={selected}
              footer={commandFooter(popupWidth)}
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
  queued = 0,
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
  queued?: number;
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
            {queued > 0 ? <Text color={theme.warning}>{` · ${queued} queued`}</Text> : null}
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

function listFooter(width: number): string {
  return width < 44 ? '↑↓ · enter · esc' : '↑↓ move · enter select · esc close';
}

function commandFooter(width: number): string {
  return width < 44 ? 'tab · ↑↓ · enter · esc' : 'tab complete · ↑↓ move · enter run · esc close';
}

function Popup({
  title,
  lines = [],
  rows,
  body,
  active,
  footer,
  theme,
  width,
}: {
  title: string;
  lines?: string[];
  rows?: PickerRow[];
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
  const content = rows
    ? rows.map((entry, index) =>
        entry.header
          ? row(entry.text, theme.accent, `h${index}`)
          : row(
              `${index === active ? '❯ ' : '  '}${entry.text}`,
              index === active ? theme.text : theme.muted,
              `r${index}`
            )
      )
    : body
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

function PickerPopup({
  title,
  rows,
  selected,
  footer,
  theme,
  width,
  limit,
}: {
  title: string;
  rows: PickerRow[];
  selected: number;
  footer: string;
  theme: Theme;
  width: number;
  limit: number;
}) {
  const active = rows.findIndex((row) => row.item === selected);
  const visible = windowItems(rows, active, limit);
  return (
    <Popup
      title={title}
      rows={visible.items}
      active={active - visible.start}
      footer={footer}
      theme={theme}
      width={width}
    />
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
      <Box paddingLeft={3} marginBottom={1} flexDirection="row">
        <Text color={theme.accent}>› </Text>
        <Box flexShrink={1}>
          <Text color={theme.text} wrap="wrap">
            {message.text}
          </Text>
        </Box>
      </Box>
    );
  }
  if (message.role === 'tool') {
    const compact = compactToolText(message.text);
    const diff = looksLikeDiff(message.text);
    return (
      <Panel
        width={width}
        background={theme.panel}
        borderColor={theme.border}
        paddingTop={1}
        paddingBottom={1}
        marginBottom={1}
        lines={wrapLine(compact.text, Math.max(1, width - 5)).map((line) => ({
          content: (
            <Text color={(diff ? diffColor(line, theme) : undefined) ?? theme.muted}>{line}</Text>
          ),
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
        {markdownLines(message.text).map((line, index) => {
          const plain = line.spans.map((span) => span.text).join('');
          return (
            <Text key={index} color={isToolLine(plain) ? theme.muted : theme.text} wrap="wrap">
              {line.diff ? (
                <Text color={diffColor(plain, theme)}>{plain.length > 0 ? plain : ' '}</Text>
              ) : plain.length === 0 ? (
                ' '
              ) : (
                line.spans.map((span, position) => (
                  <Text
                    key={position}
                    color={spanColor(span.kind, theme)}
                    bold={span.kind === 'bold' || span.kind === 'heading'}
                    italic={span.kind === 'italic'}
                    underline={span.kind === 'link'}
                  >
                    {span.text}
                  </Text>
                ))
              )}
            </Text>
          );
        })}
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

function spanColor(kind: SpanKind, theme: Theme): string {
  if (kind === 'heading' || kind === 'link') return theme.accent;
  if (kind === 'code') return theme.warning;
  if (kind === 'italic') return theme.muted;
  return theme.text;
}

function diffColor(line: string, theme: Theme): string | undefined {
  if (line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---'))
    return theme.accent;
  if (line.startsWith('+')) return theme.success;
  if (line.startsWith('-')) return theme.error;
  return undefined;
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
  const text = message.role === 'tool' ? compactToolText(message.text).text : message.text;
  const lines = Math.max(1, text.split('\n').length);
  if (message.role === 'user' || message.role === 'tool') return lines + 3;
  if (message.role === 'note') return 2;
  return lines + 2;
}

function visibleMessages(messages: ChatMessage[], budget: number, offset = 0): ChatMessage[] {
  const limit = Math.max(4, budget);
  const end = Math.max(0, messages.length - Math.max(0, offset));
  const visible: ChatMessage[] = [];
  let used = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const weight = messageWeight(message);
    if (visible.length > 0 && used + weight > limit) break;
    used += weight;
    visible.unshift(message);
  }
  const first = visible[0];
  if (first && messageWeight(first) > limit) {
    const text = first.role === 'tool' ? compactToolText(first.text).text : first.text;
    visible[0] = {
      ...first,
      text: text
        .split('\n')
        .slice(-Math.max(1, limit - 3))
        .join('\n'),
    };
  }
  return visible;
}
