import { randomBytes } from 'node:crypto';
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  Server,
  type ServerOptions,
} from '@lumpscode/server';

export interface ServeOptions {
  port?: string;
  host?: string;
  token?: string;
}

export type ServeFactory = (options: ServerOptions) => Pick<Server, 'start' | 'stop' | 'url'>;

export interface ServeDeps {
  env?: NodeJS.ProcessEnv;
  create?: ServeFactory;
  waitForShutdown?: () => Promise<void>;
  write?: (text: string) => void;
}

function waitForSignals(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

export async function serveCommand(
  options: ServeOptions = {},
  deps: ServeDeps = {}
): Promise<number> {
  const env = deps.env ?? process.env;
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const configured = options.token ?? env.LUMPSCODE_SERVER_TOKEN;
  const token = configured ?? randomBytes(24).toString('hex');
  const port = options.port === undefined ? DEFAULT_SERVER_PORT : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    write(`error: invalid port "${options.port}"\n`);
    return 1;
  }
  const host = options.host ?? DEFAULT_SERVER_HOST;
  const create: ServeFactory = deps.create ?? ((serverOptions) => new Server(serverOptions));

  let server: Pick<Server, 'start' | 'stop' | 'url'>;
  try {
    server = create({ port, host, token });
  } catch (error) {
    write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  try {
    await server.start();
  } catch (error) {
    write(
      `error: failed to start server: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }

  write(`lumpscode server listening on ${server.url}\n`);
  if (!configured) write(`bearer token: ${token}\n`);

  await (deps.waitForShutdown ?? waitForSignals)();
  await server.stop();
  return 0;
}
