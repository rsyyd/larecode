import { describe, expect, it } from 'vitest';
import { themes, type Theme } from './theme.js';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

const FOREGROUNDS = ['text', 'muted', 'accent', 'warning', 'error', 'success'] as const;
const BACKGROUNDS = ['base', 'panel'] as const;

describe('theme contrast', () => {
  for (const theme of Object.values(themes) as Theme[]) {
    it(`${theme.name} passes WCAG AA on foreground/background pairs`, () => {
      for (const foreground of FOREGROUNDS) {
        for (const background of BACKGROUNDS) {
          expect(
            contrast(theme[foreground], theme[background]),
            `${foreground} on ${background}`
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
