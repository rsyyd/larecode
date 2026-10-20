export type ThemeName = 'dark' | 'light';

export interface Theme {
  name: ThemeName;
  base: string;
  panel: string;
  promptBg: string;
  text: string;
  muted: string;
  accent: string;
  warning: string;
  error: string;
  success: string;
  border: string;
}

export const themes: Record<ThemeName, Theme> = {
  dark: {
    name: 'dark',
    base: '#0a0a0a',
    panel: '#141414',
    promptBg: '#1e1e1e',
    text: '#eeeeee',
    muted: '#808080',
    accent: '#5c9cf5',
    warning: '#f5a742',
    error: '#e06c75',
    success: '#7fd88f',
    border: '#484848',
  },
  light: {
    name: 'light',
    base: '#ffffff',
    panel: '#fafafa',
    promptBg: '#f5f5f5',
    text: '#1a1a1a',
    muted: '#8a8a8a',
    accent: '#3b7dd8',
    warning: '#d68c27',
    error: '#d1383d',
    success: '#3d9a57',
    border: '#b8b8b8',
  },
};

export function getTheme(name: ThemeName): Theme {
  return themes[name];
}
