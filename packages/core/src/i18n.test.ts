import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLocale, t } from './i18n.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveLocale', () => {
  it('defaults to English and falls back on unknown values', () => {
    expect(resolveLocale()).toBe('en');
    expect(resolveLocale('fr')).toBe('en');
  });

  it('reads the locale from config and the environment', () => {
    expect(resolveLocale('id')).toBe('id');
    expect(resolveLocale('id', { LARECODE_LOCALE: 'en' })).toBe('en');
    expect(resolveLocale('en', { LARECODE_LOCALE: 'ID' })).toBe('id');
  });
});

describe('t', () => {
  it('interpolates parameters and leaves unknown placeholders intact', () => {
    expect(t('en', 'firstRun.noConfig', { path: '/tmp/config.json' })).toContain(
      'no config at /tmp/config.json'
    );
    expect(t('en', 'setup.exists', {})).toContain('{path}');
  });

  it('translates the onboarding surface to Indonesian', () => {
    expect(t('id', 'firstRun.noConfig', { path: 'x' })).toContain('tidak ada konfigurasi');
    expect(t('id', 'setup.apiKey')).toBe('API key (kosongkan untuk diisi nanti)');
    expect(t('id', 'setup.next')).not.toBe(t('en', 'setup.next'));
  });
});
