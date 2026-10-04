import { useEffect, useState } from "react";
import {
  DashboardActionFeedbackV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardNumberInputV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import { CoreInventoryService, type InventoryItem } from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) return [error.code, error.message].filter(Boolean).join(" — ");
  return "تعذر تنفيذ العملية.";
}

type LocationRow = { id: string; name?: string };
type OperationScope = "waste" | "stocktake" | "transfer" | "location";
type OperationFeedback = { tone: "success" | "danger"; message: string } | null;

const EMPTY_FEEDBACK: Record<OperationScope, OperationFeedback> = {
  waste: null,
  stocktake: null,
  transfer: null,
  location: null,
};

export default function DashboardInventoryOps() {
  const { hasPermission } = usePermissions();
  const canWaste = hasPermission("inventory.waste.record");
  const canAdjust = hasPermission("inventory.adjust");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [itemId, setItemId] = useState("");
  const [wasteLocationId, setWasteLocationId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [transferQty, setTransferQty] = useState("1");
  const [wasteQty, setWasteQty] = useState("1");
  const [countedQty, setCountedQty] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] =
    useState<Record<OperationScope, OperationFeedback>>(EMPTY_FEEDBACK);
  const [locationName, setLocationName] = useState("");

  const setOperationFeedback = (scope: OperationScope, value: OperationFeedback) => {
    setFeedback((current) => ({ ...current, [scope]: value }));
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const [itemRows, locRows] = await Promise.all([
          CoreInventoryService.listItems({ active: "1" }),
          CoreInventoryService.listLocations().catch(() => []),
        ]);
        if (cancelled) return;
        setItems(itemRows || []);
        const locs = Array.isArray(locRows) ? locRows : [];
        setLocations(locs as LocationRow[]);
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function runWaste() {
    if (!canWaste || !itemId) return;
    setSaving("waste");
    setOperationFeedback("waste", null);
    try {
      await CoreInventoryService.recordWaste({
        itemId,
        quantity: Number(wasteQty),
        note: "UI waste",
        locationId: wasteLocationId || undefined,
      });
      setOperationFeedback("waste", {
        tone: "success",
        message: "تم تسجيل الهدر وخصم الكمية من الدفتر.",
      });
    } catch (err) {
      setOperationFeedback("waste", { tone: "danger", message: errorMessage(err) });
    } finally {
      setSaving("");
    }
  }

  async function runStocktake() {
    if (!canAdjust || !itemId) return;
    setSaving("stocktake");
    setOperationFeedback("stocktake", null);
    try {
      await CoreInventoryService.adjustAfterStocktake({
        itemId,
        countedQty: Number(countedQty),
        note: "UI stocktake",
      });
      setOperationFeedback("stocktake", {
        tone: "success",
        message: "تم تسجيل فرق الجرد في الدفتر.",
      });
    } catch (err) {
      setOperationFeedback("stocktake", { tone: "danger", message: errorMessage(err) });
    } finally {
      setSaving("");
    }
  }

  async function runTransfer() {
    if (!canAdjust || !itemId || !fromLocationId || !toLocationId) return;
    setSaving("transfer");
    setOperationFeedback("transfer", null);
    try {
      await CoreInventoryService.transferStock({
        itemId,
        quantity: Number(transferQty),
        fromLocationId,
        toLocationId,
      });
      setOperationFeedback("transfer", {
        tone: "success",
        message: "تم تحويل الكمية بين المواقع.",
      });
    } catch (err) {
      setOperationFeedback("transfer", { tone: "danger", message: errorMessage(err) });
    } finally {
      setSaving("");
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={6} />;
  if (loadError) {
    return <DashboardErrorStateV2 title="تعذر تحميل عمليات المخزون" description={loadError} />;
  }

  return (
    <div>
      <p className="text-muted">الهدر يخصم مباشرة. الجرد يسجل الفرق. التحويل يحتاج موقعين مختلفين.</p>
      <DashboardFieldV2 id="inv-ops-item" label="المادة">
        <DashboardSelectV2 value={itemId} options={items.map((item) => ({ value: item.id, label: item.name }))} onChange={setItemId} />
      </DashboardFieldV2>
      <div className="border rounded p-3 mb-3">
        <h3 className="h6">هدر</h3>
        <DashboardFieldV2 id="inv-waste-loc" label="الموقع">
          <DashboardSelectV2 value={wasteLocationId} options={locations.map((loc) => ({ value: loc.id, label: loc.name || loc.id }))} onChange={setWasteLocationId} />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-waste-qty" label="الكمية الهالكة">
          <DashboardNumberInputV2 value={wasteQty} onChange={(e) => setWasteQty(e.target.value)} />
        </DashboardFieldV2>
        {feedback.waste ? (
          <DashboardActionFeedbackV2
            compact
            revealOnMount
            tone={feedback.waste.tone}
            title={feedback.waste.tone === "success" ? "تم تسجيل الهدر" : "تعذر تسجيل الهدر"}
            description={feedback.waste.message}
          />
        ) : null}
        {canWaste ? (
          <button type="button" className="btn btn-dark" disabled={!!saving || !itemId} onClick={() => void runWaste()}>
            {saving === "waste" ? "جاري التسجيل..." : "تسجيل هدر"}
          </button>
        ) : <p className="text-muted">لا توجد صلاحية هدر.</p>}
      </div>
      <div className="border rounded p-3 mb-3">
        <h3 className="h6">جرد</h3>
        <DashboardFieldV2 id="inv-count-qty" label="الكمية المعدودة فعلياً">
          <DashboardNumberInputV2 value={countedQty} onChange={(e) => setCountedQty(e.target.value)} />
        </DashboardFieldV2>
        {feedback.stocktake ? (
          <DashboardActionFeedbackV2
            compact
            revealOnMount
            tone={feedback.stocktake.tone}
            title={feedback.stocktake.tone === "success" ? "تم اعتماد فرق الجرد" : "تعذر اعتماد فرق الجرد"}
            description={feedback.stocktake.message}
          />
        ) : null}
        {canAdjust ? (
          <button type="button" className="btn btn-dark" disabled={!!saving || !itemId || countedQty === ""} onClick={() => void runStocktake()}>
            {saving === "stocktake" ? "جاري التسجيل..." : "اعتماد فرق الجرد"}
          </button>
        ) : <p className="text-muted">لا توجد صلاحية جرد.</p>}
      </div>
      <div className="border rounded p-3">
        <h3 className="h6">تحويل بين المواقع</h3>
        <DashboardFieldV2 id="inv-from-loc" label="من موقع">
          <DashboardSelectV2 value={fromLocationId} options={locations.map((loc) => ({ value: loc.id, label: loc.name || loc.id }))} onChange={setFromLocationId} />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-to-loc" label="إلى موقع">
          <DashboardSelectV2 value={toLocationId} options={locations.map((loc) => ({ value: loc.id, label: loc.name || loc.id }))} onChange={setToLocationId} />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-transfer-qty" label="الكمية">
          <DashboardNumberInputV2 value={transferQty} onChange={(e) => setTransferQty(e.target.value)} />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-new-loc" label="موقع جديد">
          <input className="form-control" value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="اسم الموقع" />
        </DashboardFieldV2>
        {feedback.location ? (
          <DashboardActionFeedbackV2
            compact
            revealOnMount
            tone={feedback.location.tone}
            title={feedback.location.tone === "success" ? "تم إنشاء الموقع" : "تعذر إنشاء الموقع"}
            description={feedback.location.message}
          />
        ) : null}
        {canAdjust ? (
          <button type="button" className="btn btn-outline-dark mb-2" disabled={!locationName.trim() || !!saving} onClick={() => void (async () => {
            setSaving("location");
            setOperationFeedback("location", null);
            try {
              const created = await CoreInventoryService.createLocation({ name: locationName.trim() });
              const row = created as LocationRow;
              if (row?.id) setLocations((prev) => [...prev, row]);
              setLocationName("");
              setOperationFeedback("location", { tone: "success", message: "تم إنشاء الموقع." });
            } catch (err) {
              setOperationFeedback("location", { tone: "danger", message: errorMessage(err) });
            } finally {
              setSaving("");
            }
          })()}>إضافة موقع</button>
        ) : null}
        {feedback.transfer ? (
          <DashboardActionFeedbackV2
            compact
            revealOnMount
            tone={feedback.transfer.tone}
            title={feedback.transfer.tone === "success" ? "تم التحويل" : "تعذر التحويل"}
            description={feedback.transfer.message}
          />
        ) : null}
        {canAdjust ? (
          <button type="button" className="btn btn-dark" disabled={!!saving || !itemId || !fromLocationId || !toLocationId} onClick={() => void runTransfer()}>
            {saving === "transfer" ? "جاري التحويل..." : "تحويل"}
          </button>
        ) : <p className="text-muted">لا توجد صلاحية تحويل.</p>}
      </div>
    </div>
  );
}
