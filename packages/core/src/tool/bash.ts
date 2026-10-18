import { spawn } from 'node:child_process';
import { LumpsError } from '../error/error.js';
import type { Tool } from './tool.js';
import { MAX_STREAM_BYTES } from './files.js';

interface BashArgs {
  command: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function bashTool(): Tool {
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
    execute(args, context) {
      const { command, timeoutMs } = args as BashArgs;
      return new Promise((resolvePromise, reject) => {
        const child = spawn(command, {
          shell: true,
          cwd: context.workingDir,
          env: process.env,
          detached: true,
        });

        const terminate = (): void => {
          if (child.pid === undefined) return;
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        };

        let stdout = '';
        let stderr = '';
        let stdoutTruncated = false;
        let stderrTruncated = false;
        let timedOut = false;
        let settled = false;

        const timer = setTimeout(() => {
          timedOut = true;
          terminate();
        }, timeoutMs ?? DEFAULT_TIMEOUT_MS);

        const onAbort = (): void => {
          terminate();
        };
        context.abortSignal.addEventListener('abort', onAbort, { once: true });

        const cleanup = (): void => {
          clearTimeout(timer);
          context.abortSignal.removeEventListener('abort', onAbort);
        };

        const collect = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
          const text = chunk.toString('utf8');
          if (stream === 'stdout') {
            const room = MAX_STREAM_BYTES - stdout.length;
            stdout += room > 0 ? text.slice(0, room) : '';
            if (text.length > room) stdoutTruncated = true;
          } else {
            const room = MAX_STREAM_BYTES - stderr.length;
            stderr += room > 0 ? text.slice(0, room) : '';
            if (text.length > room) stderrTruncated = true;
          }
        };

        child.stdout?.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
        child.stderr?.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));

        child.on('error', (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(
            new LumpsError('TOOL_EXECUTION_FAILED', `command failed to start: ${error.message}`)
          );
        });

        child.on('close', (code) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (context.abortSignal.aborted) {
            reject(new LumpsError('CANCELLED', 'command cancelled'));
            return;
          }
          resolvePromise({
            command,
            stdout,
            stderr,
            exitCode: code ?? -1,
            timedOut,
            truncated: stdoutTruncated || stderrTruncated,
          });
        });
      });
    },
  };
}
