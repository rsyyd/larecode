import {
  AgentRuntimeLoop,
  AuditLog,
  auditPath,
  hashChainAuditSink,
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
  json?: boolean;
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
    audit: new AuditLog([hashChainAuditSink(auditPath())]),
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
  let loop: LoopLike | null = null;
  let collected = '';
  const emit = (text: string): void => {
    if (options.json) collected += text;
    else write(text);
  };
  const finish = (result: RunTaskResult): RunTaskResult => {
    if (options.json) {
      write(
        `${JSON.stringify({
          provider,
          model,
          text: collected.trimEnd(),
          usage: loop?.getUsage() ?? null,
          halt: loop?.getHaltReason() ?? null,
          verify: result.verify ?? null,
          exitCode: result.exitCode,
        })}\n`
      );
    }
    return result;
  };

  let command: string | null = null;
  let baseline: TestRun | null = null;
  if (options.verify) {
    command = (deps.detectTests ?? detectTestCommand)(cwd);
    if (!command) {
      emit(`${bad('verify:')} no test script found in ${cwd}\n`);
      return finish({ exitCode: 1 });
    }
    baseline = (deps.runTests ?? runTestCommand)(command);
    const count = parseFailures(baseline.output).length;
    emit(`${dim('verify:')} baseline ${count} failing (exit ${baseline.exitCode})\n\n`);
  }

  const createLoop = deps.createLoop ?? defaultLoop;
  loop = createLoop({ provider, model, workingDir: cwd });

  try {
    for await (const chunk of loop.run(options.task)) emit(chunk);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(`\n${bad('error:')} ${message}\n`);
    const cancelled = (error as { code?: string }).code === 'CANCELLED';
    return finish({ exitCode: cancelled ? RUN_EXIT.cancelled : RUN_EXIT.error });
  }

  const halt = loop.getHaltReason();
  if (halt && !options.json) emit(`\n${dim(`halted: ${halt}`)}\n`);

  const usage = loop.getUsage();
  if (!options.json) {
    emit(
      `\n${dim(`${model} · ${usage.totalTokens.total} tokens · $${usage.totalCost.totalCost.toFixed(4)}`)}\n`
    );
  }
  if (halt) return finish({ exitCode: RUN_EXIT.halted });

  if (!options.verify || !command || !baseline) return finish({ exitCode: 0 });

  const after = (deps.runTests ?? runTestCommand)(command);
  const report = compareRuns(baseline, after);
  if (!options.json) {
    emit('\n');
    for (const name of report.newFailures) emit(`${bad('×')} ${name}\n`);
    for (const name of report.fixedFailures) emit(`${ok('✓')} ${dim(name)}\n`);
    if (report.newFailures.length > 0) {
      emit(`${bad(`verify: ${report.newFailures.length} new failing`)}\n`);
    } else if (report.fixedFailures.length > 0) {
      emit(`${ok(`verify: ${report.fixedFailures.length} fixed`)}\n`);
    }
    emit(report.passed ? `${ok('verify: pass')}\n` : `${bad('verify: fail')}\n`);
  }
  return finish({ exitCode: report.passed ? 0 : 1, verify: report });
}
