import {
  Sessions,
  createDebugBundle,
  formatUsage,
  summarizeUsage,
  writeDebugBundle,
  writeFeedback,
} from '@larecode/core';

export function usageCommand(options: { json?: boolean } = {}): number {
  const summary = summarizeUsage(new Sessions().list());
  process.stdout.write(
    `${options.json ? JSON.stringify(summary, null, 2) : formatUsage(summary)}\n`
  );
  return 0;
}

export function debugCommand(options: { json?: boolean } = {}): number {
  const bundle = createDebugBundle();
  const path = writeDebugBundle();
  process.stdout.write(
    options.json ? `${JSON.stringify({ path, bundle }, null, 2)}\n` : `debug bundle: ${path}\n`
  );
  return 0;
}

export function feedbackCommand(text: string, options: { json?: boolean } = {}): number {
  if (!text.trim()) {
    process.stderr.write('feedback text is required\n');
    return 1;
  }
  const path = writeFeedback(text);
  process.stdout.write(
    options.json
      ? `${JSON.stringify({ path }, null, 2)}\n`
      : `feedback saved: ${path}\nopen an issue: https://github.com/rsyyd/larecode/issues\n`
  );
  return 0;
}
