import { VERSION } from '@larecode/core';
import { AcpAgent } from '@larecode/sdk';

export async function acpCommand(): Promise<void> {
  const agent = new AcpAgent({ version: VERSION });
  await agent.serve();
}
