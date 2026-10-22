import { Command } from 'commander';
import { VERSION, installCrashReporter } from '@larecode/core';
import { runDoctor } from './commands/doctor.js';
import { runCommand } from './commands/run.js';
import { serveCommand } from './commands/serve.js';
import { serveMcp } from '@larecode/server';
import type { PermissionGroup } from '@larecode/core';
import { mcpAdd, mcpCall, mcpList, mcpRemove, mcpTrust, mcpUntrust } from './commands/mcp.js';
import { cronAdd, cronList, cronLogs, cronRemove, cronRun, cronStart } from './commands/cron.js';
import { gatewayCommand } from './commands/gateway.js';
import { updateCommand } from './commands/update.js';
import { setupCommand } from './commands/setup.js';
import { acpCommand } from './commands/acp.js';
import { chatCommand } from './commands/chat.js';
import { debugCommand, feedbackCommand, usageCommand } from './commands/diagnostics.js';
import { auditLogCommand, auditVerifyCommand } from './commands/audit.js';
import {
  sessionsExportCommand,
  sessionsListCommand,
  sessionsPruneCommand,
  sessionsRewindCommand,
  sessionsRmCommand,
  sessionsSearchCommand,
  sessionsShowCommand,
} from './commands/sessions.js';

const program = new Command();

program.name('larecode').description("Every agent's best, in one CLI.").version(VERSION);

program.addHelpText(
  'after',
  `
Concepts:
  session     saved transcript; resume with "larecode chat --resume <id>"
  provider    model backend from config.json (openai-compatible, anthropic, ollama, ...)
  fallback    explicit provider chain used when the primary returns no output
  permissions read, write, shell, network, browser, skills, subagent
  context     repo map, retrieval, and memory injected within a token budget
  agent       role preset: build, plan, or review; tools differ per agent
  checkpoint  local snapshot created before each tool call
`
);

program
  .command('doctor', { isDefault: false })
  .description('Check configuration, providers, models, streaming, and permissions')
  .option('--json', 'print machine-readable JSON')
  .action((options: { json?: boolean }) => runDoctor(options));

program
  .command('usage')
  .description('Show local token and cost usage across saved sessions')
  .option('--json', 'print machine-readable JSON')
  .action((options: { json?: boolean }) => {
    process.exitCode = usageCommand(options);
  });

program
  .command('debug')
  .description('Write a redacted local debug bundle')
  .option('--json', 'print machine-readable JSON')
  .action((options: { json?: boolean }) => {
    process.exitCode = debugCommand(options);
  });

program
  .command('feedback')
  .description('Save a redacted feedback report locally')
  .argument('<text>', 'feedback text')
  .option('--json', 'print machine-readable JSON')
  .action((text: string, options: { json?: boolean }) => {
    process.exitCode = feedbackCommand(text, options);
  });

program
  .command('acp')
  .description('Speak Agent Client Protocol over stdio for editors such as Zed')
  .action(acpCommand);

program
  .command('setup')
  .description('Write an initial config for your provider')
  .option('--provider <name>', 'provider name')
  .option('--type <type>', 'openai-compatible, anthropic, ollama, openrouter, zai, or custom')
  .option('--base-url <url>', 'provider base url')
  .option('--api-key <key>', 'api key for the provider')
  .option('--model <model>', 'default model')
  .option('--force', 'overwrite an existing config')
  .action(async (options: Parameters<typeof setupCommand>[0]) => {
    await setupCommand(options);
  });

program
  .command('update')
  .description('Check for a newer larecode release')
  .option('--check', 'report without upgrade instructions')
  .action(async (options: { check?: boolean }) => {
    await updateCommand(options);
  });

program
  .command('serve')
  .description('Serve the HTTP API with SSE streaming')
  .option('--port <port>', 'port to listen on')
  .option('--host <host>', 'host to bind')
  .option('--token <token>', 'bearer token (default: LARECODE_SERVER_TOKEN or generated)')
  .action(async (options: Parameters<typeof serveCommand>[0]) => {
    process.exitCode = await serveCommand(options);
  });

program
  .command('gateway')
  .description('Serve tasks from a messaging platform (Telegram)')
  .option('--platform <name>', 'platform to connect (telegram)', 'telegram')
  .option('--token <token>', 'bot token (default: LARECODE_TELEGRAM_TOKEN)')
  .option('--chat <id>', 'only serve this chat id (default: LARECODE_TELEGRAM_CHAT_ID)')
  .option('--allow <groups>', 'comma-separated permission groups pre-authorized for gateway tasks')
  .action(async (options: Parameters<typeof gatewayCommand>[0]) => {
    process.exitCode = await gatewayCommand(options);
  });

program
  .command('chat')
  .description('Start the interactive terminal UI')
  .option('--provider <name>', 'provider to use')
  .option('--model <name>', 'model to use')
  .option('--resume <id>', 'resume a saved session')
  .action(async (options: { provider?: string; model?: string; resume?: string }) => {
    process.exitCode = await chatCommand(options);
  });

const sessions = program.command('sessions').description('Manage saved chat sessions');

sessions
  .command('list')
  .description('List saved sessions')
  .option('--json', 'print JSON')
  .action((options: { json?: boolean }) => {
    process.exitCode = sessionsListCommand(options);
  });

