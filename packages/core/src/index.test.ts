import { describe, expect, it } from 'vitest';
import * as core from './index.js';

describe('public surface', () => {
  it('does not export the tool-less AgentLoop', () => {
    expect(core).not.toHaveProperty('AgentLoop');
  });
});
