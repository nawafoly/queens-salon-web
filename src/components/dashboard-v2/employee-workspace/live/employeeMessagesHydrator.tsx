import { createRoot, type Root } from "react-dom/client";
import EmployeeMessagesSection from "../../../../pages/dashboardEmployees/EmployeeMessagesSection";
import { getAuthUser } from "../../../../pages/dashboardEmployees/shared";

let mountedRoot: Root | null = null;
let mountedHost: HTMLElement | null = null;
let lastKey = "";

function employeeIdFromPath() {
  const match = /^\/admin\/employees\/([^/]+)\/messages\/?$/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : "";
}

function findMessagesPlaceholder() {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(".emp-linked-module-section"));
  return sections.find((section) => {
    const text = section.textContent || "";
    return text.includes("الرسائل") || text.includes("رسائل") || text.includes("مراسلات");
  }) || null;
}

function unmountMessages() {
  mountedRoot?.unmount();
  mountedRoot = null;
  mountedHost = null;
  lastKey = "";
}

function hydrateMessagesTab() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const employeeId = employeeIdFromPath();
  const placeholder = employeeId ? findMessagesPlaceholder() : null;
  if (!employeeId || !placeholder) {
    if (mountedRoot && (!employeeId || !document.body.contains(mountedHost))) {
      unmountMessages();
    }
    return;
  }

  const key = `${employeeId}:${placeholder.dataset.messagesHydrated || ""}`;
  if (mountedRoot && mountedHost && document.body.contains(mountedHost) && lastKey === key) return;

  unmountMessages();

  const host = document.createElement("div");
  host.className = "dsv2-messages-hydrated-host";
  placeholder.replaceChildren(host);
  placeholder.dataset.messagesHydrated = "true";

  const authUser = getAuthUser();
  mountedRoot = createRoot(host);
  mountedHost = host;
  lastKey = `${employeeId}:true`;
  mountedRoot.render(
    <EmployeeMessagesSection
      isVisible
      employeeId={employeeId}
      employeeUid={employeeId}
      employeeName=""
      viewerUid={authUser?.uid || ""}
      viewerName={authUser?.displayName || authUser?.email || "الإدارة"}
      canManage
    />,
  );
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const scheduleHydrate = () => window.setTimeout(hydrateMessagesTab, 0);
  window.addEventListener("popstate", scheduleHydrate);
  window.addEventListener("focus", scheduleHydrate);

  const observer = new MutationObserver(scheduleHydrate);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  window.history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    scheduleHydrate();
    return result;
  };
  window.history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    scheduleHydrate();
    return result;
  };

  scheduleHydrate();
}

export {};
