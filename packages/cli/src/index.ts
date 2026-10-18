import { Command } from 'commander';
import { VERSION } from '@lumpscode/core';
import { runDoctor } from './commands/doctor.js';
import { runCommand } from './commands/run.js';
import { mcpAdd, mcpCall, mcpList, mcpRemove } from './commands/mcp.js';

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

const mcp = program.command('mcp').description('Manage MCP servers and call their tools');

mcp
  .command('list')
  .description('List configured MCP servers')
  .action(async () => {
    process.exitCode = await mcpList();
  });

mcp
  .command('add')
  .description('Add or update an MCP server')
  .argument('<name>', 'server name')
  .option('--command <command>', 'stdio: executable to spawn')
  .option('--arg <value...>', 'stdio: command arguments')
  .option('--env <key=value...>', 'stdio: environment variables')
  .option('--url <url>', 'http: server URL')
  .option('--header <key=value...>', 'http: request headers')
  .action(async (name: string, options: Parameters<typeof mcpAdd>[1]) => {
    process.exitCode = await mcpAdd(name, options);
  });

mcp
  .command('remove')
  .description('Remove an MCP server')
  .argument('<name>', 'server name')
  .action(async (name: string) => {
    process.exitCode = await mcpRemove(name);
  });

mcp
  .command('call')
  .description('Call a tool on an MCP server')
  .argument('<server>', 'server name')
  .argument('<tool>', 'tool name')
  .option('--args <json>', 'tool arguments as JSON')
  .option('--yes', 'confirm the call when the permission mode requires it')
  .action(async (server: string, tool: string, options: Parameters<typeof mcpCall>[2]) => {
    process.exitCode = await mcpCall(server, tool, options);
  });

program.parseAsync(process.argv);
