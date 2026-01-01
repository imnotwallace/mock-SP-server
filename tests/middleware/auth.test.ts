import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Authentication Middleware', () => {
  const testDir = './test-auth-tmp';

  describe('mode: none', () => {
    let server: MockServer;

    beforeAll(async () => {
      fs.mkdirSync(path.join(testDir, 'data'), { recursive: true });
      server = createMockServer({
        port: 5201,
        root: path.join(testDir, 'data'),
        auth: { mode: 'none' },
        database: path.join(testDir, 'test-none.db'),
        logging: 'error'
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('allows requests without authentication', async () => {
      const response = await fetch('http://localhost:5201/v1.0/sites');
      expect(response.ok).toBe(true);
    });

    it('does not require Bearer token', async () => {
      const response = await fetch('http://localhost:5201/v1.0/sites');
      expect(response.status).not.toBe(401);
    });
  });

  describe('mode: static', () => {
    let server: MockServer;
    const validToken = 'test-static-token-12345';
    const invalidToken = 'invalid-token';

    beforeAll(async () => {
      fs.mkdirSync(path.join(testDir, 'data-static'), { recursive: true });
      server = createMockServer({
        port: 5202,
        root: path.join(testDir, 'data-static'),
        auth: { mode: 'static', tokens: [validToken] },
        database: path.join(testDir, 'test-static.db'),
        logging: 'error'
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('rejects requests without Bearer token', async () => {
      const response = await fetch('http://localhost:5202/v1.0/sites');
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error.code).toBe('unauthenticated');
    });

    it('rejects requests with invalid Bearer token', async () => {
      const response = await fetch('http://localhost:5202/v1.0/sites', {
        headers: {
          'Authorization': `Bearer ${invalidToken}`
        }
      });
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error.code).toBe('unauthenticated');
    });

    it('accepts requests with valid Bearer token', async () => {
      const response = await fetch('http://localhost:5202/v1.0/sites', {
        headers: {
          'Authorization': `Bearer ${validToken}`
        }
      });
      expect(response.ok).toBe(true);
    });

    it('allows health check without authentication', async () => {
      const response = await fetch('http://localhost:5202/health');
      expect(response.ok).toBe(true);
    });
  });

  describe('mode: oauth', () => {
    let server: MockServer;
    let oauthToken: string;

    beforeAll(async () => {
      fs.mkdirSync(path.join(testDir, 'data-oauth'), { recursive: true });
      server = createMockServer({
        port: 5203,
        root: path.join(testDir, 'data-oauth'),
        auth: { mode: 'oauth' },
        database: path.join(testDir, 'test-oauth.db'),
        logging: 'error'
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('provides /oauth/token endpoint', async () => {
      const response = await fetch('http://localhost:5203/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials&client_id=test&client_secret=test'
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('access_token');
      expect(data).toHaveProperty('token_type', 'Bearer');
      expect(data).toHaveProperty('expires_in');
      oauthToken = data.access_token;
    });

    it('rejects requests without OAuth token', async () => {
      const response = await fetch('http://localhost:5203/v1.0/sites');
      expect(response.status).toBe(401);
    });

    it('accepts requests with valid OAuth token', async () => {
      const response = await fetch('http://localhost:5203/v1.0/sites', {
        headers: {
          'Authorization': `Bearer ${oauthToken}`
        }
      });
      expect(response.ok).toBe(true);
    });

    it('provides /oauth/authorize endpoint', async () => {
      const response = await fetch('http://localhost:5203/oauth/authorize?client_id=test&response_type=code&redirect_uri=http://localhost');
      expect(response.ok).toBe(true);
    });

    it('allows /oauth/* paths without authentication', async () => {
      const response = await fetch('http://localhost:5203/oauth/authorize');
      expect(response.status).not.toBe(401);
    });
  });
});
