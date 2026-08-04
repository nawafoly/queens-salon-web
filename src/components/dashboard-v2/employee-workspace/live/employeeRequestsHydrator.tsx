import { createRoot, type Root } from "react-dom/client";
import EmployeeRequestsSection from "../../../../pages/dashboardEmployees/EmployeeRequestsSection";
import { getAuthUser } from "../../../../pages/dashboardEmployees/shared";

let mountedRoot: Root | null = null;
let mountedHost: HTMLElement | null = null;
let lastKey = "";
let pendingHydrate = false;

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
  return sections.find((section) => {
    if (section.querySelector(".dsv2-requests-hydrated-host")) return true;
    return section.textContent?.includes("طلبات الموظفة");
  }) || null;
}

function unmountRequests() {
  mountedHost?.closest(".emp-linked-module-section")?.classList.remove("dsv2-live-mounted");
  mountedRoot?.unmount();
  mountedRoot = null;
  mountedHost = null;
  lastKey = "";
}

function hydrateRequestsTab() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  const employeeId = employeeIdFromPath();
  if (!employeeId) {
    if (mountedRoot) unmountRequests();
    return false;
  }

  if (mountedRoot && mountedHost && document.body.contains(mountedHost) && lastKey === employeeId) {
    return true;
  }

  const placeholder = findRequestsPlaceholder();
  if (!placeholder) return false;

  unmountRequests();

  const host = document.createElement("div");
  host.className = "dsv2-requests-hydrated-host";
  host.setAttribute("data-dsv2-ignore-dirty", "true");
  placeholder.classList.add("dsv2-live-mounted");
  placeholder.replaceChildren(host);

  const authUser = getAuthUser();
  mountedRoot = createRoot(host);
  mountedHost = host;
  lastKey = employeeId;
  mountedRoot.render(
    <EmployeeRequestsSection
      isVisible
      employeeId={employeeId}
      employeeUid={employeeId}
      employeeName={employeeNameFromPage()}
      reviewerUid={authUser?.uid || ""}
      reviewerName={authUser?.displayName || authUser?.email || "الإدارة"}
      canManage
    />,
  );
  return true;
}

function queueHydrate() {
  if (typeof window === "undefined") return;
  if (pendingHydrate) return;
  pendingHydrate = true;
  const run = () => {
    pendingHydrate = false;
    hydrateRequestsTab();
  };
  if (typeof window.queueMicrotask === "function") {
    window.queueMicrotask(run);
  } else {
    Promise.resolve().then(run);
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const win = window as typeof window & { __dsv2EmployeeRequestsHydratorInstalled?: boolean };

  if (!win.__dsv2EmployeeRequestsHydratorInstalled) {
    win.__dsv2EmployeeRequestsHydratorInstalled = true;
    window.addEventListener("popstate", queueHydrate);
    window.addEventListener("focus", queueHydrate);

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    window.history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      queueHydrate();
      return result;
    };
    window.history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      queueHydrate();
      return result;
    };

    const observer = new MutationObserver(() => {
      if (employeeIdFromPath()) queueHydrate();
      else if (mountedRoot) unmountRequests();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  queueHydrate();
}

export {};
