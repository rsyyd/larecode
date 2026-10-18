export type ThemeName = 'dark' | 'light';

export interface Theme {
  name: ThemeName;
  border: string;
  user: string;
  agent: string;
  tool: string;
  note: string;
  prompt: string;
  accent: string;
  muted: string;
}

export const themes: Record<ThemeName, Theme> = {
  dark: {
    name: 'dark',
    border: 'gray',
    user: 'cyanBright',
    agent: 'greenBright',
    tool: 'yellowBright',
    note: 'magentaBright',
    prompt: 'cyanBright',
    accent: 'blueBright',
    muted: 'gray',
  },
  light: {
    name: 'light',
    border: 'black',
    user: 'blue',
    agent: 'green',
    tool: 'yellow',
    note: 'magenta',
    prompt: 'blue',
    accent: 'blue',
    muted: 'gray',
  },
};

export function getTheme(name: ThemeName): Theme {
  return themes[name];
}
