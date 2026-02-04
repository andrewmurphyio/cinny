/// <reference lib="WebWorker" />

export type {};
declare const self: ServiceWorkerGlobalScope;

type SessionInfo = {
  accessToken: string;
  baseUrl: string;
};

/**
 * Store session per client (tab)
 */
const sessions = new Map<string, SessionInfo>();

const clientToResolve = new Map<string, (value: SessionInfo | undefined) => void>();
const clientToSessionPromise = new Map<string, Promise<SessionInfo | undefined>>();

async function cleanupDeadClients() {
  const activeClients = await self.clients.matchAll();
  const activeIds = new Set(activeClients.map((c) => c.id));

  Array.from(sessions.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      sessions.delete(id);
      clientToResolve.delete(id);
      clientToSessionPromise.delete(id);
    }
  });
}

function setSession(clientId: string, accessToken: any, baseUrl: any) {
  if (typeof accessToken === 'string' && typeof baseUrl === 'string') {
    sessions.set(clientId, { accessToken, baseUrl });
  } else {
    // Logout or invalid session
    sessions.delete(clientId);
  }

  const resolveSession = clientToResolve.get(clientId);
  if (resolveSession) {
    resolveSession(sessions.get(clientId));
    clientToResolve.delete(clientId);
    clientToSessionPromise.delete(clientId);
  }
}

function requestSession(client: Client): Promise<SessionInfo | undefined> {
  const promise =
    clientToSessionPromise.get(client.id) ??
    new Promise((resolve) => {
      clientToResolve.set(client.id, resolve);
      client.postMessage({ type: 'requestSession' });
    });

  if (!clientToSessionPromise.has(client.id)) {
    clientToSessionPromise.set(client.id, promise);
  }

  return promise;
}

async function requestSessionWithTimeout(
  clientId: string,
  timeoutMs = 3000
): Promise<SessionInfo | undefined> {
  const client = await self.clients.get(clientId);
  if (!client) return undefined;

  const sessionPromise = requestSession(client);

  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), timeoutMs);
  });

  return Promise.race([sessionPromise, timeout]);
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await cleanupDeadClients();
    })()
  );
});

/**
 * Receive session updates from clients
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const client = event.source as Client | null;
  if (!client) return;

  const { type, accessToken, baseUrl } = event.data || {};

  if (type === 'setSession') {
    setSession(client.id, accessToken, baseUrl);
    cleanupDeadClients();
  }
});

const MEDIA_PATHS = ['/_matrix/client/v1/media/download', '/_matrix/client/v1/media/thumbnail'];

function mediaPath(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return MEDIA_PATHS.some((p) => pathname.startsWith(p));
  } catch {
    return false;
  }
}

function validMediaRequest(url: string, baseUrl: string): boolean {
  return MEDIA_PATHS.some((p) => {
    const validUrl = new URL(p, baseUrl);
    return url.startsWith(validUrl.href);
  });
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

  if (method !== 'GET' || !mediaPath(url)) return;

  const { clientId } = event;
  if (!clientId) return;

  const session = sessions.get(clientId);
  if (session) {
    if (validMediaRequest(url, session.baseUrl)) {
      event.respondWith(fetch(url, fetchConfig(session.accessToken)));
    }
    return;
  }

  event.respondWith(
    requestSessionWithTimeout(clientId).then((s) => {
      if (s && validMediaRequest(url, s.baseUrl)) {
        return fetch(url, fetchConfig(s.accessToken));
      }
      return fetch(event.request);
    })
  );
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
