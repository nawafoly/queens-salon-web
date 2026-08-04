import { createRoot, type Root } from "react-dom/client";
import EmployeeRequestsSection from "../../../../pages/dashboardEmployees/EmployeeRequestsSection";
import { getAuthUser } from "../../../../pages/dashboardEmployees/shared";

let mountedRoot: Root | null = null;
let mountedHost: HTMLElement | null = null;
let lastKey = "";

function employeeIdFromPath() {
  const match = /^\/admin\/employees\/([^/]+)\/requests\/?$/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : "";
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
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const employeeId = employeeIdFromPath();
  const placeholder = employeeId ? findRequestsPlaceholder() : null;
  if (!employeeId || !placeholder) {
    if (mountedRoot && (!employeeId || !document.body.contains(mountedHost))) {
      unmountRequests();
    }
    return;
  }

  const key = `${employeeId}:${placeholder.dataset.requestsHydrated || ""}`;
  if (mountedRoot && mountedHost && document.body.contains(mountedHost) && lastKey === key) return;

  unmountRequests();

  const host = document.createElement("div");
  host.className = "dsv2-requests-hydrated-host";
  placeholder.replaceChildren(host);
  placeholder.dataset.requestsHydrated = "true";

  const authUser = getAuthUser();
  mountedRoot = createRoot(host);
  mountedHost = host;
  lastKey = `${employeeId}:true`;
  mountedRoot.render(
    <EmployeeRequestsSection
      isVisible
      employeeId={employeeId}
      employeeUid={employeeId}
      employeeName=""
      reviewerUid={authUser?.uid || ""}
      reviewerName={authUser?.displayName || authUser?.email || "الإدارة"}
      canManage
    />,
  );
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const scheduleHydrate = () => window.setTimeout(hydrateRequestsTab, 0);
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
