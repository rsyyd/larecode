import { Command } from 'commander';
import { VERSION } from '@lumpscode/core';
import { runDoctor } from './commands/doctor.js';
import { runCommand } from './commands/run.js';
import { serveCommand } from './commands/serve.js';
import { mcpAdd, mcpCall, mcpList, mcpRemove } from './commands/mcp.js';
import { cronAdd, cronList, cronRemove, cronRun, cronStart } from './commands/cron.js';
import { gatewayCommand } from './commands/gateway.js';
import { updateCommand } from './commands/update.js';
import { setupCommand } from './commands/setup.js';

const program = new Command();

program.name('lumpscode').description("Every agent's best, in one CLI.").version(VERSION);

program
  .command('doctor', { isDefault: false })
  .description('Check configuration, providers, permissions, and instruction files')
  .action(runDoctor);

program
  .command('setup')
  .description('Write an initial config for your provider')
  .option('--provider <name>', 'provider name')
  .option('--type <type>', 'openai-compatible, anthropic, or ollama')
  .option('--base-url <url>', 'provider base url')
  .option('--api-key <key>', 'api key for the provider')
  .option('--model <model>', 'default model')
  .option('--force', 'overwrite an existing config')
  .action(async (options: Parameters<typeof setupCommand>[0]) => {
    await setupCommand(options);
  });

program
  .command('update')
  .description('Check for a newer lumpscode release')
  .option('--check', 'report without upgrade instructions')
  .action(async (options: { check?: boolean }) => {
    await updateCommand(options);
  });

program
  .command('serve')
  .description('Serve the HTTP API with SSE streaming')
  .option('--port <port>', 'port to listen on')
  .option('--host <host>', 'host to bind')
  .option('--token <token>', 'bearer token (default: LUMPSCODE_SERVER_TOKEN or generated)')
  .action(async (options: Parameters<typeof serveCommand>[0]) => {
    process.exitCode = await serveCommand(options);
  });

program
  .command('gateway')
  .description('Serve tasks from a messaging platform (Telegram)')
  .option('--platform <name>', 'platform to connect (telegram)', 'telegram')
  .option('--token <token>', 'bot token (default: LUMPSCODE_TELEGRAM_TOKEN)')
  .option('--chat <id>', 'only serve this chat id (default: LUMPSCODE_TELEGRAM_CHAT_ID)')
  .option('--allow <groups>', 'comma-separated permission groups pre-authorized for gateway tasks')
  .action(async (options: Parameters<typeof gatewayCommand>[0]) => {
    process.exitCode = await gatewayCommand(options);
  });

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
  .argument('[name]', 'server name (defaults to the preset name)')
  .option('--preset <preset>', 'preset server (context7, playwright, serena)')
  .option('--command <command>', 'stdio: executable to spawn')
  .option('--arg <value...>', 'stdio: command arguments')
  .option('--env <key=value...>', 'stdio: environment variables')
  .option('--url <url>', 'http: server URL')
  .option('--header <key=value...>', 'http: request headers')
  .action(async (name: string | undefined, options: Parameters<typeof mcpAdd>[1]) => {
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

const cron = program.command('cron').description('Scheduled unattended tasks');

cron
  .command('add')
  .description(
    'Add a cron job ("every 30 minutes", "daily at 09:00", "weekdays at 9am", or a 5-field cron)'
  )
  .argument('<schedule>', 'schedule expression')
  .argument('<prompt...>', 'task for the agent')
  .option('--name <name>', 'job name')
  .option('--allow <groups>', 'comma-separated permission groups pre-authorized for this job')
  .action((schedule: string, prompt: string[], options: { name?: string; allow?: string }) => {
    process.exitCode = cronAdd({ schedule, prompt, name: options.name, allow: options.allow });
  });

cron
  .command('list')
  .description('List cron jobs with their next run and last result')
  .action(() => {
    process.exitCode = cronList();
  });

cron
  .command('remove')
  .description('Remove a cron job')
  .argument('<id>', 'job id')
  .action((id: string) => {
    process.exitCode = cronRemove(id);
  });

cron
  .command('run')
  .description('Run a job now, unattended')
  .argument('<id>', 'job id')
  .action(async (id: string) => {
    process.exitCode = await cronRun(id);
  });

cron
  .command('start')
  .description('Run due jobs on their schedule until interrupted')
  .action(async () => {
    process.exitCode = await cronStart();
  });

program.parseAsync(process.argv);
