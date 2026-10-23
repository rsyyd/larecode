import {
  isComplexTask,
  loadEffectiveConfig,
  parseSkillDraft,
  providersFromConfig,
  Sessions,
  transcriptOf,
  writeSkillDraft,
  type Config,
  type Session,
  type SkillDraft,
} from '@larecode/core';

export interface SkillAuthorOptions {
  provider?: string;
  model?: string;
  json?: boolean;
}

export interface SkillAuthorDeps {
  config?: Config;
  session?: Session;
  complete?: (prompt: string, options: { model: string; systemPrompt: string }) => Promise<string>;
  write?: (draft: SkillDraft) => string;
}

const SYSTEM_PROMPT =
  'You turn a finished coding session into a reusable skill. Return only a JSON object with name, description, and body. Use a lowercase hyphenated name, a one-sentence description under 140 characters that starts with "Use when", and a concise markdown body with the steps that actually worked. Do not invent commands.';

function promptFor(transcript: string): string {
  return `Summarize this session as a reusable skill.\n\nTranscript:\n${transcript}`;
}

function write(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function fail(message: string): number {
  process.stderr.write(`larecode: ${message}\n`);
  return 1;
}

export async function skillAuthorCommand(
  id: string,
  options: SkillAuthorOptions = {},
  deps: SkillAuthorDeps = {}
): Promise<number> {
  const config = deps.config ?? loadEffectiveConfig();
  const session = deps.session ?? new Sessions().get(id);
  if (!session) return fail(`session "${id}" not found`);
  if (!isComplexTask(session.messages)) {
    return fail(
      `session "${id}" is too simple to turn into a skill; it needs at least 4 turns and 3 tool calls`
    );
  }
  const provider = options.provider ?? session.metadata.provider ?? config.defaultProvider;
  const model = options.model ?? session.metadata.model ?? config.defaultModel;
  const complete =
    deps.complete ??
    ((prompt, completionOptions) => {
      const adapter = providersFromConfig(config).find((entry) => entry.name === provider);
      if (!adapter) throw new Error(`provider "${provider}" is not configured`);
      return adapter.complete(prompt, completionOptions);
    });
  try {
    const response = await complete(promptFor(transcriptOf(session.messages)), {
      model,
      systemPrompt: SYSTEM_PROMPT,
    });
    const draft = parseSkillDraft(response);
    const path = (deps.write ?? writeSkillDraft)(draft);
    if (options.json) {
      write(JSON.stringify({ name: draft.name, path }, null, 2));
    } else {
      write(`wrote ${path}`);
      write('review it, then change state: draft to state: active when ready');
    }
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
