import { VERSION } from '@lumpscode/core';
import { AcpAgent } from '@lumpscode/sdk';

export async function acpCommand(): Promise<void> {
  const agent = new AcpAgent({ version: VERSION });
  await agent.serve();
}
