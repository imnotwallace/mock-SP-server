export interface Subscription {
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

export interface SubscriptionCreationParams {
  changeType: string;
  notificationUrl: string;
  resource: string;
  expirationDateTime: string;
  clientState?: string;
  applicationId?: string;
  creatorId?: string;
  includeResourceData?: boolean;
  lifecycleNotificationUrl?: string;
}

export interface Notification {
  subscriptionId: string;
  subscriptionExpirationDateTime: string;
  changeType: 'created' | 'updated' | 'deleted';
  resource: string;
  resourceData?: {
    '@odata.type': string;
    '@odata.id': string;
    id: string;
    [key: string]: any;
  };
  clientState?: string;
  tenantId: string;
}

export interface NotificationPayload {
  value: Notification[];
}
