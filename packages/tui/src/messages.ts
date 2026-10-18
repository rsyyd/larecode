export type MessageRole = 'user' | 'agent' | 'tool' | 'note';

export interface ChatMessage {
  role: MessageRole;
  text: string;
}

export function appendChunk(messages: ChatMessage[], chunk: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'agent') {
    return [...messages, { role: 'agent', text: chunk }];
  }
  const updated = [...messages];
  updated[updated.length - 1] = { ...last, text: last.text + chunk };
  return updated;
}
