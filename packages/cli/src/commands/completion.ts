const COMMANDS = [
  'acp',
  'audit',
  'chat',
  'completion',
  'cron',
  'debug',
  'doctor',
  'feedback',
  'gateway',
  'mcp',
  'run',
  'serve',
  'sessions',
  'setup',
  'update',
  'usage',
];

const SHELLS = ['bash', 'zsh', 'fish'];

function bash(): string {
  return `_larecode_completions() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${COMMANDS.join(' ')}" -- "$cur") )
    return 0
  fi
  case "$prev" in
    completion) COMPREPLY=( $(compgen -W "${SHELLS.join(' ')}" -- "$cur") ) ;;
    mcp) COMPREPLY=( $(compgen -W "add call list remove trust untrust" -- "$cur") ) ;;
    sessions) COMPREPLY=( $(compgen -W "export list prune rewind rm search show" -- "$cur") ) ;;
    cron) COMPREPLY=( $(compgen -W "add list logs remove run start" -- "$cur") ) ;;
  esac
}
complete -F _larecode_completions larecode
`;
}

function zsh(): string {
  return `#compdef larecode

_larecode() {
  local -a commands
  commands=(${COMMANDS.map((command) => `'${command}'`).join(' ')})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  fi
}

_larecode "$@"
`;
}

function fish(): string {
  const lines = COMMANDS.map(
    (command) => `complete -c larecode -n '__fish_use_subcommand' -a '${command}'`
  );
  return `${lines.join('\n')}\n`;
}

export function completionCommand(
  shell: string,
  write: (text: string) => void = (text) => process.stdout.write(text)
): number {
  const script =
    shell === 'bash' ? bash() : shell === 'zsh' ? zsh() : shell === 'fish' ? fish() : null;
  if (!script) {
    process.stderr.write(`unsupported shell: ${shell} (use bash, zsh, or fish)\n`);
    return 1;
  }
  write(script);
  return 0;
}
