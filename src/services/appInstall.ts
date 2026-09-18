export type InstallPromptOutcome = "accepted" | "dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: InstallPromptOutcome;
    platform: string;
  }>;
};

type PromptListener = (available: boolean) => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<PromptListener>();

function notifyPromptListeners() {
  const available = Boolean(deferredPrompt);
  promptListeners.forEach((listener) => listener(available));
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") return false;

  const iosNavigator = window.navigator as Navigator & { standalone?: boolean };
  return (
    iosNavigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyPromptListeners();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyPromptListeners();
  });
}

export function isMalikatInstalled() {
  return isStandaloneDisplayMode();
}

export function hasMalikatInstallPrompt() {
  return Boolean(deferredPrompt);
}

export function subscribeToMalikatInstallPrompt(listener: PromptListener) {
  promptListeners.add(listener);
  listener(Boolean(deferredPrompt));
  return () => promptListeners.delete(listener);
}

export async function promptMalikatInstallation(): Promise<InstallPromptOutcome | "unavailable"> {
  const prompt = deferredPrompt;
  if (!prompt) return "unavailable";

  await prompt.prompt();
  const choice = await prompt.userChoice;
  deferredPrompt = null;
  notifyPromptListeners();
  return choice.outcome;
}

export function registerMalikatServiceWorker() {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !window.isSecureContext
  ) {
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/employee-push-sw.js", { scope: "/" })
      .catch((error) => {
        console.warn("[MALIKAT] service worker registration failed", error);
      });
  });
}
