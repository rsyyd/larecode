import { createElement } from 'react';
import { render } from 'ink';
import { App, type AppProps } from './app.js';

const ENTER_FULLSCREEN = '\x1b[?1049h\x1b[H\x1b[2J';
const LEAVE_FULLSCREEN = '\x1b[?1049l';

function isWindows(): boolean {
  return process.platform === 'win32';
}

function supportsAltScreen(): boolean {
  // Windows Terminal, PowerShell 7+, and modern terminals support alt screen
  if (process.platform !== 'win32') return true;
  // Windows Terminal
  if (process.env.WT_SESSION) return true;
  // PowerShell 7+ in modern terminal
  if (process.env.PS_VERSION_TABLE && /^7\./.test(process.env.PS_VERSION_TABLE)) return true;
  // ConEmu, cmder, etc.
  if (process.env.ConEmuANSI === 'ON') return true;
  return false;
}

export async function startTui(props: AppProps): Promise<void> {
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (supportsAltScreen()) {
      process.stdout.write(LEAVE_FULLSCREEN);
    }
  };

  if (supportsAltScreen()) {
    process.stdout.write(ENTER_FULLSCREEN);
  }
  process.once('exit', restore);
  const instance = render(createElement(App, props));
  try {
    await instance.waitUntilExit();
  } finally {
    restore();
    process.removeListener('exit', restore);
  }
}
