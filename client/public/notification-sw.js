self.addEventListener("push", event => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  if (!payload || !Number.isInteger(payload.notificationId)) return;
  event.waitUntil(
    self.registration.showNotification(payload.title || "Ruffino Flow", {
      body: payload.genericBody || "Hai un nuovo aggiornamento da gestire.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { link: payload.link || "/notifiche" },
      tag: `ruffino-notification-${payload.notificationId}`,
      renotify: false,
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const link = event.notification.data?.link || "/notifiche";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    })
  );
});
