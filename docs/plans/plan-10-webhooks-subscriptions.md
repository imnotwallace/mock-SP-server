# Plan 10: Webhooks/Subscriptions

## Overview

Implement webhook subscriptions for change notifications. Clients can subscribe to resource changes and receive HTTP callbacks when changes occur.

## References

- [Change notifications overview](https://learn.microsoft.com/en-us/graph/change-notifications-overview)
- [Webhook delivery](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)
- [Create subscription](https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions?view=graph-rest-1.0)
- [Lifecycle notifications](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events)

## Current State

- No subscription management
- No webhook delivery
- Changes are not tracked (will depend on Plan 03 - Delta Queries)

## API Specifications

### Create Subscription

**Endpoint:** `POST /subscriptions`

**Request Body:**
```json
{
  "changeType": "created,updated,deleted",
  "notificationUrl": "https://webhook.example.com/api/notifications",
  "resource": "/drives/{drive-id}/root",
  "expirationDateTime": "2024-01-20T12:00:00Z",
  "clientState": "secret-client-state"
}
```

**Response:**
```json
{
  "id": "subscription-id",
  "resource": "/drives/{drive-id}/root",
  "applicationId": "app-id",
  "changeType": "created,updated,deleted",
  "clientState": "secret-client-state",
  "notificationUrl": "https://webhook.example.com/api/notifications",
  "expirationDateTime": "2024-01-20T12:00:00Z",
  "creatorId": "user-id"
}
```

### Validation Handshake

When creating a subscription, Graph validates the endpoint by sending:

```
POST https://webhook.example.com/api/notifications?validationToken=abc123
```

Endpoint must respond with `200 OK` and the `validationToken` as plain text body.

### Notification Payload

```json
{
  "value": [
    {
      "subscriptionId": "subscription-id",
      "subscriptionExpirationDateTime": "2024-01-20T12:00:00Z",
      "changeType": "updated",
      "resource": "drives/{drive-id}/items/{item-id}",
      "resourceData": {
        "@odata.type": "#microsoft.graph.driveItem",
        "@odata.id": "drives/{drive-id}/items/{item-id}",
        "id": "item-id"
      },
      "clientState": "secret-client-state",
      "tenantId": "tenant-id"
    }
  ]
}
```

### List Subscriptions

**Endpoint:** `GET /subscriptions`

### Get Subscription

**Endpoint:** `GET /subscriptions/{id}`

### Update Subscription

**Endpoint:** `PATCH /subscriptions/{id}`

**Request Body:**
```json
{
  "expirationDateTime": "2024-01-25T12:00:00Z"
}
```

### Delete Subscription

**Endpoint:** `DELETE /subscriptions/{id}`

## Implementation Steps

### Step 1: Create Subscriptions Schema

Update `src/services/database.ts`:

```sql
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  resource TEXT NOT NULL,
  change_types TEXT NOT NULL,  -- JSON array: ["created","updated","deleted"]
  notification_url TEXT NOT NULL,
  expiration_date_time TEXT NOT NULL,
  client_state TEXT,
  application_id TEXT,
  creator_id TEXT,
  include_resource_data BOOLEAN DEFAULT FALSE,
  lifecycle_notification_url TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_subscriptions_resource ON subscriptions(resource);
CREATE INDEX idx_subscriptions_expiration ON subscriptions(expiration_date_time);

-- Pending notifications queue
CREATE TABLE IF NOT EXISTS notification_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_data TEXT,  -- JSON
  created_at TEXT NOT NULL,
  delivered BOOLEAN DEFAULT FALSE,
  delivery_attempts INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX idx_notification_queue_pending ON notification_queue(delivered, created_at);
```

### Step 2: Create Subscription Service

Create `src/services/subscriptions.ts`:

```typescript
import axios from 'axios';

interface Subscription {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState?: string;
  applicationId?: string;
  creatorId?: string;
  includeResourceData?: boolean;
  lifecycleNotificationUrl?: string;
}

interface Notification {
  subscriptionId: string;
  subscriptionExpirationDateTime: string;
  changeType: string;
  resource: string;
  resourceData?: {
    '@odata.type': string;
    '@odata.id': string;
    id: string;
  };
  clientState?: string;
  tenantId: string;
}

export class SubscriptionService {
  private readonly MAX_EXPIRATION_DAYS = 30;
  private readonly VALIDATION_TIMEOUT_MS = 10000;

  constructor(private db: DatabaseService) {}

  async createSubscription(
    params: Omit<Subscription, 'id'>
  ): Promise<Subscription> {
    // Validate expiration
    const expiration = new Date(params.expirationDateTime);
    const maxExpiration = new Date(Date.now() + this.MAX_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

    if (expiration > maxExpiration) {
      throw GraphError.badRequest(
        `Expiration cannot exceed ${this.MAX_EXPIRATION_DAYS} days`
      );
    }

    // Validate notification URL
    await this.validateNotificationUrl(params.notificationUrl);

    // Create subscription
    const id = generateId();
    const changeTypes = params.changeType.split(',').map(t => t.trim());

    this.db.prepare(`
      INSERT INTO subscriptions (
        id, resource, change_types, notification_url, expiration_date_time,
        client_state, application_id, creator_id, include_resource_data,
        lifecycle_notification_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.resource,
      JSON.stringify(changeTypes),
      params.notificationUrl,
      params.expirationDateTime,
      params.clientState || null,
      params.applicationId || null,
      params.creatorId || null,
      params.includeResourceData || false,
      params.lifecycleNotificationUrl || null,
      new Date().toISOString()
    );

    return this.getSubscription(id)!;
  }

  async getSubscription(id: string): Promise<Subscription | null> {
    const row = this.db.prepare(`
      SELECT * FROM subscriptions WHERE id = ?
    `).get(id);

    if (!row) return null;

    return this.formatSubscription(row);
  }

  async listSubscriptions(): Promise<Subscription[]> {
    const rows = this.db.prepare(`
      SELECT * FROM subscriptions
      WHERE expiration_date_time > datetime('now')
      ORDER BY created_at DESC
    `).all();

    return rows.map(this.formatSubscription);
  }

  async updateSubscription(
    id: string,
    updates: { expirationDateTime?: string }
  ): Promise<Subscription> {
    const subscription = await this.getSubscription(id);
    if (!subscription) {
      throw GraphError.notFound('Subscription not found');
    }

    if (updates.expirationDateTime) {
      const expiration = new Date(updates.expirationDateTime);
      const maxExpiration = new Date(Date.now() + this.MAX_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

      if (expiration > maxExpiration) {
        throw GraphError.badRequest(
          `Expiration cannot exceed ${this.MAX_EXPIRATION_DAYS} days`
        );
      }

      this.db.prepare(`
        UPDATE subscriptions SET expiration_date_time = ? WHERE id = ?
      `).run(updates.expirationDateTime, id);
    }

    return this.getSubscription(id)!;
  }

  async deleteSubscription(id: string): Promise<void> {
    const result = this.db.prepare(`
      DELETE FROM subscriptions WHERE id = ?
    `).run(id);

    if (result.changes === 0) {
      throw GraphError.notFound('Subscription not found');
    }
  }

  async queueNotification(
    resource: string,
    changeType: 'created' | 'updated' | 'deleted',
    itemId: string,
    resourceData?: object
  ): Promise<void> {
    // Find matching subscriptions
    const subscriptions = this.db.prepare(`
      SELECT * FROM subscriptions
      WHERE expiration_date_time > datetime('now')
      AND (
        resource = ?
        OR ? LIKE resource || '%'
      )
    `).all(resource, resource);

    for (const sub of subscriptions) {
      const changeTypes = JSON.parse(sub.change_types);
      if (!changeTypes.includes(changeType)) continue;

      this.db.prepare(`
        INSERT INTO notification_queue (
          subscription_id, change_type, resource, resource_data, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        sub.id,
        changeType,
        resource,
        sub.include_resource_data && resourceData ? JSON.stringify(resourceData) : null,
        new Date().toISOString()
      );
    }
  }

  async deliverPendingNotifications(): Promise<number> {
    const pending = this.db.prepare(`
      SELECT nq.*, s.notification_url, s.client_state, s.expiration_date_time
      FROM notification_queue nq
      JOIN subscriptions s ON nq.subscription_id = s.id
      WHERE nq.delivered = FALSE
      AND nq.delivery_attempts < 3
      ORDER BY nq.created_at
      LIMIT 100
    `).all();

    let delivered = 0;

    // Group by notification URL for batching
    const grouped = new Map<string, any[]>();
    for (const notification of pending) {
      const url = notification.notification_url;
      if (!grouped.has(url)) grouped.set(url, []);
      grouped.get(url)!.push(notification);
    }

    for (const [url, notifications] of grouped) {
      try {
        await this.deliverNotifications(url, notifications);
        delivered += notifications.length;

        // Mark as delivered
        const ids = notifications.map(n => n.id);
        this.db.prepare(`
          UPDATE notification_queue SET delivered = TRUE WHERE id IN (${ids.map(() => '?').join(',')})
        `).run(...ids);
      } catch (error) {
        // Mark attempt
        const ids = notifications.map(n => n.id);
        this.db.prepare(`
          UPDATE notification_queue
          SET delivery_attempts = delivery_attempts + 1, last_attempt_at = ?
          WHERE id IN (${ids.map(() => '?').join(',')})
        `).run(new Date().toISOString(), ...ids);
      }
    }

    return delivered;
  }

  private async validateNotificationUrl(url: string): Promise<void> {
    const validationToken = crypto.randomBytes(32).toString('base64url');

    try {
      const response = await axios.post(
        `${url}?validationToken=${encodeURIComponent(validationToken)}`,
        null,
        {
          timeout: this.VALIDATION_TIMEOUT_MS,
          validateStatus: (status) => status === 200
        }
      );

      if (response.data !== validationToken) {
        throw new Error('Validation token mismatch');
      }
    } catch (error) {
      throw GraphError.badRequest(
        'Subscription validation failed. Ensure the notificationUrl returns the validationToken.'
      );
    }
  }

  private async deliverNotifications(url: string, notifications: any[]): Promise<void> {
    const payload: Notification[] = notifications.map(n => ({
      subscriptionId: n.subscription_id,
      subscriptionExpirationDateTime: n.expiration_date_time,
      changeType: n.change_type,
      resource: n.resource,
      resourceData: n.resource_data ? JSON.parse(n.resource_data) : undefined,
      clientState: n.client_state,
      tenantId: 'mock-tenant-id'
    }));

    await axios.post(url, { value: payload }, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  private formatSubscription(row: any): Subscription {
    return {
      id: row.id,
      resource: row.resource,
      changeType: JSON.parse(row.change_types).join(','),
      notificationUrl: row.notification_url,
      expirationDateTime: row.expiration_date_time,
      clientState: row.client_state,
      applicationId: row.application_id,
      creatorId: row.creator_id,
      includeResourceData: row.include_resource_data,
      lifecycleNotificationUrl: row.lifecycle_notification_url
    };
  }
}
```

### Step 3: Create Subscription Routes

Create `src/routes/subscriptions.ts`:

```typescript
import { Router } from 'express';
import { SubscriptionService } from '../services/subscriptions';

const router = Router();

// POST /subscriptions
router.post('/', async (req, res) => {
  const {
    changeType,
    notificationUrl,
    resource,
    expirationDateTime,
    clientState,
    includeResourceData,
    lifecycleNotificationUrl
  } = req.body;

  if (!changeType || !notificationUrl || !resource || !expirationDateTime) {
    throw GraphError.badRequest(
      'changeType, notificationUrl, resource, and expirationDateTime are required'
    );
  }

  const subscription = await subscriptionService.createSubscription({
    changeType,
    notificationUrl,
    resource,
    expirationDateTime,
    clientState,
    includeResourceData,
    lifecycleNotificationUrl
  });

  res.status(201).json(subscription);
});

// GET /subscriptions
router.get('/', async (req, res) => {
  const subscriptions = await subscriptionService.listSubscriptions();
  res.json({ value: subscriptions });
});

// GET /subscriptions/:id
router.get('/:id', async (req, res) => {
  const subscription = await subscriptionService.getSubscription(req.params.id);
  if (!subscription) {
    throw GraphError.notFound('Subscription not found');
  }
  res.json(subscription);
});

// PATCH /subscriptions/:id
router.patch('/:id', async (req, res) => {
  const { expirationDateTime } = req.body;

  const subscription = await subscriptionService.updateSubscription(
    req.params.id,
    { expirationDateTime }
  );

  res.json(subscription);
});

// DELETE /subscriptions/:id
router.delete('/:id', async (req, res) => {
  await subscriptionService.deleteSubscription(req.params.id);
  res.status(204).end();
});

export { router as subscriptionsRouter };
```

### Step 4: Integrate with Change Tracking

Update item mutations to queue notifications:

```typescript
// In database.ts or item mutation handlers
async function createItem(item: CreateItemParams): Promise<DbItem> {
  // ... existing create logic ...

  // Queue notification
  await subscriptionService.queueNotification(
    `/drives/${driveId}/items/${item.id}`,
    'created',
    item.id,
    formatDriveItem(item)
  );

  return result;
}

async function updateItem(id: string, updates: UpdateItemParams): Promise<void> {
  // ... existing update logic ...

  await subscriptionService.queueNotification(
    `/drives/${driveId}/items/${id}`,
    'updated',
    id,
    formatDriveItem(item)
  );
}

async function deleteItem(id: string): Promise<void> {
  const item = await getItem(id);
  // ... existing delete logic ...

  await subscriptionService.queueNotification(
    `/drives/${driveId}/items/${id}`,
    'deleted',
    id
  );
}
```

### Step 5: Add Notification Delivery Worker

```typescript
// In server.ts or separate worker
class NotificationWorker {
  private intervalId?: NodeJS.Timeout;

  constructor(private subscriptionService: SubscriptionService) {}

  start(intervalMs: number = 5000): void {
    this.intervalId = setInterval(async () => {
      try {
        const delivered = await this.subscriptionService.deliverPendingNotifications();
        if (delivered > 0) {
          logger.debug(`Delivered ${delivered} notifications`);
        }
      } catch (error) {
        logger.error('Notification delivery error:', error);
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}

// Start worker
const notificationWorker = new NotificationWorker(subscriptionService);
notificationWorker.start();
```

### Step 6: Add Expiration Cleanup

```typescript
async function cleanupExpiredSubscriptions(): Promise<number> {
  const result = this.db.prepare(`
    DELETE FROM subscriptions
    WHERE expiration_date_time < datetime('now')
  `).run();

  return result.changes;
}

// Schedule cleanup
setInterval(cleanupExpiredSubscriptions, 60 * 60 * 1000); // Hourly
```

## Test Cases

```typescript
describe('Subscriptions API', () => {
  let webhookServer: http.Server;
  let receivedNotifications: any[] = [];

  beforeAll(async () => {
    // Start mock webhook receiver
    const webhookApp = express();
    webhookApp.use(express.json());

    webhookApp.post('/webhook', (req, res) => {
      const validationToken = req.query.validationToken;
      if (validationToken) {
        res.send(validationToken);
      } else {
        receivedNotifications.push(req.body);
        res.status(202).send();
      }
    });

    webhookServer = webhookApp.listen(9999);
  });

  afterAll(() => {
    webhookServer.close();
  });

  describe('POST /subscriptions', () => {
    test('creates subscription with validation', async () => {
      const response = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'created,updated',
          notificationUrl: 'http://localhost:9999/webhook',
          resource: `/drives/${driveId}/root`,
          expirationDateTime: new Date(Date.now() + 3600000).toISOString(),
          clientState: 'my-secret'
        });

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.resource).toBe(`/drives/${driveId}/root`);
    });

    test('fails validation for unreachable URL', async () => {
      const response = await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'created',
          notificationUrl: 'http://localhost:12345/nonexistent',
          resource: `/drives/${driveId}/root`,
          expirationDateTime: new Date(Date.now() + 3600000).toISOString()
        });

      expect(response.status).toBe(400);
    });
  });

  describe('Notification delivery', () => {
    test('receives notification when item is created', async () => {
      receivedNotifications = [];

      // Create subscription
      await request(app)
        .post('/v1.0/subscriptions')
        .send({
          changeType: 'created',
          notificationUrl: 'http://localhost:9999/webhook',
          resource: `/drives/${driveId}/root`,
          expirationDateTime: new Date(Date.now() + 3600000).toISOString(),
          clientState: 'test-state'
        });

      // Create item
      await request(app)
        .put(`/v1.0/drives/${driveId}/root:/newfile.txt:/content`)
        .send('test content');

      // Wait for delivery
      await new Promise(resolve => setTimeout(resolve, 6000));

      expect(receivedNotifications.length).toBeGreaterThan(0);
      expect(receivedNotifications[0].value[0].changeType).toBe('created');
      expect(receivedNotifications[0].value[0].clientState).toBe('test-state');
    });
  });

  describe('GET /subscriptions', () => {
    test('lists active subscriptions', async () => {
      const response = await request(app).get('/v1.0/subscriptions');

      expect(response.status).toBe(200);
      expect(response.body.value).toBeInstanceOf(Array);
    });
  });

  describe('PATCH /subscriptions/:id', () => {
    test('extends subscription expiration', async () => {
      const newExpiration = new Date(Date.now() + 7200000).toISOString();

      const response = await request(app)
        .patch(`/v1.0/subscriptions/${subscriptionId}`)
        .send({ expirationDateTime: newExpiration });

      expect(response.status).toBe(200);
      expect(response.body.expirationDateTime).toBe(newExpiration);
    });
  });

  describe('DELETE /subscriptions/:id', () => {
    test('removes subscription', async () => {
      const response = await request(app)
        .delete(`/v1.0/subscriptions/${subscriptionId}`);

      expect(response.status).toBe(204);
    });
  });
});
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/services/subscriptions.ts` | Create - Subscription management |
| `src/services/database.ts` | Modify - Add subscriptions tables |
| `src/routes/subscriptions.ts` | Create - Subscription endpoints |
| `src/server.ts` | Modify - Register routes, start worker |
| `src/routes/drives.ts` | Modify - Queue notifications on changes |
| `tests/routes/subscriptions.test.ts` | Create - Subscription tests |

## Limitations

- Validation requires external URL to be reachable
- No encryption of resource data
- No lifecycle notifications (reauthorizationRequired, etc.)
- Simple retry logic (3 attempts)
- No delivery guarantees
- Single-server only (no distributed queue)

## Success Criteria

1. Create subscription validates endpoint
2. List/Get/Update/Delete subscriptions work
3. Notifications queued on item changes
4. Notifications delivered to webhook URL
5. clientState included in notifications
6. Expired subscriptions cleaned up
7. Failed deliveries retried
