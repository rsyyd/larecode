import { Command } from 'commander';
import { VERSION } from '@lumpscode/core';
import { runDoctor } from './commands/doctor.js';
import { runCommand } from './commands/run.js';

const program = new Command();

program.name('lumpscode').description("Every agent's best, in one CLI.").version(VERSION);

program
  .command('doctor', { isDefault: false })
  .description('Check configuration, providers, permissions, and instruction files')
  .action(runDoctor);

program
  .command('run')
  .description('Run a task non-interactively and stream the result')
  .argument('<task>', 'task for the agent')
  .option('--verify', 'record a test baseline first and fail only on new test failures')
  .option('--provider <name>', 'provider to use for this run')
  .option('--model <name>', 'model to use for this run')
  .action(runCommand);

program.parseAsync(process.argv);
