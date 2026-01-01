import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_PATH = path.resolve(__dirname, '../src/bin/cli.ts');
const TEST_DIR = path.resolve(__dirname, '../.tmp-cli-test');

describe('CLI', () => {
  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }

    // Clean up config file
    const configPath = path.resolve(process.cwd(), 'mock-sp.config.json');
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  });

  describe('init command', () => {
    it('should create directory structure', () => {
      execSync(`npx tsx ${CLI_PATH} init ${TEST_DIR}`, { encoding: 'utf-8' });

      // Verify directory structure
      expect(fs.existsSync(path.join(TEST_DIR, 'contoso/main/Documents'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, 'contoso/main/Shared Documents'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, 'contoso/marketing/Assets'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, 'fabrikam/root/Documents'))).toBe(true);
    });

    it('should create _site.json files', () => {
      execSync(`npx tsx ${CLI_PATH} init ${TEST_DIR}`, { encoding: 'utf-8' });

      // Verify _site.json files
      const contosoSite = path.join(TEST_DIR, 'contoso/_site.json');
      expect(fs.existsSync(contosoSite)).toBe(true);

      const siteData = JSON.parse(fs.readFileSync(contosoSite, 'utf-8'));
      expect(siteData).toHaveProperty('id');
      expect(siteData).toHaveProperty('name', 'Contoso');
      expect(siteData).toHaveProperty('description');
      expect(siteData).toHaveProperty('webUrl');
    });

    it('should create _library.json files', () => {
      execSync(`npx tsx ${CLI_PATH} init ${TEST_DIR}`, { encoding: 'utf-8' });

      // Verify _library.json files
      const documentsLibrary = path.join(TEST_DIR, 'contoso/main/Documents/_library.json');
      expect(fs.existsSync(documentsLibrary)).toBe(true);

      const libraryData = JSON.parse(fs.readFileSync(documentsLibrary, 'utf-8'));
      expect(libraryData).toHaveProperty('id');
      expect(libraryData).toHaveProperty('name', 'Documents');
      expect(libraryData).toHaveProperty('description');
      expect(libraryData).toHaveProperty('template', 'documentLibrary');
    });

    it('should create Welcome.txt file', () => {
      execSync(`npx tsx ${CLI_PATH} init ${TEST_DIR}`, { encoding: 'utf-8' });

      // Verify Welcome.txt
      const welcomePath = path.join(TEST_DIR, 'contoso/main/Documents/Welcome.txt');
      expect(fs.existsSync(welcomePath)).toBe(true);

      const content = fs.readFileSync(welcomePath, 'utf-8');
      expect(content).toContain('Welcome to Mock SharePoint Server!');
      expect(content).toContain('Contoso');
      expect(content).toContain('Fabrikam');
    });

    it('should create mock-sp.config.json', () => {
      execSync(`npx tsx ${CLI_PATH} init ${TEST_DIR}`, { encoding: 'utf-8' });

      // Verify config file
      const configPath = path.resolve(process.cwd(), 'mock-sp.config.json');
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config).toHaveProperty('port', 5001);
      expect(config).toHaveProperty('root', TEST_DIR);
      expect(config).toHaveProperty('auth');
      expect(config.auth).toHaveProperty('mode', 'none');
      expect(config).toHaveProperty('database', './mock-sp.db');
      expect(config).toHaveProperty('logging', 'info');
    });
  });

  describe('--version', () => {
    it('should print version', () => {
      const output = execSync(`npx tsx ${CLI_PATH} --version`, { encoding: 'utf-8' });
      expect(output.trim()).toBe('1.0.0');
    });
  });

  describe('--help', () => {
    it('should print help with --port option', () => {
      const output = execSync(`npx tsx ${CLI_PATH} --help`, { encoding: 'utf-8' });
      expect(output).toContain('--port');
      expect(output).toContain('Server port');
      expect(output).toContain('--root');
      expect(output).toContain('--auth');
      expect(output).toContain('--database');
      expect(output).toContain('--logging');
      expect(output).toContain('--config');
    });
  });
});
