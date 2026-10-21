import { Shares } from '@larecode/server';
import { Sessions, removeSessionCheckpoints } from '@larecode/core';

export function sessionsRmCommand(id: string): number {
  const sessions = new Sessions();
  if (!sessions.delete(id)) {
    process.stderr.write(`larecode: session "${id}" not found\n`);
    return 1;
  }
  const checkpoints = removeSessionCheckpoints(id);
  const shares = new Shares().removeForSession(id);
  process.stdout.write(
    `deleted session ${id} (${checkpoints} checkpoints, ${shares} share links)\n`
  );
  return 0;
}
