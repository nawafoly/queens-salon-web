import { createRoot, type Root } from "react-dom/client";
import EmployeeRequestsSection from "../../../../pages/dashboardEmployees/EmployeeRequestsSection";
import { getAuthUser } from "../../../../pages/dashboardEmployees/shared";

let mountedRoot: Root | null = null;
let mountedHost: HTMLElement | null = null;
let lastKey = "";
let retryTimer: number | null = null;

function employeeIdFromPath() {
  const match = /^\/admin\/employees\/([^/]+)\/requests\/?$/.exec(window.location.pathname);
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

function findRequestsPlaceholder() {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(".emp-linked-module-section"));
  return sections.find((section) => section.textContent?.includes("طلبات الموظفة")) || null;
}

function unmountRequests() {
  mountedRoot?.unmount();
  mountedRoot = null;
  mountedHost = null;
  lastKey = "";
}

function hydrateRequestsTab() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  const employeeId = employeeIdFromPath();
  const placeholder = employeeId ? findRequestsPlaceholder() : null;
  if (!employeeId || !placeholder) {
    if (mountedRoot && (!employeeId || !document.body.contains(mountedHost))) {
      unmountRequests();
    }
    return false;
  }

  const employeeName = employeeNameFromPage();
  const key = `${employeeId}:${employeeName || "-"}`;
  if (mountedRoot && mountedHost && document.body.contains(mountedHost) && lastKey === key) return true;

  unmountRequests();

  const host = document.createElement("div");
  host.className = "dsv2-requests-hydrated-host";
  host.setAttribute("data-dsv2-ignore-dirty", "true");
  placeholder.replaceChildren(host);

  const authUser = getAuthUser();
  mountedRoot = createRoot(host);
  mountedHost = host;
  lastKey = key;
  mountedRoot.render(
    <EmployeeRequestsSection
      isVisible
      employeeId={employeeId}
      employeeUid={employeeId}
      employeeName={employeeName}
      reviewerUid={authUser?.uid || ""}
      reviewerName={authUser?.displayName || authUser?.email || "الإدارة"}
      canManage
    />,
  );
  return true;
}

function scheduleHydrate(retries = 8) {
  if (typeof window === "undefined") return;
  if (retryTimer !== null) window.clearTimeout(retryTimer);

  const run = (remaining: number) => {
    const done = hydrateRequestsTab();
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
