import { spawn } from 'node:child_process';
import { LareError } from '../error/error.js';
import { MAX_STREAM_BYTES } from '../tool/files.js';

export interface ExecRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
  abortSignal: AbortSignal;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface ExecutionBackend {
  readonly name: string;
  exec(request: ExecRequest): Promise<ExecResult>;
}

export interface ExecutionConfig {
  backend: 'local' | 'docker' | 'ssh' | 'powershell' | 'cmd';
  docker?: { image: string; network?: boolean; args?: string[]; user?: string };
  ssh?: { host: string; user?: string; port?: number; identityFile?: string };
}

interface SpawnSpec {
  command: string;
  args?: string[];
  shell?: boolean;
}

interface RunOptions {
  cwd: string;
  timeoutMs: number;
  abortSignal: AbortSignal;
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

function getDefaultShell(): { command: string; args: string[] } {
  if (isWindows()) {
    // Prefer PowerShell if available, fallback to cmd.exe
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command'] };
  }
  return { command: 'sh', args: ['-c'] };
}

export function runProcess(spec: SpawnSpec, options: RunOptions): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(spec.command, spec.args ?? [], {
      shell: spec.shell ?? false,
      cwd: options.cwd,
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
    }, options.timeoutMs);

    const onAbort = (): void => {
      terminate();
    };
    options.abortSignal.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timer);
      options.abortSignal.removeEventListener('abort', onAbort);
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
      reject(new LareError('TOOL_EXECUTION_FAILED', `command failed to start: ${error.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (options.abortSignal.aborted) {
        reject(new LareError('CANCELLED', 'command cancelled'));
        return;
      }
      resolvePromise({
        stdout,
        stderr,
        exitCode: code ?? -1,
        timedOut,
        truncated: stdoutTruncated || stderrTruncated,
      });
    });
  });
}

export class LocalBackend implements ExecutionBackend {
  readonly name = 'local';

  exec(request: ExecRequest): Promise<ExecResult> {
    const shell = getDefaultShell();
    return runProcess(
      { command: shell.command, args: [...shell.args, request.command] },
      { cwd: request.cwd, timeoutMs: request.timeoutMs, abortSignal: request.abortSignal }
    );
  }
}

export function dockerArgs(
  request: ExecRequest,
  options: { image: string; network?: boolean; args?: string[]; user?: string }
): string[] {
  return [
    'run',
    '--rm',
    '-i',
    ...(options.network ? [] : ['--network', 'none']),
    ...(options.user ? ['--user', options.user] : []),
    '-v',
    `${request.cwd}:${request.cwd}`,
    '-w',
    request.cwd,
    ...(options.args ?? []),
    options.image,
    'sh',
    '-lc',
    request.command,
  ];
}

export class DockerBackend implements ExecutionBackend {
  readonly name = 'docker';
  private readonly binary: string;
  private readonly options: { image: string; network?: boolean; args?: string[]; user?: string };

  constructor(options: {
    image: string;
    binary?: string;
    network?: boolean;
    args?: string[];
    user?: string;
  }) {
    this.binary = options.binary ?? 'docker';
    this.options = options;
  }

  exec(request: ExecRequest): Promise<ExecResult> {
    return runProcess(
      { command: this.binary, args: dockerArgs(request, this.options) },
      { cwd: request.cwd, timeoutMs: request.timeoutMs, abortSignal: request.abortSignal }
    );
  }
}

export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function sshArgs(
  request: ExecRequest,
  options: { host: string; user?: string; port?: number; identityFile?: string; args?: string[] }
): string[] {
  const target = options.user ? `${options.user}@${options.host}` : options.host;
  return [
    '-o',
    'BatchMode=yes',
    ...(options.port ? ['-p', String(options.port)] : []),
    ...(options.identityFile ? ['-i', options.identityFile] : []),
    ...(options.args ?? []),
    target,
    `cd ${shellQuote(request.cwd)} && ${request.command}`,
  ];
}

export class SshBackend implements ExecutionBackend {
  readonly name = 'ssh';
  private readonly binary: string;
  private readonly options: {
    host: string;
    user?: string;
    port?: number;
    identityFile?: string;
    args?: string[];
  };

  constructor(options: {
    host: string;
    user?: string;
    port?: number;
    identityFile?: string;
    binary?: string;
    args?: string[];
  }) {
    this.binary = options.binary ?? 'ssh';
    this.options = options;
  }

  exec(request: ExecRequest): Promise<ExecResult> {
    return runProcess(
      { command: this.binary, args: sshArgs(request, this.options) },
      { cwd: request.cwd, timeoutMs: request.timeoutMs, abortSignal: request.abortSignal }
    );
  }
}

export class PowerShellBackend implements ExecutionBackend {
  readonly name = 'powershell';

  exec(request: ExecRequest): Promise<ExecResult> {
    const args = ['-NoProfile', '-NonInteractive', '-Command', request.command];
    return runProcess(
      { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', request.command] },
      { cwd: request.cwd, timeoutMs: request.timeoutMs, abortSignal: request.abortSignal }
    );
  }
}

export class CmdBackend implements ExecutionBackend {
  readonly name = 'cmd';

  exec(request: ExecRequest): Promise<ExecResult> {
    return runProcess(
      { command: 'cmd.exe', args: ['/c', request.command] },
      { cwd: request.cwd, timeoutMs: request.timeoutMs, abortSignal: request.abortSignal }
    );
  }
}

export function backendFromConfig(config: { execution?: ExecutionConfig }): ExecutionBackend {
  const execution = config.execution ?? { backend: 'local' as const };
  if (execution.backend === 'docker') {
    if (!execution.docker?.image) {
      throw new LareError(
        'CONFIG_INVALID',
        'execution.docker.image is required for the docker backend'
      );
    }
    return new DockerBackend(execution.docker);
  }
  if (execution.backend === 'ssh') {
    if (!execution.ssh?.host) {
      throw new LareError('CONFIG_INVALID', 'execution.ssh.host is required for the ssh backend');
    }
    return new SshBackend(execution.ssh);
  }
  if (execution.backend === 'powershell') {
    return new PowerShellBackend();
  }
  if (execution.backend === 'cmd') {
    return new CmdBackend();
  }
  return new LocalBackend();
}
