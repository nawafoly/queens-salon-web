type PendingConfirm = {
  message: string;
  trigger: HTMLElement | null;
};

type ConfirmCopy = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
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

function resolveConfirmCopy(message: string): ConfirmCopy {
  if (message.includes("مسح") && message.includes("بصمة")) {
    return {
      title: "حذف بصمة الدخول؟",
      description: "سيعاد احتساب اليوم بعد حذف البصمة، وقد يتغير الاستحقاق المالي.",
      confirmLabel: "حذف البصمة",
      cancelLabel: "تراجع",
    };
  }

  if (message.includes("حذف") && message.includes("رصيد الإجازات")) {
    return {
      title: "حذف السجل؟",
      description: message,
      confirmLabel: "حذف السجل",
      cancelLabel: "تراجع",
    };
  }

  if (message.includes("إلغاء الإجازة")) {
    return {
      title: "إلغاء الإجازة؟",
      description: message,
      confirmLabel: "إلغاء الإجازة",
      cancelLabel: "تراجع",
    };
  }

  return {
    title: "تأكيد الإجراء",
    description: message,
    confirmLabel: "تأكيد",
    cancelLabel: "إلغاء",
  };
}

function buildOverlay(message: string) {
  removeOverlay();

  const copy = resolveConfirmCopy(message);
  const overlay = document.createElement("div");
  overlay.className = "dashboard-v2 dsv2-page dsv2-overlay-root dsv2-confirm-shim";
  overlay.setAttribute("data-tone", "danger");
  overlay.setAttribute("dir", "rtl");

  overlay.innerHTML = `
    <button type="button" class="dsv2-overlay-backdrop" data-action="cancel" aria-label="${copy.cancelLabel}"></button>
    <div class="dsv2-overlay-stage" role="presentation">
      <section class="dsv2-modal dsv2-modal--sm dsv2-confirm" role="alertdialog" aria-modal="true" aria-labelledby="employee-confirm-title" aria-describedby="employee-confirm-description" tabindex="-1">
        <header class="dsv2-dialog__head">
          <div class="dsv2-dialog__heading">
            <span class="dsv2-dialog__eyebrow">تأكيد</span>
            <h2 id="employee-confirm-title" class="dsv2-dialog__title"></h2>
            <p id="employee-confirm-description" class="dsv2-dialog__description"></p>
          </div>
          <button type="button" class="dsv2-dialog__close" data-action="cancel" aria-label="إغلاق النافذة">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
              <path d="m5.25 5.25 9.5 9.5m0-9.5-9.5 9.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        </header>
        <div class="dsv2-dialog__body">
          <div class="dsv2-confirm__content">
            <span class="dsv2-confirm__icon" data-tone="danger" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 7.5v5.25m0 3.75h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </span>
          </div>
        </div>
        <footer class="dsv2-dialog__foot">
          <button type="button" class="dsv2-btn dsv2-btn--danger" data-action="confirm"></button>
          <button type="button" class="dsv2-btn dsv2-btn--secondary" data-action="cancel"></button>
        </footer>
      </section>
    </div>
  `;

  const titleNode = overlay.querySelector("#employee-confirm-title");
  const messageNode = overlay.querySelector("#employee-confirm-description");
  const confirmNode = overlay.querySelector("[data-action='confirm']");
  const cancelNode = overlay.querySelector(".dsv2-dialog__foot [data-action='cancel']");
  if (titleNode) titleNode.textContent = copy.title;
  if (messageNode) messageNode.textContent = copy.description;
  if (confirmNode) confirmNode.textContent = copy.confirmLabel;
  if (cancelNode) cancelNode.textContent = copy.cancelLabel;

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
    (overlay.querySelector("section") as HTMLElement | null)?.focus();
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
