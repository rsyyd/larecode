import { useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { formatCost, formatTokens, type UsageAggregate } from '@lumpscode/core';
import { getTheme, type Theme, type ThemeName } from './theme.js';
import { emptyInput, handleInput, type InputState, type KeyEvent } from './input.js';
import { filterCommands } from './palette.js';
import { appendChunk, type ChatMessage } from './messages.js';

export interface AppProps {
  model?: string;
  theme?: ThemeName;
  initialMessages?: ChatMessage[];
  getUsage?: () => UsageAggregate;
  runTurn?: (
    prompt: string,
    onChunk: (chunk: string) => void,
    signal: AbortSignal,
    agent: 'plan' | 'build'
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

export function App({
  model = 'no model',
  theme: initialTheme = 'dark',
  initialMessages = [],
  getUsage,
  runTurn,
  runSubagentTurn,
}: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [usage, setUsage] = useState<UsageAggregate | null>(null);
  const [input, setInput] = useState<InputState>(emptyInput());
  const [agent, setAgent] = useState<'plan' | 'build'>('plan');
  const [themeName, setThemeName] = useState<ThemeName>(initialTheme);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const theme = getTheme(themeName);
  const palette = paletteOpen(input.text) ? filterCommands(input.text) : [];
  const selected = Math.min(paletteIndex, Math.max(0, palette.length - 1));

  const addNote = (text: string): void => {
    setMessages((current) => [...current, { role: 'note', text }]);
  };

  const runCommand = (raw: string): void => {
    const name = raw.trim().split(/\s+/)[0];
    switch (name) {
      case '/help':
        addNote(HELP_TEXT);
        break;
      case '/clear':
        setMessages([]);
        break;
      case '/theme':
        setThemeName((current) => (current === 'dark' ? 'light' : 'dark'));
        break;
      case '/exit':
        exit();
        break;
      default:
        addNote(`${name} arrives in a later milestone`);
    }
  };

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
    setInput(emptyInput());
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
    await streamTurn((next, onChunk, signal) => runTurn(next, onChunk, signal, agent), trimmed);
  };

  useInput((raw, key) => {
    const event: KeyEvent = { input: raw, key };

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
        setInput({ text: `${command.name} `, cursor: command.name.length + 1 });
        return;
      }
      if (key.return) {
        runCommand(palette[selected].name);
        setInput(emptyInput());
        setPaletteIndex(0);
        return;
      }
    }

    if (key.tab && !streaming) {
      setAgent((current) => (current === 'plan' ? 'build' : 'plan'));
      return;
    }

    const outcome = handleInput(input, event);
    if (outcome.type === 'submit') {
      void submit(outcome.value);
      return;
    }
    if (outcome.type === 'changed') {
      setPaletteIndex(0);
      setInput(outcome.state);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Box flexDirection="column" flexGrow={1}>
        {messages.map((message, index) => (
          <MessageRow key={index} message={message} theme={theme} agent={agent} />
        ))}
      </Box>

      {palette.length > 0 && (
        <Box flexDirection="column">
          {palette.map((command, index) => (
            <Text key={command.name} color={index === selected ? theme.accent : theme.muted}>
              {index === selected ? '❯ ' : '  '}
              {command.name} <Text color={theme.muted}>{command.description}</Text>
            </Text>
          ))}
        </Box>
      )}

      <Box>
        <Text color={theme.prompt}>❯ </Text>
        <Text>{input.text}</Text>
      </Box>

      <Box>
        <Text color={theme.muted}>
          {agent} (Tab) · {model} · {themeName}
          {streaming ? ' · streaming' : ''}
          {!streaming && usage && usage.totalTokens.total > 0
            ? ` · ${formatTokens(usage.totalTokens.total)} tok · ${formatCost(usage.totalCost.totalCost)}`
            : ''}
        </Text>
      </Box>
    </Box>
  );
}

function paletteOpen(text: string): boolean {
  return text.startsWith('/') && !/\s/.test(text);
}

function MessageRow({
  message,
  theme,
  agent,
}: {
  message: ChatMessage;
  theme: Theme;
  agent: 'plan' | 'build';
}) {
  if (message.role === 'user') {
    return (
      <Text color={theme.user}>
        {'> '}
        {message.text}
      </Text>
    );
  }
  if (message.role === 'tool') {
    return (
      <Text color={theme.tool}>
        {'⎿ '}
        {message.text}
      </Text>
    );
  }
  if (message.role === 'note') {
    return (
      <Text color={theme.note}>
        {'» '}
        {message.text}
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      <Text color={theme.agent}>
        {'● '}lumps · {agent}
      </Text>
      <Text>{message.text}</Text>
    </Box>
  );
}
