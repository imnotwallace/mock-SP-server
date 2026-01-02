import { Router } from 'express';
import { GraphError } from '../middleware/error.js';
import type { SubscriptionService } from '../services/subscriptions.js';

export function createSubscriptionsRouter(subscriptionService: SubscriptionService): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const {
        changeType,
        notificationUrl,
        resource,
        expirationDateTime,
        clientState,
        applicationId,
        creatorId,
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
        applicationId,
        creatorId,
        includeResourceData,
        lifecycleNotificationUrl
      });

      res.status(201).json(subscription);
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const subscriptions = subscriptionService.listSubscriptions();
      res.json({ value: subscriptions });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const subscription = subscriptionService.getSubscription(req.params.id);
      if (!subscription) {
        throw GraphError.notFound('Subscription not found');
      }
      res.json(subscription);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const { expirationDateTime } = req.body;

      const subscription = await subscriptionService.updateSubscription(
        req.params.id,
        { expirationDateTime }
      );

      res.json(subscription);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      subscriptionService.deleteSubscription(req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
