import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../../src/config/index.js';
import * as fs from 'fs';
import * as path from 'path';

describe('loadConfig', () => {
  const testDir = './test-tmp';

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('returns default config when no file exists', () => {
    const config = loadConfig({ root: testDir });
    expect(config.port).toBe(5001);
    expect(config.auth.mode).toBe('none');
  });

  it('loads config from file', () => {
    const configPath = path.join(testDir, 'mock-sp.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ port: 8080 }));

    const config = loadConfig({ configFile: configPath });
    expect(config.port).toBe(8080);
  });

  it('CLI options override file config', () => {
    const configPath = path.join(testDir, 'mock-sp.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ port: 8080 }));

    const config = loadConfig({ configFile: configPath, port: 9000 });
    expect(config.port).toBe(9000);
  });
});
