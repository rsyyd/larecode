export type Locale = 'en' | 'id';

export const LOCALES: Locale[] = ['en', 'id'];

export function resolveLocale(
  configured?: string,
  env: { LARECODE_LOCALE?: string } = process.env
): Locale {
  const raw = (env.LARECODE_LOCALE ?? configured ?? 'en').toLowerCase();
  return raw === 'id' ? 'id' : 'en';
}

const MESSAGES = {
  en: {
    'firstRun.noConfig':
      'larecode: no config at {path}; using built-in defaults. Run `larecode setup` to choose a provider.',
    'setup.exists': '{path} already exists (use --force to overwrite)',
    'setup.provider': 'Provider {options}',
    'setup.baseUrl': 'Base URL',
    'setup.model': 'Model',
    'setup.apiKey': 'API key (leave empty to set later)',
    'setup.invalid': 'invalid configuration',
    'setup.wrote': 'wrote {path}',
    'setup.providerLabel': 'provider',
    'setup.baseUrlLabel': 'base url',
    'setup.modelLabel': 'model',
    'setup.next': 'next: larecode doctor && larecode run "explain this repository"',
  },
  id: {
    'firstRun.noConfig':
      'larecode: tidak ada konfigurasi di {path}; memakai bawaan. Jalankan `larecode setup` untuk memilih provider.',
    'setup.exists': '{path} sudah ada (gunakan --force untuk menimpa)',
    'setup.provider': 'Provider {options}',
    'setup.baseUrl': 'Base URL',
    'setup.model': 'Model',
    'setup.apiKey': 'API key (kosongkan untuk diisi nanti)',
    'setup.invalid': 'konfigurasi tidak valid',
    'setup.wrote': 'menulis {path}',
    'setup.providerLabel': 'provider',
    'setup.baseUrlLabel': 'base url',
    'setup.modelLabel': 'model',
    'setup.next': 'lanjut: larecode doctor && larecode run "jelaskan repositori ini"',
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)['en'];

export function t(
  locale: Locale,
  key: MessageKey,
  params: Record<string, string | number> = {}
): string {
  const template = MESSAGES[locale][key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}
