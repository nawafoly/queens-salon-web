import { useEffect, useRef, useState } from "react";

const UNKNOWN_WRITE_EVENT = "queens:core-write-outcome-unknown";
const RECONNECTED_EVENT = "queens:core-network-reconnected";
const RECONCILED_EVENT = "queens:core-reconciled";

const RECONCILIATION_FALLBACK_MS = 6000;

type CoreWriteOutcomeDetail = {
  path: string;
  method: string;
  operationId: string;
};

function readWriteOutcomeDetail(
  event: Event
): CoreWriteOutcomeDetail | null {
  if (
    !(event instanceof CustomEvent) ||
    !event.detail ||
    typeof event.detail !== "object"
  ) {
    return null;
  }

  const detail =
    event.detail as Partial<CoreWriteOutcomeDetail>;

  const path = String(detail.path || "").trim();
  const method =
    String(detail.method || "").trim().toUpperCase();
  const operationId =
    String(detail.operationId || "").trim();

  if (!path || !method || !operationId) {
    return null;
  }

  return {
    path,
    method,
    operationId,
  };
}

function sameWriteOutcome(
  pending: CoreWriteOutcomeDetail,
  reconciled: CoreWriteOutcomeDetail
) {
  return (
    pending.path === reconciled.path &&
    pending.method === reconciled.method &&
    pending.operationId === reconciled.operationId
  );
}

export default function NetworkSafetyBanner() {
  const [online, setOnline] = useState(
    () =>
      typeof navigator === "undefined" ||
      navigator.onLine !== false
  );

  const [
    unknownWriteOutcome,
    setUnknownWriteOutcome,
  ] = useState(false);

  const unknownWriteOutcomeRef =
    useRef(false);

  const pendingWriteRef =
    useRef<CoreWriteOutcomeDetail | null>(null);

  const fallbackReloadTimerRef =
    useRef<number | null>(null);

  useEffect(() => {
    // CORE_RECONCILIATION_FAILSAFE_V1
    // CORE_RECONCILIATION_CORRELATION_V1
    //
    // Only the domain that reconciles the exact ambiguous
    // logical operation may clear uncertainty.
    // Unrelated acknowledgements are ignored and the
    // canonical reload fallback remains armed.

    const clearFallbackReload = () => {
      if (
        fallbackReloadTimerRef.current === null
      ) {
        return;
      }

      window.clearTimeout(
        fallbackReloadTimerRef.current
      );

      fallbackReloadTimerRef.current = null;
    };

    const scheduleFallbackReload = () => {
      clearFallbackReload();

      fallbackReloadTimerRef.current =
        window.setTimeout(() => {
          fallbackReloadTimerRef.current = null;

          if (!unknownWriteOutcomeRef.current) {
            return;
          }

          if (navigator.onLine === false) {
            return;
          }

          window.location.reload();
        }, RECONCILIATION_FALLBACK_MS);
    };

    const requestCanonicalReconciliation = (
      detail: CoreWriteOutcomeDetail | null
    ) => {
      if (detail) {
        window.dispatchEvent(
          new CustomEvent(
            RECONNECTED_EVENT,
            { detail }
          )
        );
      } else {
        window.dispatchEvent(
          new Event(RECONNECTED_EVENT)
        );
      }

      scheduleFallbackReload();
    };

    const onOffline = () => {
      setOnline(false);
      clearFallbackReload();
    };

    const onOnline = () => {
      setOnline(true);

      const pending =
        pendingWriteRef.current;

      if (pending) {
        requestCanonicalReconciliation(
          pending
        );
        return;
      }

      window.dispatchEvent(
        new Event(RECONNECTED_EVENT)
      );

      if (
        unknownWriteOutcomeRef.current
      ) {
        scheduleFallbackReload();
      }
    };

    const onUnknownWrite = (
      event: Event
    ) => {
      const detail =
        readWriteOutcomeDetail(event);

      pendingWriteRef.current = detail;
      unknownWriteOutcomeRef.current = true;

      setUnknownWriteOutcome(true);

      // Transport failure may happen while the browser
      // still reports that connectivity exists.
      if (navigator.onLine !== false) {
        requestCanonicalReconciliation(
          detail
        );
      }
    };

    const onReconciled = (
      event: Event
    ) => {
      const pending =
        pendingWriteRef.current;

      const detail =
        readWriteOutcomeDetail(event);

      if (
        !pending ||
        !detail ||
        !sameWriteOutcome(
          pending,
          detail
        )
      ) {
        return;
      }

      pendingWriteRef.current = null;
      unknownWriteOutcomeRef.current = false;

      setUnknownWriteOutcome(false);
      clearFallbackReload();
    };

    window.addEventListener(
      "offline",
      onOffline
    );

    window.addEventListener(
      "online",
      onOnline
    );

    window.addEventListener(
      UNKNOWN_WRITE_EVENT,
      onUnknownWrite
    );

    window.addEventListener(
      RECONCILED_EVENT,
      onReconciled
    );

    return () => {
      clearFallbackReload();

      window.removeEventListener(
        "offline",
        onOffline
      );

      window.removeEventListener(
        "online",
        onOnline
      );

      window.removeEventListener(
        UNKNOWN_WRITE_EVENT,
        onUnknownWrite
      );

      window.removeEventListener(
        RECONCILED_EVENT,
        onReconciled
      );
    };
  }, []);

  if (
    online &&
    !unknownWriteOutcome
  ) {
    return null;
  }

  const message = online
    ? "نتيجة آخر حفظ غير مؤكدة. جارٍ إعادة مزامنة البيانات من Core قبل اعتماد الحالة الحالية."
    : "لا يوجد اتصال بالإنترنت — الحفظ متوقف حتى عودة الاتصال.";

  return (
    <div
      role="status"
      aria-live="assertive"
      data-network-safety-state={
        online
          ? "write-outcome-unknown"
          : "offline"
      }
      style={{
        position: "fixed",
        insetInline: 0,
        top: 0,
        zIndex: 100000,
        padding: "10px 16px",
        textAlign: "center",
        fontWeight: 700,
        background: online
          ? "#5a4200"
          : "#6b1d1d",
        color: "#fff",
        boxShadow:
          "0 2px 12px rgba(0,0,0,.2)",
      }}
    >
      {message}
    </div>
  );
}
