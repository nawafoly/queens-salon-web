import { useEffect, useState } from "react";

const UNKNOWN_WRITE_EVENT = "queens:core-write-outcome-unknown";
const RECONNECTED_EVENT = "queens:core-network-reconnected";
const RECONCILED_EVENT = "queens:core-reconciled";

export default function NetworkSafetyBanner() {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false
  );
  const [unknownWriteOutcome, setUnknownWriteOutcome] = useState(false);

  useEffect(() => {
    const onOffline = () => setOnline(false);
    const onOnline = () => {
      setOnline(true);
      window.dispatchEvent(new Event(RECONNECTED_EVENT));
    };
    const onUnknownWrite = () => setUnknownWriteOutcome(true);
    const onReconciled = () => setUnknownWriteOutcome(false);

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener(UNKNOWN_WRITE_EVENT, onUnknownWrite);
    window.addEventListener(RECONCILED_EVENT, onReconciled);

    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(UNKNOWN_WRITE_EVENT, onUnknownWrite);
      window.removeEventListener(RECONCILED_EVENT, onReconciled);
    };
  }, []);

  if (online && !unknownWriteOutcome) return null;

  const message = online
    ? "عاد الاتصال، لكن نتيجة آخر حفظ غير مؤكدة. جارٍ إعادة مزامنة البيانات من Core."
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
