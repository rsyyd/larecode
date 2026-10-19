export interface SlashCommand {
  name: string;
  description: string;
}

export const COMMANDS: SlashCommand[] = [
  { name: '/help', description: 'show keys and commands' },
  { name: '/clear', description: 'clear the conversation' },
  { name: '/theme', description: 'toggle dark and light' },
  { name: '/model', description: 'switch the active model' },
  { name: '/skill', description: 'run a skill' },
  { name: '/session', description: 'manage sessions' },
  { name: '/share', description: 'share a session link' },
  { name: '/exit', description: 'quit larecode' },
];

export function filterCommands(query: string, limit = 6): SlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized.startsWith('/')) return [];
  return COMMANDS.filter(
    (command) => command.name.startsWith(normalized) && command.name !== normalized
  ).slice(0, limit);
}
