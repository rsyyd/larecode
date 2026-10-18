import { runTask, type RunTaskOptions } from '../run.js';

export async function runCommand(task: string, options: RunTaskOptions): Promise<void> {
  const result = await runTask({ ...options, task });
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
