export interface AgentLoopOptions {
  provider: string;
  model: string;
  maxIterations: number;
  maxToolCalls: number;
  tokenBudget: number;
  durationBudget: number;
  abortSignal?: AbortSignal;
}

export interface AgentLoopCallbacks {
  onIterationStart?: (iteration: number) => void;
  onToolCall?: (tool: string, args: unknown) => void;
  onToolResult?: (tool: string, result: unknown) => void;
  onComplete?: (result: string) => void;
  onError?: (error: Error) => void;
}

export class AgentLoop {
  private options: AgentLoopOptions;
  private callbacks: AgentLoopCallbacks;

  constructor(options: AgentLoopOptions, callbacks: AgentLoopCallbacks = {}) {
    this.options = options;
    this.callbacks = callbacks;
  }

  async *run(_prompt: string): AsyncGenerator<string> {
    this.callbacks.onIterationStart?.(0);
    // TODO: implement agent loop
    yield 'Agent loop not yet implemented';
  }
}
