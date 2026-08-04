type PendingConfirm = {
  message: string;
  trigger: HTMLElement | null;
};

type ConfirmCopy = {
  title: string;
  description: string;
  confirmLabel: string;
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
    };
  }

  if (message.includes("حذف") && message.includes("رصيد الإجازات")) {
    return {
      title: "حذف السجل؟",
      description: message,
      confirmLabel: "حذف السجل",
    };
  }

  if (message.includes("إلغاء الإجازة")) {
    return {
      title: "إلغاء الإجازة؟",
      description: message,
      confirmLabel: "إلغاء الإجازة",
    };
  }

  return {
    title: "تأكيد الإجراء",
    description: message,
    confirmLabel: "تأكيد",
  };
}

function buildOverlay(message: string) {
  removeOverlay();

  const copy = resolveConfirmCopy(message);
  const overlay = document.createElement("div");
  overlay.className = "dsv2-native-confirm-replacement";
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("dir", "rtl");

  overlay.innerHTML = `
    <div class="dsv2-native-confirm-replacement__backdrop" data-action="cancel"></div>
    <section class="dsv2-native-confirm-replacement__dialog">
      <button type="button" class="dsv2-native-confirm-replacement__close" data-action="cancel" aria-label="إغلاق">×</button>
      <div class="dsv2-native-confirm-replacement__copy">
        <strong></strong>
        <p></p>
      </div>
      <div class="dsv2-native-confirm-replacement__icon" aria-hidden="true">!</div>
      <div class="dsv2-native-confirm-replacement__actions">
        <button type="button" class="dsv2-native-confirm-replacement__confirm" data-action="confirm"></button>
        <button type="button" class="dsv2-native-confirm-replacement__cancel" data-action="cancel">تراجع</button>
      </div>
    </section>
  `;

  const titleNode = overlay.querySelector("strong");
  const messageNode = overlay.querySelector("p");
  const confirmNode = overlay.querySelector("[data-action='confirm']");
  if (titleNode) titleNode.textContent = copy.title;
  if (messageNode) messageNode.textContent = copy.description;
  if (confirmNode) confirmNode.textContent = copy.confirmLabel;

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
