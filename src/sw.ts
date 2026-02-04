/// <reference lib="WebWorker" />

export type {};
declare const self: ServiceWorkerGlobalScope;

async function askForAccessToken(client: Client): Promise<string | undefined> {
  return new Promise((resolve) => {
    const responseKey = Math.random().toString(36);
    const listener = (event: ExtendableMessageEvent) => {
      if (event.data.responseKey !== responseKey) return;
      resolve(event.data.token);
      self.removeEventListener('message', listener);
    };
    self.addEventListener('message', listener);
    client.postMessage({ responseKey, type: 'token' });
  });
}

function fetchConfig(token?: string): RequestInit | undefined {
  if (!token) return undefined;

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
  if (
    !url.includes('/_matrix/client/v1/media/download') &&
    !url.includes('/_matrix/client/v1/media/thumbnail')
  ) {
    return;
  }
  event.respondWith(
    (async (): Promise<Response> => {
      const client = await self.clients.get(event.clientId);
      let token: string | undefined;
      if (client) token = await askForAccessToken(client);

      return fetch(url, fetchConfig(token));
    })()
  );
});

// ===========================================
// Push Notification Handlers
// ===========================================

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
