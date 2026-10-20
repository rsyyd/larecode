export interface SlashCommand {
  name: string;
  description: string;
}

export const COMMANDS: SlashCommand[] = [
  { name: '/help', description: 'show keys and commands' },
  { name: '/clear', description: 'clear the conversation' },
  { name: '/theme', description: 'toggle dark and light' },
  { name: '/model', description: 'list or switch provider and model' },
  { name: '/exit', description: 'quit larecode' },
];

export function filterCommands(query: string, limit = 6): SlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized.startsWith('/')) return [];
  return COMMANDS.filter(
    (command) => command.name.startsWith(normalized) && command.name !== normalized
  ).slice(0, limit);
}
