import { createElement } from 'react';
import { render } from 'ink';
import { App, type AppProps } from './app.js';

export async function startTui(props: AppProps): Promise<void> {
  const instance = render(createElement(App, props));
  await instance.waitUntilExit();
}
