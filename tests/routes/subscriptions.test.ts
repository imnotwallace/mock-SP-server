import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import { createMockServer, MockServer } from '../../src/server.js';
import { loadConfig } from '../../src/config/index.js';
import fs from 'fs';
import path from 'path';
import http from 'http';

describe('Subscriptions API', () => {
  let mockServer: MockServer;
  let app: Express;
  let webhookServer: http.Server;
  let receivedNotifications: any[] = [];
  let validationTokens: Map<string, string> = new Map();
  const testDbPath = './test-subscriptions.db';
  const webhookPort = 9999;

  beforeAll(async () => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    const webhookApp = express();
    webhookApp.use(express.json());
    webhookApp.use(express.text());

    webhookApp.post('/webhook', (req, res) => {
      const validationToken = req.query.validationToken as string;
      if (validationToken) {
        res.status(200).send(validationToken);
      } else {
        receivedNotifications.push(req.body);
        res.status(202).send();
      }
    });

    webhookApp.post('/webhook-invalid', (req, res) => {
      const validationToken = req.query.validationToken as string;
      if (validationToken) {
        res.status(200).send('wrong-token');
      } else {
        res.status(202).send();
      }
    });

    webhookApp.post('/webhook-fail', (req, res) => {
      res.status(500).send('Server error');
    });

    await new Promise<void>((resolve) => {
      webhookServer = webhookApp.listen(webhookPort, () => {
        console.log(`Webhook server listening on port ${webhookPort}`);
        resolve();
      });
    });

    const config = await loadConfig();
    config.database = testDbPath;
    config.logging = 'error';

    mockServer = createMockServer(config);
    await mockServer.start();
    app = mockServer.app;
  });

  afterAll(async () => {
    await mockServer.stop();
    if (webhookServer) {
      await new Promise<void>((resolve, reject) => {
        webhookServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  beforeEach(() => {
    receivedNotifications = [];
    validationTokens.clear();
  });

  describe('POST /v1.0/subscriptions', () => {
    it('should create subscription with validation', async () => {
      const expirationDateTime = new Date(Date.now() + 3600000).toISOString();
      const response = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'created,updated',
          notificationUrl: `http://localhost:${webhookPort}/webhook`,
          resource: '/drives/test-drive/root',
          expirationDateTime,
          clientState: 'my-secret'
        });

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.resource).toBe('/drives/test-drive/root');
      expect(response.body.changeType).toBe('created,updated');
      expect(response.body.clientState).toBe('my-secret');
      expect(response.body.notificationUrl).toBe(`http://localhost:${webhookPort}/webhook`);
    });

    it('should fail validation for unreachable URL', async () => {
      const expirationDateTime = new Date(Date.now() + 3600000).toISOString();
      const response = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'created',
          notificationUrl: 'http://localhost:12345/nonexistent',
          resource: '/drives/test-drive/root',
          expirationDateTime
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalidRequest');
    });

    it('should fail validation for wrong token response', async () => {
      const expirationDateTime = new Date(Date.now() + 3600000).toISOString();
      const response = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'created',
          notificationUrl: `http://localhost:${webhookPort}/webhook-invalid`,
          resource: '/drives/test-drive/root',
          expirationDateTime
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalidRequest');
    });

    it('should reject missing required fields', async () => {
      const response = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'created',
          resource: '/drives/test-drive/root'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalidRequest');
    });

    it('should reject expiration too far in future', async () => {
      const expirationDateTime = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
      const response = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'created',
          notificationUrl: `http://localhost:${webhookPort}/webhook`,
          resource: '/drives/test-drive/root',
          expirationDateTime
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('30 days');
    });

    it('should reject expiration in the past', async () => {
      const expirationDateTime = new Date(Date.now() - 3600000).toISOString();
      const response = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'created',
          notificationUrl: `http://localhost:${webhookPort}/webhook`,
          resource: '/drives/test-drive/root',
          expirationDateTime
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('future');
    });
  });

  describe('GET /v1.0/subscriptions', () => {
    it('should list active subscriptions', async () => {
      const expirationDateTime = new Date(Date.now() + 3600000).toISOString();
      await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'created',
          notificationUrl: `http://localhost:${webhookPort}/webhook`,
          resource: '/drives/test1/root',
          expirationDateTime
        });

      const response = await request(app).get('/v1.0/subscriptions');

      expect(response.status).toBe(200);
      expect(response.body.value).toBeInstanceOf(Array);
      expect(response.body.value.length).toBeGreaterThan(0);
    });
  });

  describe('GET /v1.0/subscriptions/:id', () => {
    it('should get subscription by id', async () => {
      const expirationDateTime = new Date(Date.now() + 3600000).toISOString();
      const createResponse = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'updated',
          notificationUrl: `http://localhost:${webhookPort}/webhook`,
          resource: '/drives/test2/root',
          expirationDateTime,
          clientState: 'test-state'
        });

      const subscriptionId = createResponse.body.id;

      const response = await request(app).get(`/v1.0/subscriptions/${subscriptionId}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(subscriptionId);
      expect(response.body.changeType).toBe('updated');
      expect(response.body.clientState).toBe('test-state');
    });

    it('should return 404 for non-existent subscription', async () => {
      const response = await request(app).get('/v1.0/subscriptions/non-existent-id');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('itemNotFound');
    });
  });

  describe('PATCH /v1.0/subscriptions/:id', () => {
    it('should extend subscription expiration', async () => {
      const expirationDateTime = new Date(Date.now() + 3600000).toISOString();
      const createResponse = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'deleted',
          notificationUrl: `http://localhost:${webhookPort}/webhook`,
          resource: '/drives/test3/root',
          expirationDateTime
        });

      const subscriptionId = createResponse.body.id;
      const newExpiration = new Date(Date.now() + 7200000).toISOString();

      const response = await request(app)
        .patch(`/v1.0/subscriptions/${subscriptionId}`)
        .send({ expirationDateTime: newExpiration });

      expect(response.status).toBe(200);
      expect(response.body.expirationDateTime).toBe(newExpiration);
    });

    it('should reject invalid expiration update', async () => {
      const expirationDateTime = new Date(Date.now() + 3600000).toISOString();
      const createResponse = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'deleted',
          notificationUrl: `http://localhost:${webhookPort}/webhook`,
          resource: '/drives/test4/root',
          expirationDateTime
        });

      const subscriptionId = createResponse.body.id;
      const invalidExpiration = new Date(Date.now() - 1000).toISOString();

      const response = await request(app)
        .patch(`/v1.0/subscriptions/${subscriptionId}`)
        .send({ expirationDateTime: invalidExpiration });

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent subscription', async () => {
      const newExpiration = new Date(Date.now() + 7200000).toISOString();
      const response = await request(app)
        .patch('/v1.0/subscriptions/non-existent-id')
        .send({ expirationDateTime: newExpiration });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /v1.0/subscriptions/:id', () => {
    it('should remove subscription', async () => {
      const expirationDateTime = new Date(Date.now() + 3600000).toISOString();
      const createResponse = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'created',
          notificationUrl: `http://localhost:${webhookPort}/webhook`,
          resource: '/drives/test5/root',
          expirationDateTime
        });

      const subscriptionId = createResponse.body.id;

      const deleteResponse = await request(app)
        .delete(`/v1.0/subscriptions/${subscriptionId}`);

      expect(deleteResponse.status).toBe(204);

      const getResponse = await request(app)
        .get(`/v1.0/subscriptions/${subscriptionId}`);

      expect(getResponse.status).toBe(404);
    });

    it('should return 404 for non-existent subscription', async () => {
      const response = await request(app)
        .delete('/v1.0/subscriptions/non-existent-id');

      expect(response.status).toBe(404);
    });
  });
});
