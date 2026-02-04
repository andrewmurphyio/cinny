/// <reference lib="WebWorker" />

export type {};
declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

type SessionInfo = {
  accessToken: string;
  baseUrl: string;
};

/**
 * Store session per client (tab)
 */
const sessions = new Map<string, SessionInfo>();

async function cleanupDeadClients() {
  const activeClients = await self.clients.matchAll();
  const activeIds = new Set(activeClients.map((c) => c.id));

  Array.from(sessions.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      sessions.delete(id);
    }
  });
}

/**
 * Receive session updates from clients
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const client = event.source as Client | null;
  if (!client) return;

  const { type, accessToken, baseUrl } = event.data || {};

  if (type !== 'setSession') return;

  cleanupDeadClients();

  if (typeof accessToken === 'string' && typeof baseUrl === 'string') {
    sessions.set(client.id, { accessToken, baseUrl });
  } else {
    // Logout or invalid session
    sessions.delete(client.id);
  }
});

function validMediaRequest(url: string, baseUrl: string): boolean {
  const downloadUrl = new URL('/_matrix/client/v1/media/download', baseUrl);
  const thumbnailUrl = new URL('/_matrix/client/v1/media/thumbnail', baseUrl);

  return url.startsWith(downloadUrl.href) || url.startsWith(thumbnailUrl.href);
}

function fetchConfig(token: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'default',
  };
}

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const { url, method } = event.request;

  if (method !== 'GET') return;
  if (!event.clientId) return;

  const session = sessions.get(event.clientId);
  if (!session) return;

  if (!validMediaRequest(url, session.baseUrl)) return;

  event.respondWith(fetch(url, fetchConfig(session.accessToken)));
});

// Push Notification Handlers

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) {
    console.log('[SW] Push event has no data');
    return;
  }

  let data: Record<string, unknown>;
  try {
    data = event.data.json();
  } catch {
    console.error('[SW] Failed to parse push data');
    return;
  }

  // Extract notification details from Matrix push format
  const senderName = (data.sender_display_name || data.sender || 'New Message') as string;
  const roomName = data.room_name as string | undefined;
  const body = (data.content as Record<string, unknown>)?.body as string | undefined;
  
  const title = roomName ? `${senderName} in ${roomName}` : senderName;
  const options: NotificationOptions = {
    body: body || 'You have a new message',
    icon: '/public/res/svg/cinny.svg',
    badge: '/public/res/svg/cinny.svg',
    tag: data.room_id as string, // Group by room
    renotify: true,
    data: {
      room_id: data.room_id,
      event_id: data.event_id,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const roomId = event.notification.data?.room_id as string | undefined;
  if (!roomId) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus();
            client.postMessage({
              type: 'notification-click',
              room_id: roomId,
            });
            return;
          }
        }
        // Open new window if none exists
        const encodedRoomId = encodeURIComponent(roomId);
        return self.clients.openWindow(`/#/room/${encodedRoomId}`);
      })
  );
});
