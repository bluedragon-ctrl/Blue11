import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server';

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe('the MCP server', () => {
  it('lists its tools and gives instructions', async () => {
    const c = await connect();
    const names = (await c.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(['assemble', 'run', 'continue', 'step', 'state', 'memory', 'screen', 'share_link', 'help', 'examples']);
    expect(c.getInstructions()).toContain('Numbers are octal');
  });

  it('runs a program through the protocol: text and a PNG', async () => {
    const c = await connect();
    const r = await c.callTool({ name: 'run', arguments: { source: ' MOVB #16, @#SCREEN+4040\n HALT', inputs: [{ frame: 0, key: 'Space' }] } });
    const content = r.content as Array<{ type: string; text?: string; mimeType?: string }>;
    expect(content[0].text).toContain('Ended: HALT');
    expect(content.some((x) => x.type === 'image' && x.mimeType === 'image/png')).toBe(true);
    const s = await c.callTool({ name: 'state', arguments: {} });
    expect((s.content as Array<{ text: string }>)[0].text).toContain('HALTED');
  });

  it('checks arguments against the schemas', async () => {
    const c = await connect();
    const r = await c.callTool({ name: 'run', arguments: { frames: 5 } });
    expect(r.isError).toBe(true);
  });
});
