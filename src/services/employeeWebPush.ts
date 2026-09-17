import { coreApiRequest } from "./coreApiClient";

type PushConfig = {
  enabled: boolean;
  publicKey: string;
};

export type EmployeeWebPushState = {
  supported: boolean;
  standalone: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  serverEnabled: boolean;
};

const SERVICE_WORKER_PATH = "/employee-push-sw.js";

function isStandaloneMode() {
  const iosStandalone = Boolean(
    (window.navigator as Navigator & { standalone?: boolean }).standalone
  );
  return (
    iosStandalone ||
    window.matchMedia?.("(display-mode: standalone)")?.matches === true
  );
}

function isPushSupported() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext
  );
}

function base64UrlToBytes(value: string) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64Url(buffer: ArrayBuffer | null) {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getPushConfig() {
  return coreApiRequest<PushConfig>("/api/core/hr/push/config");
}

async function registerWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.register(
    SERVICE_WORKER_PATH,
    { scope: "/" },
  );
  await navigator.serviceWorker.ready;
  return registration;
}

function serializeSubscription(subscription: PushSubscription) {
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: bytesToBase64Url(subscription.getKey("p256dh")),
      auth: bytesToBase64Url(subscription.getKey("auth")),
    },
    userAgent: navigator.userAgent,
    platform: navigator.platform || "",
  };
}

async function saveSubscription(subscription: PushSubscription) {
  return coreApiRequest<{ id: string; active: boolean }>(
    "/api/core/hr/push/subscriptions",
    {
      method: "POST",
      body: serializeSubscription(subscription),
    },
  );
}

async function removeSubscription(endpoint: string) {
  if (!endpoint) return;
  await coreApiRequest("/api/core/hr/push/unsubscribe", {
    method: "POST",
    body: { endpoint },
  });
}

export async function getEmployeeWebPushState(): Promise<EmployeeWebPushState> {
  const standalone = isStandaloneMode();
  const supported = isPushSupported();
  if (!supported) {
    return {
      supported: false,
      standalone,
      permission: "unsupported",
      subscribed: false,
      serverEnabled: false,
    };
  }

  let serverEnabled = false;
  try {
    serverEnabled = Boolean((await getPushConfig()).enabled);
  } catch {
    serverEnabled = false;
  }

  let subscribed = false;
  try {
    const registration = await registerWorker();
    subscribed = Boolean(await registration?.pushManager.getSubscription());
  } catch {
    subscribed = false;
  }

  return {
    supported,
    standalone,
    permission: Notification.permission,
    subscribed,
    serverEnabled,
  };
}

export async function enableEmployeeWebPush() {
  if (!isPushSupported()) {
    throw new Error(
      isStandaloneMode()
        ? "هذا الجهاز لا يدعم تنبيهات الويب."
        : "افتح Queens Salon من أيقونة الشاشة الرئيسية لتفعيل التنبيهات."
    );
  }

  const config = await getPushConfig();
  if (!config.enabled || !config.publicKey) {
    throw new Error("خدمة التنبيهات لم تُفعّل على الخادم بعد.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("يجب السماح بالتنبيهات من إعدادات الجهاز.");
  }

  const registration = await registerWorker();
  if (!registration) throw new Error("تعذر تشغيل خدمة التنبيهات.");

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(config.publicKey),
    });
  }

  await saveSubscription(subscription);
  return getEmployeeWebPushState();
}

export async function syncExistingEmployeeWebPushSubscription() {
  if (!isPushSupported() || Notification.permission !== "granted") return false;
  const registration = await registerWorker();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;
  await saveSubscription(subscription);
  return true;
}

export async function detachEmployeeWebPushSubscription() {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await removeSubscription(subscription.endpoint);
  } catch {
    // Logout should never be blocked by push cleanup.
  }
}

export async function disableEmployeeWebPush() {
  if (!isPushSupported()) return getEmployeeWebPushState();
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await removeSubscription(subscription.endpoint);
    await subscription.unsubscribe();
  }
  await syncEmployeeAppBadge(0);
  return getEmployeeWebPushState();
}

export async function syncEmployeeAppBadge(unreadCount: number) {
  const count = Math.max(0, Math.trunc(Number(unreadCount || 0)));
  try {
    const badgeNavigator = navigator as Navigator & {
      setAppBadge?: (value?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0 && badgeNavigator.setAppBadge) {
      await badgeNavigator.setAppBadge(count);
    } else if (count === 0 && badgeNavigator.clearAppBadge) {
      await badgeNavigator.clearAppBadge();
    }
  } catch {
    // Badge support/permission is optional and must not affect the portal.
  }
}
