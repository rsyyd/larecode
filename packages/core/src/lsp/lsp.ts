export interface LSPCapabilities {
  hover: boolean;
  definitions: boolean;
  references: boolean;
  symbols: boolean;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  file: string;
  line: number;
}

export class LSP {
  private started = false;

  constructor(_command?: string) {}

  available(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    // ponytail: no server, no results — LSP arrives in T-13
    this.started = false;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  async definitions(_file: string, _line: number, _column: number): Promise<SymbolInfo[]> {
    return [];
  }

  async references(_symbol: string): Promise<SymbolInfo[]> {
    return [];
  }

  async symbols(_file: string): Promise<SymbolInfo[]> {
    return [];
  }

  async hover(_file: string, _line: number, _column: number): Promise<string | null> {
    return null;
  }
}
