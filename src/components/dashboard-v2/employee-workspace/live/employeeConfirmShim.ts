type PendingConfirm = {
  message: string;
  trigger: HTMLElement | null;
};

declare global {
  interface Window {
    __malikatEmployeeConfirmShimInstalled?: boolean;
    __malikatEmployeeNativeConfirm?: typeof window.confirm;
  }
}

const APPROVED_MESSAGES = new Set<string>();
let lastClickTarget: HTMLElement | null = null;
let pendingConfirm: PendingConfirm | null = null;
let overlayEl: HTMLDivElement | null = null;

function closestActionTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest("button, a, [role='button'], input[type='button'], input[type='submit']") as HTMLElement | null;
}

function removeOverlay() {
  overlayEl?.remove();
  overlayEl = null;
}

function buildOverlay(message: string) {
  removeOverlay();

  const overlay = document.createElement("div");
  overlay.className = "dsv2-native-confirm-replacement";
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("dir", "rtl");

  overlay.innerHTML = `
    <div class="dsv2-native-confirm-replacement__backdrop" data-action="cancel"></div>
    <section class="dsv2-native-confirm-replacement__dialog">
      <div class="dsv2-native-confirm-replacement__icon" aria-hidden="true">!</div>
      <div class="dsv2-native-confirm-replacement__copy">
        <strong>تأكيد الإجراء</strong>
        <p></p>
      </div>
      <div class="dsv2-native-confirm-replacement__actions">
        <button type="button" class="dsv2-btn dsv2-btn--danger" data-action="confirm">تأكيد</button>
        <button type="button" class="dsv2-btn dsv2-btn--secondary" data-action="cancel">إلغاء</button>
      </div>
    </section>
  `;

  const messageNode = overlay.querySelector("p");
  if (messageNode) messageNode.textContent = message;

  overlay.addEventListener("click", (event) => {
    const actionTarget = (event.target as HTMLElement | null)?.closest?.("[data-action]") as HTMLElement | null;
    const action = actionTarget?.getAttribute("data-action");
    if (!action) return;

    if (action === "cancel") {
      pendingConfirm = null;
      removeOverlay();
      return;
    }

    if (action === "confirm" && pendingConfirm) {
      const { message: pendingMessage, trigger } = pendingConfirm;
      pendingConfirm = null;
      removeOverlay();
      APPROVED_MESSAGES.add(pendingMessage);
      window.setTimeout(() => trigger?.click(), 0);
    }
  });

  document.body.appendChild(overlay);
  overlayEl = overlay;

  window.setTimeout(() => {
    (overlay.querySelector("[data-action='confirm']") as HTMLButtonElement | null)?.focus();
  }, 0);
}

function installEmployeeConfirmShim() {
  if (typeof window === "undefined" || window.__malikatEmployeeConfirmShimInstalled) return;

  window.__malikatEmployeeConfirmShimInstalled = true;
  window.__malikatEmployeeNativeConfirm = window.confirm.bind(window);

  document.addEventListener(
    "click",
    (event) => {
      const actionTarget = closestActionTarget(event.target);
      if (actionTarget) lastClickTarget = actionTarget;
    },
    true,
  );

  window.confirm = (message?: string) => {
    const text = String(message || "").trim() || "هل تريد تنفيذ هذا الإجراء؟";

    if (APPROVED_MESSAGES.has(text)) {
      APPROVED_MESSAGES.delete(text);
      return true;
    }

    pendingConfirm = {
      message: text,
      trigger: lastClickTarget,
    };
    buildOverlay(text);
    return false;
  };
}

installEmployeeConfirmShim();

export {};
