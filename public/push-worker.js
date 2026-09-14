self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() || "AI 작업이 완료되었습니다." };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "우리집 식탁", {
      body: data.body || "AI 작업이 완료되었습니다.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag || "meal-notification",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => new URL(client.url).pathname === url);
      return existing ? existing.focus() : clients.openWindow(url);
    }),
  );
});