sessions
  .command('show')
  .description('Show a session transcript')
  .argument('<id>', 'session id')
  .option('--json', 'print JSON')
  .action((id: string, options: { json?: boolean }) => {
    process.exitCode = sessionsShowCommand(id, options);
  });

sessions
  .command('search')
  .description('Search session transcripts')
  .argument('<query>', 'search terms')
  .option('--json', 'print JSON')
  .option('--limit <n>', 'maximum hits')
  .action((query: string, options: { json?: boolean; limit?: string }) => {
    process.exitCode = sessionsSearchCommand(query, {
      json: options.json,
      limit: options.limit === undefined ? undefined : Number.parseInt(options.limit, 10),
    });
  });

sessions
  .command('export')
  .description('Export a redacted session')
  .argument('<id>', 'session id')
  .option('--format <format>', 'json or markdown', 'json')
  .action((id: string, options: { format?: string }) => {
    process.exitCode = sessionsExportCommand(id, options);
  });

sessions
  .command('rewind')
  .description('Truncate a session transcript to an earlier message count')
  .argument('<id>', 'session id')
  .argument('<count>', 'number of messages to keep')
  .option('--yes', 'confirm dropping later messages')
  .action((id: string, count: string, options: { yes?: boolean }) => {
    process.exitCode = sessionsRewindCommand(id, count, options.yes);
  });

sessions
  .command('prune')
  .description('Delete old sessions by age and/or keep count')
  .option('--older-than <days>', 'delete sessions older than this many days')
  .option('--keep <count>', 'keep only the newest count')
  .option('--json', 'print JSON')
  .action((options: { olderThan?: string; keep?: string; json?: boolean }) => {
    process.exitCode = sessionsPruneCommand(options);
  });

sessions
  .command('rm')
  .description('Delete a session and its checkpoints and share links')
  .argument('<id>', 'session id')
  .action((id: string) => {
    process.exitCode = sessionsRmCommand(id);
  });

program
  .command('run')
  .description('Run a task non-interactively and stream the result')
  .argument('<task>', 'task for the agent')
  .option('--verify', 'record a test baseline first and fail only on new test failures')
  .option('--provider <name>', 'provider to use for this run')
  .option('--model <name>', 'model to use for this run')
  .option('--json', 'emit a single JSON result object instead of streaming')
  .action(runCommand);

program
  .command('audit')
  .description('Inspect and verify the local audit log')
  .option('--verify', 'verify the hash chain')
  .option('--json', 'print machine-readable JSON')
  .option('--limit <n>', 'show only the newest entries')
  .action((options: { verify?: boolean; json?: boolean; limit?: string }) => {
    const limit = options.limit === undefined ? undefined : Number.parseInt(options.limit, 10);
    process.exitCode = options.verify
      ? auditVerifyCommand(options)
      : auditLogCommand({ json: options.json, limit });
  });

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
  .option('--allow-private', 'http: allow a private or loopback address')
  .action(async (name: string | undefined, options: Parameters<typeof mcpAdd>[1]) => {
    process.exitCode = await mcpAdd(name, options);
  });

mcp
  .command('trust')
  .description('Trust the current command/URL/headers/env of an MCP server')
  .argument('<name>', 'server name')
  .action(async (name: string) => {
    process.exitCode = await mcpTrust(name);
  });

mcp
  .command('untrust')
  .description('Revoke trust for an MCP server')
  .argument('<name>', 'server name')
  .action(async (name: string) => {
    process.exitCode = await mcpUntrust(name);
  });

mcp
  .command('remove')
  .description('Remove an MCP server')
  .argument('<name>', 'server name')
  .action(async (name: string) => {
    process.exitCode = await mcpRemove(name);
  });

mcp
  .command('serve')
  .description('Expose larecode tools as an MCP server over stdio for editors and other agents')
  .option(
    '--allow <groups>',
    'comma-separated permission groups to pre-authorize (read is always on)'
  )
  .option('--cwd <path>', 'working directory for tool execution')
  .action(async (options: { allow?: string; cwd?: string }) => {
    const allow = (options.allow ?? '')
      .split(',')
      .map((group) => group.trim())
      .filter((group) => group.length > 0) as PermissionGroup[];
    try {
      await serveMcp({ allow, cwd: options.cwd });
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
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
  .option('--retries <n>', 'retry failed runs up to n times (max 5)')
  .option('--timeout <ms>', 'abort a run after this many milliseconds')
  .action(
    (
      schedule: string,
      prompt: string[],
      options: { name?: string; allow?: string; retries?: string; timeout?: string }
    ) => {
      process.exitCode = cronAdd({
        schedule,
        prompt,
        name: options.name,
        allow: options.allow,
        retries: options.retries,
        timeout: options.timeout,
      });
    }
  );

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
  .command('logs')
  .description('Show the last result and log for a job')
  .argument('<id>', 'job id')
  .option('--json', 'print JSON')
  .action((id: string, options: { json?: boolean }) => {
    process.exitCode = cronLogs(id, options);
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

program.action(async () => {
  process.exitCode = await chatCommand();
});

installCrashReporter();
program.parseAsync(process.argv);
