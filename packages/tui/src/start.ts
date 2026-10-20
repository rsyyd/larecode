import { createElement } from 'react';
import { render } from 'ink';
import { App, type AppProps } from './app.js';

const ENTER_FULLSCREEN = '\x1b[?1049h\x1b[H\x1b[2J';
const LEAVE_FULLSCREEN = '\x1b[?1049l';

export async function startTui(props: AppProps): Promise<void> {
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    process.stdout.write(LEAVE_FULLSCREEN);
  };

  process.stdout.write(ENTER_FULLSCREEN);
  process.once('exit', restore);
  const instance = render(createElement(App, props));
  try {
    await instance.waitUntilExit();
  } finally {
    restore();
    process.removeListener('exit', restore);
  }
}
