import { createRoot, type Root } from "react-dom/client";
import EmployeeFilesSection from "../../../../pages/dashboardEmployees/EmployeeFilesSection";
import { getAuthUser } from "../../../../pages/dashboardEmployees/shared";

let mountedRoot: Root | null = null;
let mountedHost: HTMLElement | null = null;
let lastKey = "";
let pendingHydrate = false;

function employeeIdFromPath() {
  const match = /^\/admin\/employees\/([^/]+)\/files\/?$/.exec(window.location.pathname);
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

function findFilesPlaceholder() {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(".emp-linked-module-section"));
  return sections.find((section) => {
    if (section.querySelector(".dsv2-files-hydrated-host")) return true;
    return section.textContent?.includes("ملفات الموظفة");
  }) || null;
}

function unmountFiles() {
  mountedHost?.closest(".emp-linked-module-section")?.classList.remove("dsv2-live-mounted");
  mountedRoot?.unmount();
  mountedRoot = null;
  mountedHost = null;
  lastKey = "";
}

function hydrateFilesTab() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  const employeeId = employeeIdFromPath();
  if (!employeeId) {
    if (mountedRoot) unmountFiles();
    return false;
  }

  if (mountedRoot && mountedHost && document.body.contains(mountedHost) && lastKey === employeeId) {
    return true;
  }

  const placeholder = findFilesPlaceholder();
  if (!placeholder) return false;

  unmountFiles();

  const host = document.createElement("div");
  host.className = "dsv2-files-hydrated-host";
  host.setAttribute("data-dsv2-ignore-dirty", "true");
  placeholder.classList.add("dsv2-live-mounted");
  placeholder.replaceChildren(host);

  const authUser = getAuthUser();
  mountedRoot = createRoot(host);
  mountedHost = host;
  lastKey = employeeId;
  mountedRoot.render(
    <EmployeeFilesSection
      isVisible
      employeeId={employeeId}
      employeeUid={employeeId}
      employeeName={employeeNameFromPage()}
      viewerUid={authUser?.uid || ""}
      viewerName={authUser?.displayName || authUser?.email || "الإدارة"}
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
    hydrateFilesTab();
  };
  if (typeof window.queueMicrotask === "function") {
    window.queueMicrotask(run);
  } else {
    Promise.resolve().then(run);
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const win = window as typeof window & { __dsv2EmployeeFilesHydratorInstalled?: boolean };

  if (!win.__dsv2EmployeeFilesHydratorInstalled) {
    win.__dsv2EmployeeFilesHydratorInstalled = true;
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
      else if (mountedRoot) unmountFiles();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  queueHydrate();
}

export {};
