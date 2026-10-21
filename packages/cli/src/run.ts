import {
  AgentRuntimeLoop,
  loadEffectiveConfig,
  type HaltReason,
  type UsageAggregate,
} from '@larecode/core';
import {
  compareRuns,
  detectTestCommand,
  parseFailures,
  runTestCommand,
  type TestRun,
  type VerifyReport,
} from './verify.js';

export interface RunTaskOptions {
  task: string;
  verify?: boolean;
  provider?: string;
  model?: string;
}

export interface LoopLike {
  run(prompt: string): AsyncGenerator<string>;
  getUsage(): UsageAggregate;
  getHaltReason(): HaltReason | null;
}

export interface RunTaskDeps {
  cwd?: string;
  createLoop?: (options: { provider: string; model: string; workingDir: string }) => LoopLike;
  runTests?: (command: string) => TestRun;
  detectTests?: (cwd: string) => string | null;
  write?: (text: string) => void;
}

export interface RunTaskResult {
  exitCode: number;
  verify?: VerifyReport;
}

export const RUN_EXIT = {
  success: 0,
  error: 1,
  halted: 3,
  cancelled: 130,
} as const;

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const bad = (text: string) => `\x1b[31m${text}\x1b[0m`;
const ok = (text: string) => `\x1b[32m${text}\x1b[0m`;

function defaultLoop(options: { provider: string; model: string; workingDir: string }): LoopLike {
  return new AgentRuntimeLoop({
    provider: options.provider,
    model: options.model,
    workingDir: options.workingDir,
    agent: 'build',
    maxIterations: 40,
    maxToolCalls: 200,
    tokenBudget: 200_000,
    durationBudget: 600_000,
  });
}

export async function runTask(
  options: RunTaskOptions,
  deps: RunTaskDeps = {}
): Promise<RunTaskResult> {
  const cwd = deps.cwd ?? process.cwd();
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const config = loadEffectiveConfig(cwd);
  const provider = options.provider ?? config.defaultProvider;
  const model = options.model ?? config.defaultModel;

  let command: string | null = null;
  let baseline: TestRun | null = null;
  if (options.verify) {
    command = (deps.detectTests ?? detectTestCommand)(cwd);
    if (!command) {
      write(`${bad('verify:')} no test script found in ${cwd}\n`);
      return { exitCode: 1 };
    }
    baseline = (deps.runTests ?? runTestCommand)(command);
    const count = parseFailures(baseline.output).length;
    write(`${dim('verify:')} baseline ${count} failing (exit ${baseline.exitCode})\n\n`);
  }

  const createLoop = deps.createLoop ?? defaultLoop;
  const loop = createLoop({ provider, model, workingDir: cwd });

  try {
    for await (const chunk of loop.run(options.task)) write(chunk);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(`\n${bad('error:')} ${message}\n`);
    const cancelled = (error as { code?: string }).code === 'CANCELLED';
    return { exitCode: cancelled ? RUN_EXIT.cancelled : RUN_EXIT.error };
  }

  const halt = loop.getHaltReason();
  if (halt) write(`\n${dim(`halted: ${halt}`)}\n`);

  const usage = loop.getUsage();
  write(
    `\n${dim(`${model} · ${usage.totalTokens.total} tokens · $${usage.totalCost.totalCost.toFixed(4)}`)}\n`
  );
  if (halt) return { exitCode: RUN_EXIT.halted };

  if (!options.verify || !command || !baseline) return { exitCode: 0 };

  const after = (deps.runTests ?? runTestCommand)(command);
  const report = compareRuns(baseline, after);
  write('\n');
  for (const name of report.newFailures) write(`${bad('×')} ${name}\n`);
  for (const name of report.fixedFailures) write(`${ok('✓')} ${dim(name)}\n`);
  if (report.newFailures.length > 0) {
    write(`${bad(`verify: ${report.newFailures.length} new failing`)}\n`);
  } else if (report.fixedFailures.length > 0) {
    write(`${ok(`verify: ${report.fixedFailures.length} fixed`)}\n`);
  }
  write(report.passed ? `${ok('verify: pass')}\n` : `${bad('verify: fail')}\n`);
  return { exitCode: report.passed ? 0 : 1, verify: report };
}
