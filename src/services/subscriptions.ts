import axios from 'axios';
import { randomBytes } from 'crypto';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { GraphError } from '../middleware/error.js';
import { generateId } from '../utils/id.js';
import type { Subscription, SubscriptionCreationParams, Notification, NotificationPayload } from '../types/index.js';

export class SubscriptionService {
  private readonly MAX_EXPIRATION_DAYS = 30;
  private readonly VALIDATION_TIMEOUT_MS = 10000;

  constructor(private db: BetterSqlite3Database) {}

  async createSubscription(params: SubscriptionCreationParams): Promise<Subscription> {
    const expiration = new Date(params.expirationDateTime);
    const maxExpiration = new Date(Date.now() + this.MAX_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

    if (expiration > maxExpiration) {
      throw GraphError.badRequest(
        `Expiration cannot exceed ${this.MAX_EXPIRATION_DAYS} days from now`
      );
    }

    if (expiration <= new Date()) {
      throw GraphError.badRequest('Expiration must be in the future');
    }

    await this.validateNotificationUrl(params.notificationUrl);

    const id = generateId(`subscription-${Date.now()}-${Math.random()}`);
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
      params.includeResourceData ? 1 : 0,
      params.lifecycleNotificationUrl || null,
      new Date().toISOString()
    );

    return this.getSubscription(id)!;
  }

  getSubscription(id: string): Subscription | null {
    const row = this.db.prepare(`
      SELECT * FROM subscriptions WHERE id = ?
    `).get(id) as any;

    if (!row) return null;

    return this.formatSubscription(row);
  }

  listSubscriptions(): Subscription[] {
    const rows = this.db.prepare(`
      SELECT * FROM subscriptions
      WHERE expiration_date_time > datetime('now')
      ORDER BY created_at DESC
    `).all() as any[];

    return rows.map(row => this.formatSubscription(row));
  }

  async updateSubscription(
    id: string,
    updates: { expirationDateTime?: string }
  ): Promise<Subscription> {
    const subscription = this.getSubscription(id);
    if (!subscription) {
      throw GraphError.notFound('Subscription not found');
    }

    if (updates.expirationDateTime) {
      const expiration = new Date(updates.expirationDateTime);
      const maxExpiration = new Date(Date.now() + this.MAX_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

      if (expiration > maxExpiration) {
        throw GraphError.badRequest(
          `Expiration cannot exceed ${this.MAX_EXPIRATION_DAYS} days from now`
        );
      }

      if (expiration <= new Date()) {
        throw GraphError.badRequest('Expiration must be in the future');
      }

      this.db.prepare(`
        UPDATE subscriptions SET expiration_date_time = ? WHERE id = ?
      `).run(updates.expirationDateTime, id);
    }

    return this.getSubscription(id)!;
  }

  deleteSubscription(id: string): void {
    const result = this.db.prepare(`
      DELETE FROM subscriptions WHERE id = ?
    `).run(id);

    if (result.changes === 0) {
      throw GraphError.notFound('Subscription not found');
    }
  }

  queueNotification(
    resource: string,
    changeType: 'created' | 'updated' | 'deleted',
    itemId: string,
    resourceData?: object
  ): void {
    const subscriptions = this.db.prepare(`
      SELECT * FROM subscriptions
      WHERE expiration_date_time > datetime('now')
      AND (
        resource = ?
        OR ? LIKE resource || '%'
      )
    `).all(resource, resource) as any[];

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
      WHERE nq.delivered = 0
      AND nq.delivery_attempts < 3
      ORDER BY nq.created_at
      LIMIT 100
    `).all() as any[];

    let delivered = 0;

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

        const ids = notifications.map(n => n.id);
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`
          UPDATE notification_queue SET delivered = 1 WHERE id IN (${placeholders})
        `).run(...ids);
      } catch (error) {
        const ids = notifications.map(n => n.id);
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`
          UPDATE notification_queue
          SET delivery_attempts = delivery_attempts + 1, last_attempt_at = ?
          WHERE id IN (${placeholders})
        `).run(new Date().toISOString(), ...ids);
      }
    }

    return delivered;
  }

  cleanupExpiredSubscriptions(): number {
    const result = this.db.prepare(`
      DELETE FROM subscriptions
      WHERE expiration_date_time < datetime('now')
    `).run();

    return result.changes;
  }

  private async validateNotificationUrl(url: string): Promise<void> {
    const validationToken = randomBytes(32).toString('base64url');

    try {
      const response = await axios.post(
        `${url}?validationToken=${encodeURIComponent(validationToken)}`,
        null,
        {
          timeout: this.VALIDATION_TIMEOUT_MS,
          validateStatus: (status: number) => status === 200,
          headers: {
            'Content-Type': 'text/plain'
          }
        }
      );

      if (response.data !== validationToken) {
        throw new Error('Validation token mismatch');
      }
    } catch (error) {
      throw GraphError.badRequest(
        'Subscription validation failed. Ensure the notificationUrl returns the validationToken in the response body.'
      );
    }
  }

  private async deliverNotifications(url: string, notifications: any[]): Promise<void> {
    const payload: NotificationPayload = {
      value: notifications.map(n => ({
        subscriptionId: n.subscription_id,
        subscriptionExpirationDateTime: n.expiration_date_time,
        changeType: n.change_type,
        resource: n.resource,
        resourceData: n.resource_data ? JSON.parse(n.resource_data) : undefined,
        clientState: n.client_state,
        tenantId: 'mock-tenant-id'
      }))
    };

    await axios.post(url, payload, {
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
      includeResourceData: Boolean(row.include_resource_data),
      lifecycleNotificationUrl: row.lifecycle_notification_url
    };
  }
}
