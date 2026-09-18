/* MALIKAT employee Web Push and install service worker. */
const DEFAULT_ROUTE = "/employee/notifications";

function safePayload(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return {};
  }
}

function resolveTarget(route) {
  try {
    return new URL(route || DEFAULT_ROUTE, self.location.origin).href;
  } catch {
    return new URL(DEFAULT_ROUTE, self.location.origin).href;
  }
}

async function syncBadge(count) {
  const badge = Math.max(0, Number(count || 0));
  try {
    if (badge > 0 && "setAppBadge" in self.navigator) {
      await self.navigator.setAppBadge(badge);
    } else if (badge === 0 && "clearAppBadge" in self.navigator) {
      await self.navigator.clearAppBadge();
    }
  } catch {
    // Badge support is optional; notification delivery must continue.
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const data = safePayload(event);
  const title = String(data.title || "MALIKAT").trim() || "MALIKAT";
  const body = String(data.body || "لديك تحديث جديد").trim();
  const url = resolveTarget(data.url);
  const badge = Math.max(0, Number(data.badge || 0));

  event.waitUntil(
    Promise.all([
      syncBadge(badge),
      self.registration.showNotification(title, {
        body,
        icon: "/logo192.png",
        tag: String(data.tag || "malikat-update"),
        data: { url },
        dir: "rtl",
        lang: "ar",
      }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = resolveTarget(event.notification?.data?.url);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    for (const client of windows) {
      try {
        const current = new URL(client.url);
        const target = new URL(targetUrl);
        if (current.origin !== target.origin) continue;
        if ("navigate" in client) await client.navigate(targetUrl);
        await client.focus();
        return;
      } catch {
        // Try another client, then fall back to opening a new window.
      }
    }

    await self.clients.openWindow(targetUrl);
  })());
});
