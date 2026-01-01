import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../src/server.js';
import * as fs from 'fs';
import * as path from 'path';

describe('MockServer', () => {
  const testDir = './test-tmp';
  let server: MockServer;

  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, 'data/contoso/main/Documents'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'data/contoso/main/Documents/test.txt'), 'hello');

    server = createMockServer({
      port: 5099,
      root: path.join(testDir, 'data'),
      auth: { mode: 'none' },
      database: path.join(testDir, 'test.db'),
      logging: 'error'
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('responds to health check', async () => {
    const response = await fetch('http://localhost:5099/health');
    expect(response.ok).toBe(true);
  });

  it('returns OData-formatted response for sites', async () => {
    const response = await fetch('http://localhost:5099/v1.0/sites');
    const data = await response.json();
    expect(data).toHaveProperty('@odata.context');
    expect(data).toHaveProperty('value');
    expect(Array.isArray(data.value)).toBe(true);
  });

  it('returns 404 for unknown routes', async () => {
    const response = await fetch('http://localhost:5099/v1.0/unknown');
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toHaveProperty('code');
  });
});
