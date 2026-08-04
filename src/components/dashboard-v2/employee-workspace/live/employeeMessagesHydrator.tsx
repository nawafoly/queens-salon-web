import { createRoot, type Root } from "react-dom/client";
import EmployeeMessagesSection from "../../../../pages/dashboardEmployees/EmployeeMessagesSection";
import { getAuthUser } from "../../../../pages/dashboardEmployees/shared";

let mountedRoot: Root | null = null;
let mountedHost: HTMLElement | null = null;
let lastKey = "";
let retryTimer: number | null = null;

function employeeIdFromPath() {
  const match = /^\/admin\/employees\/([^/]+)\/messages\/?$/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : "";
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function employeeNameFromPage() {
  const selectors = [
    ".dsv2-ew-profile-head__name-row h2",
    ".employees-v2-breadcrumb b",
  ];
  for (const selector of selectors) {
    const text = cleanText(document.querySelector<HTMLElement>(selector)?.textContent);
    if (text && !text.includes("/") && text !== "موظفة") return text;
  }
  return "";
}

function findMessagesPlaceholder() {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(".emp-linked-module-section"));
  return sections.find((section) => {
    const text = section.textContent || "";
    return text.includes("رسائل HR") || text.includes("الرسائل الداخلية") || text.includes("فتح الرسائل");
  }) || null;
}

function unmountMessages() {
  mountedRoot?.unmount();
  mountedRoot = null;
  mountedHost = null;
  lastKey = "";
}

function hydrateMessagesTab() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  const employeeId = employeeIdFromPath();
  const placeholder = employeeId ? findMessagesPlaceholder() : null;
  if (!employeeId || !placeholder) {
    if (mountedRoot && (!employeeId || !document.body.contains(mountedHost))) {
      unmountMessages();
    }
    return false;
  }

  const employeeName = employeeNameFromPage();
  const key = `${employeeId}:${employeeName || "-"}`;
  if (mountedRoot && mountedHost && document.body.contains(mountedHost) && lastKey === key) return true;

  unmountMessages();

  const host = document.createElement("div");
  host.className = "dsv2-messages-hydrated-host";
  host.setAttribute("data-dsv2-ignore-dirty", "true");
  placeholder.replaceChildren(host);

  const authUser = getAuthUser();
  mountedRoot = createRoot(host);
  mountedHost = host;
  lastKey = key;
  mountedRoot.render(
    <EmployeeMessagesSection
      isVisible
      employeeId={employeeId}
      employeeUid={employeeId}
      employeeName={employeeName}
      viewerUid={authUser?.uid || ""}
      viewerName={authUser?.displayName || authUser?.email || "الإدارة"}
      canManage
    />,
  );
  return true;
}

function scheduleHydrate(retries = 8) {
  if (typeof window === "undefined") return;
  if (retryTimer !== null) window.clearTimeout(retryTimer);

  const run = (remaining: number) => {
    const done = hydrateMessagesTab();
    if (done || remaining <= 0) return;
    retryTimer = window.setTimeout(() => run(remaining - 1), 90);
  };

  retryTimer = window.setTimeout(() => run(retries), 0);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("popstate", () => scheduleHydrate());
  window.addEventListener("focus", () => scheduleHydrate(2));

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
