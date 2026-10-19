import { LocalBackend, type ExecutionBackend } from '../exec/backend.js';
import type { Tool } from './tool.js';

interface BashArgs {
  command: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function bashTool(backend: ExecutionBackend = new LocalBackend()): Tool {
  return {
    name: 'bash',
    description: 'Run a shell command in the workspace and capture stdout, stderr, and exit code.',
    schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeoutMs: { type: 'number', description: 'Kill the command after this many milliseconds' },
      },
      required: ['command'],
    },
    async execute(args, context) {
      const { command, timeoutMs } = args as BashArgs;
      const result = await backend.exec({
        command,
        cwd: context.workingDir,
        timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
        abortSignal: context.abortSignal,
      });
      return { command, backend: backend.name, ...result };
    },
  };
}
