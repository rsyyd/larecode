import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lumpscodeHome } from '../config/config.js';
import { defaultLogger, Logger } from '../logger/logger.js';
import type { HookContext, HookDecision, HookType } from '../hook/hook.js';
import type { Hooks } from '../hook/hook.js';

export type PluginTrust = 'trusted' | 'untrusted';

export const HOOK_TYPES: HookType[] = ['pre-tool', 'post-tool', 'session-start', 'session-end'];

export interface PluginManifest {
  name: string;
  version: string;
  entry: string;
  description?: string;
}

export interface PluginInfo extends PluginManifest {
  dir: string;
  entryPath: string;
  hash: string;
  trust: PluginTrust;
  origin: 'user' | 'project';
}

export type PluginHookHandler = (
  context: HookContext
) => HookDecision | void | Promise<HookDecision | void>;

export interface PluginApi {
  registerHook(type: HookType, handler: PluginHookHandler): void;
}

export interface PluginModule {
  activate?: (api: PluginApi) => void | Promise<void>;
}

function harnessCode(entry: string): string {
  return `
const entry = ${JSON.stringify(pathToFileURL(entry).href)};
const send = (message) => {
  process.stdout.write(JSON.stringify(message) + "\\n");
};
console.log = (...args) => {
  console.error(...args);
};
import(entry).then(
  (module) => {
    if (typeof module.handle !== "function") {
      send({ ready: true, error: "plugin does not export a handle() function" });
      return;
    }
    send({ ready: true });
    let buffer = "";
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let request;
        try {
          request = JSON.parse(line);
        } catch {
          continue;
        }
        Promise.resolve()
          .then(() => module.handle(request.method, request.params))
          .then(
            (result) => send({ id: request.id, result }),
            (error) => send({ id: request.id, error: String((error && error.message) || error) })
          );
      }
    });
  },
  (error) => send({ ready: true, error: String((error && error.message) || error) })
);
`;
}

export function pluginRoots(
  projectDir: string
): Array<{ dir: string; trust: PluginTrust; origin: 'user' | 'project' }> {
  return [
    { dir: join(lumpscodeHome(), 'plugins'), trust: 'trusted', origin: 'user' },
    { dir: join(projectDir, '.lumpscode', 'plugins'), trust: 'untrusted', origin: 'project' },
  ];
}

export function discoverPlugins(projectDir: string): PluginInfo[] {
  const byName = new Map<string, PluginInfo>();
  for (const root of pluginRoots(projectDir)) {
    if (!existsSync(root.dir)) continue;
    for (const entry of readdirSync(root.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root.dir, entry.name);
      const manifestPath = join(dir, 'plugin.json');
      if (!existsSync(manifestPath)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch {
        continue;
      }
      const manifest = (parsed ?? {}) as Partial<PluginManifest>;
      if (
        typeof manifest.name !== 'string' ||
        typeof manifest.version !== 'string' ||
        typeof manifest.entry !== 'string'
      ) {
        continue;
      }
      const entryPath = resolve(dir, manifest.entry);
      if (!(entryPath === dir || entryPath.startsWith(dir + sep))) continue;
      if (!existsSync(entryPath)) continue;
      if (byName.has(manifest.name)) continue;
      byName.set(manifest.name, {
        name: manifest.name,
        version: manifest.version,
        entry: manifest.entry,
        description: typeof manifest.description === 'string' ? manifest.description : undefined,
        dir,
        entryPath,
        hash: createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),
        trust: root.trust,
        origin: root.origin,
      });
    }
  }
  return [...byName.values()];
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class IpcPlugin {
  private child: ChildProcess;
  private buffer = '';
  private pending = new Map<number, PendingCall>();
  private nextId = 1;
  private readyResolve?: (error?: string) => void;

  constructor(
    private readonly info: PluginInfo,
    private readonly timeoutMs: number,
    private readonly logger: Logger
  ) {
    this.child = spawn(process.execPath, ['-e', harnessCode(info.entryPath)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk.toString()));
    this.child.stderr?.on('data', (chunk: Buffer) =>
      this.logger.debug('plugin stderr', { plugin: info.name, line: chunk.toString().trim() })
    );
    this.child.on('exit', (code) => this.onExit(code));
  }

  private onData(text: string): void {
    this.buffer += text;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: { id?: number; ready?: boolean; result?: unknown; error?: string };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue;
      }
      if (message.ready) {
        const resolve = this.readyResolve;
        this.readyResolve = undefined;
        resolve?.(message.error);
        continue;
      }
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.result);
      }
    }
  }

  private onExit(code: number | null): void {
    const reason = `plugin process exited with code ${code}`;
    const resolve = this.readyResolve;
    this.readyResolve = undefined;
    resolve?.(reason);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyResolve = undefined;
        reject(new Error(`plugin did not start within ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.readyResolve = (error) => {
        clearTimeout(timer);
        if (error) reject(new Error(error));
        else resolve();
      };
    });
  }

  request(method: string, params: unknown): Promise<HookDecision | void> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`plugin call timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      let payload: string;
      try {
        payload = JSON.stringify({ id, method, params });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('hook context is not serializable'));
        return;
      }
      this.child.stdin?.write(payload + '\n');
    }).then((result) => (result ?? undefined) as HookDecision | void);
  }

  close(): void {
    this.child.kill();
  }
}

export interface PluginsOptions {
  projectDir?: string;
  logger?: Logger;
  timeoutMs?: number;
}

export interface PluginLoadReport {
  loaded: string[];
  failed: Array<{ name: string; reason: string }>;
}

export class Plugins {
  private readonly projectDir: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly loaded = new Map<string, { info: PluginInfo; ipc?: IpcPlugin }>();

  constructor(options: PluginsOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd());
    this.logger = options.logger ?? defaultLogger;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  list(): PluginInfo[] {
    return discoverPlugins(this.projectDir);
  }

  api(info: PluginInfo, hooks: Hooks): PluginApi {
    return {
      registerHook: (type, handler) => {
        hooks.register({ type, name: `plugin:${info.name}`, handler });
      },
    };
  }

  async load(hooks: Hooks): Promise<PluginLoadReport> {
    const report: PluginLoadReport = { loaded: [], failed: [] };
    for (const info of this.list()) {
      try {
        if (info.trust === 'trusted') {
          const module = (await import(pathToFileURL(info.entryPath).href)) as PluginModule;
          if (typeof module.activate !== 'function') {
            throw new Error('plugin does not export activate()');
          }
          await module.activate(this.api(info, hooks));
          this.loaded.set(info.name, { info });
        } else {
          const ipc = new IpcPlugin(info, this.timeoutMs, this.logger);
          try {
            await ipc.start();
          } catch (error) {
            ipc.close();
            throw error;
          }
          for (const type of HOOK_TYPES) {
            hooks.register({
              type,
              name: `plugin:${info.name}`,
              handler: (context) =>
                ipc.request(context.event, {
                  event: context.event,
                  sessionId: context.sessionId,
                  call: context.call,
                  result: context.result,
                  payload: context.payload,
                }),
            });
          }
          this.loaded.set(info.name, { info, ipc });
        }
        this.logger.info('plugin loaded', {
          plugin: info.name,
          trust: info.trust,
          origin: info.origin,
        });
        report.loaded.push(info.name);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error('plugin failed to load', { plugin: info.name, reason });
        report.failed.push({ name: info.name, reason });
      }
    }
    return report;
  }

  async close(): Promise<void> {
    for (const { ipc } of this.loaded.values()) ipc?.close();
    this.loaded.clear();
  }
}
