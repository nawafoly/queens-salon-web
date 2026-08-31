import { useEffect, useRef, useState } from "react";

const UNKNOWN_WRITE_EVENT = "queens:core-write-outcome-unknown";
const RECONNECTED_EVENT = "queens:core-network-reconnected";
const RECONCILED_EVENT = "queens:core-reconciled";

const RECONCILIATION_FALLBACK_MS = 6000;

export default function NetworkSafetyBanner() {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false
  );
  const [unknownWriteOutcome, setUnknownWriteOutcome] = useState(false);

  const unknownWriteOutcomeRef = useRef(false);
  const fallbackReloadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // CORE_RECONCILIATION_FAILSAFE_V1
    // Give the active domain screen a chance to reconcile from Core.
    // If no screen confirms reconciliation, reload the active route
    // so uncertain client state cannot remain authoritative.
    const clearFallbackReload = () => {
      if (fallbackReloadTimerRef.current === null) return;

      window.clearTimeout(fallbackReloadTimerRef.current);
      fallbackReloadTimerRef.current = null;
    };

    const scheduleFallbackReload = () => {
      clearFallbackReload();

      fallbackReloadTimerRef.current = window.setTimeout(() => {
        fallbackReloadTimerRef.current = null;

        if (!unknownWriteOutcomeRef.current) return;
        if (navigator.onLine === false) return;

        window.location.reload();
      }, RECONCILIATION_FALLBACK_MS);
    };

    const requestCanonicalReconciliation = () => {
      window.dispatchEvent(new Event(RECONNECTED_EVENT));
      scheduleFallbackReload();
    };

    const onOffline = () => {
      setOnline(false);
      clearFallbackReload();
    };

    const onOnline = () => {
      setOnline(true);

      // Preserve the existing reconnect contract for domain listeners.
      window.dispatchEvent(new Event(RECONNECTED_EVENT));

      if (unknownWriteOutcomeRef.current) {
        scheduleFallbackReload();
      }
    };

    const onUnknownWrite = () => {
      unknownWriteOutcomeRef.current = true;
      setUnknownWriteOutcome(true);

      // A transport failure can happen while navigator still reports online.
      if (navigator.onLine !== false) {
        requestCanonicalReconciliation();
      }
    };

    const onReconciled = () => {
      unknownWriteOutcomeRef.current = false;
      setUnknownWriteOutcome(false);
      clearFallbackReload();
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener(UNKNOWN_WRITE_EVENT, onUnknownWrite);
    window.addEventListener(RECONCILED_EVENT, onReconciled);

    return () => {
      clearFallbackReload();

      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(UNKNOWN_WRITE_EVENT, onUnknownWrite);
      window.removeEventListener(RECONCILED_EVENT, onReconciled);
    };
  }, []);

  if (online && !unknownWriteOutcome) return null;

  const message = online
    ? "نتيجة آخر حفظ غير مؤكدة. جارٍ إعادة مزامنة البيانات من Core قبل اعتماد الحالة الحالية."
    : "لا يوجد اتصال بالإنترنت — الحفظ متوقف حتى عودة الاتصال.";

  return (
    <div
      role="status"
      aria-live="assertive"
      data-network-safety-state={online ? "write-outcome-unknown" : "offline"}
      style={{
        position: "fixed",
        insetInline: 0,
        top: 0,
        zIndex: 100000,
        padding: "10px 16px",
        textAlign: "center",
        fontWeight: 700,
        background: online ? "#5a4200" : "#6b1d1d",
        color: "#fff",
        boxShadow: "0 2px 12px rgba(0,0,0,.2)",
      }}
    >
      {message}
    </div>
  );
}