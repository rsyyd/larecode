import { describe, expect, it } from 'vitest';
import { completionCommand } from './completion.js';

function capture(shell: string): { code: number; text: string } {
  let text = '';
  const code = completionCommand(shell, (chunk) => {
    text += chunk;
  });
  return { code, text };
}

describe('shell completion', () => {
  it('prints a bash completion function', () => {
    const { code, text } = capture('bash');
    expect(code).toBe(0);
    expect(text).toContain('complete -F _larecode_completions larecode');
    expect(text).toContain('COMPREPLY');
    expect(text).toContain('trust untrust');
  });

  it('prints zsh and fish completions', () => {
    expect(capture('zsh').text).toContain('#compdef larecode');
    const fish = capture('fish').text;
    expect(fish).toContain('complete -c larecode');
    expect(fish).toContain("-a 'sessions'");
  });

  it('rejects an unknown shell', () => {
    expect(capture('powershell').code).toBe(1);
  });
});
