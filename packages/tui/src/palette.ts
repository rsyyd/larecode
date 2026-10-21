export interface SlashCommand {
  name: string;
  description: string;
}

export const COMMANDS: SlashCommand[] = [
  { name: '/help', description: 'show keys and commands' },
  { name: '/new', description: 'start a fresh conversation' },
  { name: '/sessions', description: 'resume a saved session' },
  { name: '/status', description: 'show provider, model, and usage' },
  { name: '/clear', description: 'clear the conversation' },
  { name: '/theme', description: 'toggle dark and light' },
  { name: '/model', description: 'list or switch provider and model' },
  { name: '/context', description: 'show retrieved context and budget' },
  { name: '/exit', description: 'quit larecode' },
];

export function filterCommands(query: string, limit = 6): SlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized.startsWith('/')) return [];
  return COMMANDS.filter(
    (command) => command.name.startsWith(normalized) && command.name !== normalized
  ).slice(0, limit);
}
