export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  url?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class MCP {
  private servers = new Map<string, MCPServerConfig>();

  async connect(config: MCPServerConfig): Promise<void> {
    // ponytail: connection logic lands in T-14; registration only for now
    this.servers.set(config.name, config);
  }

  async disconnect(_name: string): Promise<void> {}

  async listTools(_server: string): Promise<MCPTool[]> {
    return [];
  }

  async callTool(_server: string, _tool: string, _args: unknown): Promise<unknown> {
    throw new Error('MCP tool calls arrive in T-14');
  }

  list(): string[] {
    return Array.from(this.servers.keys());
  }
}
