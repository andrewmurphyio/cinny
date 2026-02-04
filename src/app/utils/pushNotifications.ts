/**
 * Web Push notification utilities for Cinny
 *
 * This module handles:
 * - Push subscription management
 * - Registering pushers with the Matrix homeserver
 * - VAPID key handling
 */

import { MatrixClient } from 'matrix-js-sdk';
import { PushConfig } from '../hooks/useClientConfig';

/**
 * Convert a base64url string to Uint8Array for applicationServerKey
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Check if push notifications are supported in this browser
 */
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Check if push is configured (VAPID key and gateway URL set)
 */
export function isPushConfigured(config?: PushConfig): boolean {
  return Boolean(config?.vapidPublicKey && config?.pushGatewayUrl);
}

/**
 * Get current notification permission status
 */
export function getNotificationPermission(): NotificationPermission {
  return Notification.permission;
}

/**
 * Request notification permission from the user
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser');
  }
  return Notification.requestPermission();
}

/**
 * Subscribe to push notifications and register with homeserver
 */
export async function subscribeToPush(
  mx: MatrixClient,
  config: PushConfig
): Promise<PushSubscription> {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported');
  }

  if (!isPushConfigured(config)) {
    throw new Error('Push notifications are not configured on this server');
  }

  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission denied');
  }

  // Get service worker registration
  const registration = await navigator.serviceWorker.ready;

  // Subscribe to push
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey!),
  });

  // Register pusher with homeserver
  await registerPusher(mx, subscription, config);

  return subscription;
}

/**
 * Register the push subscription as a pusher with the Matrix homeserver
 */
async function registerPusher(
  mx: MatrixClient,
  subscription: PushSubscription,
  config: PushConfig
): Promise<void> {
  const subscriptionJson = subscription.toJSON();

  if (!subscriptionJson.endpoint || !subscriptionJson.keys) {
    throw new Error('Invalid push subscription');
  }

  const deviceDisplayName = `Web Push (${navigator.userAgent.split(' ').pop() || 'Browser'})`;

  // The p256dh key is used as the pushkey
  const pushkey = subscriptionJson.keys.p256dh;
  const appId = config.appId || 'org.cinny.web';

  await mx.setPusher({
    app_display_name: 'Cinny',
    app_id: appId,
    append: true, // Don't remove other pushers with same pushkey (multi-account support)
    data: {
      url: config.pushGatewayUrl!,
      format: 'event_id_only', // Privacy-preserving: only send event IDs
      endpoint: subscriptionJson.endpoint,
      auth: subscriptionJson.keys.auth,
      events_only: true, // Don't send "clear unread" pushes
    },
    device_display_name: deviceDisplayName,
    kind: 'http',
    lang: navigator.language || 'en',
    profile_tag: '',
    pushkey,
  });
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(mx: MatrixClient, config?: PushConfig): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    const subscriptionJson = subscription.toJSON();
    const pushkey = subscriptionJson.keys?.p256dh;
    const appId = config?.appId || 'org.cinny.web';

    // Remove pusher from homeserver
    if (pushkey) {
      try {
        await mx.setPusher({
          app_id: appId,
          pushkey,
          kind: null, // null kind removes the pusher
        } as Parameters<typeof mx.setPusher>[0]);
      } catch (err) {
        console.warn('Failed to remove pusher from server:', err);
      }
    }

    // Unsubscribe locally
    await subscription.unsubscribe();
  }
}

/**
 * Check if currently subscribed to push
 */
export async function isSubscribedToPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}
