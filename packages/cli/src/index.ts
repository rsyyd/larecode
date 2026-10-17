import { Command } from 'commander';
import { VERSION } from '@lumpscode/core';
import { runDoctor } from './commands/doctor.js';

const program = new Command();

program.name('lumpscode').description("Every agent's best, in one CLI.").version(VERSION);

program
  .command('doctor', { isDefault: false })
  .description('Check configuration, providers, permissions, and instruction files')
  .action(runDoctor);

program.parseAsync(process.argv);
