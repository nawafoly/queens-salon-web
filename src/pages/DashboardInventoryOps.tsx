import { useEffect, useState } from "react";
import { DashboardErrorStateV2, DashboardFieldV2, DashboardNumberInputV2, DashboardSelectV2, DashboardSkeletonV2 } from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import { CoreInventoryService, type InventoryItem } from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) return [error.code, error.message].filter(Boolean).join(" — ");
  return "تعذر تنفيذ العملية.";
}

export default function DashboardInventoryOps() {
  const { hasPermission } = usePermissions();
  const canWaste = hasPermission("inventory.waste.record");
  const canAdjust = hasPermission("inventory.adjust");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemId, setItemId] = useState("");
  const [wasteQty, setWasteQty] = useState("1");
  const [countedQty, setCountedQty] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        setItems((await CoreInventoryService.listItems({ active: "1" })) || []);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function runWaste() {
    if (!canWaste || !itemId) return;
    setSaving("waste");
    setError("");
    setNotice("");
    try {
      await CoreInventoryService.recordWaste({ itemId, quantity: Number(wasteQty), note: "UI waste" });
      setNotice("تم تسجيل الهدر وخصم الكمية من الدفتر.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving("");
    }
  }

  async function runStocktake() {
    if (!canAdjust || !itemId) return;
    setSaving("stocktake");
    setError("");
    setNotice("");
    try {
      await CoreInventoryService.adjustAfterStocktake({ itemId, countedQty: Number(countedQty), note: "UI stocktake" });
      setNotice("تم تسجيل فرق الجرد في الدفتر.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving("");
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={6} />;

  return (
    <div>
      <p className="text-muted">الهدر يخصم مباشرة. الجرد يسجل الفرق بين العد الفعلي والرصيد في الدفتر.</p>
      {error ? <DashboardErrorStateV2 title="تعذر التنفيذ" description={error} /> : null}
      {notice ? <p className="text-success">{notice}</p> : null}
      <DashboardFieldV2 id="inv-ops-item" label="المادة">
        <DashboardSelectV2 value={itemId} options={items.map((item) => ({ value: item.id, label: item.name }))} onChange={setItemId} />
      </DashboardFieldV2>
      <div className="border rounded p-3 mb-3">
        <h3 className="h6">هدر</h3>
        <DashboardFieldV2 id="inv-waste-qty" label="الكمية الهالكة">
          <DashboardNumberInputV2 value={wasteQty} onChange={(e) => setWasteQty(e.target.value)} />
        </DashboardFieldV2>
        {canWaste ? (
          <button type="button" className="btn btn-dark" disabled={!!saving || !itemId} onClick={() => void runWaste()}>
            {saving === "waste" ? "جاري التسجيل..." : "تسجيل هدر"}
          </button>
        ) : <p className="text-muted">لا توجد صلاحية هدر.</p>}
      </div>
      <div className="border rounded p-3">
        <h3 className="h6">جرد</h3>
        <DashboardFieldV2 id="inv-count-qty" label="الكمية المعدودة فعلياً">
          <DashboardNumberInputV2 value={countedQty} onChange={(e) => setCountedQty(e.target.value)} />
        </DashboardFieldV2>
        {canAdjust ? (
          <button type="button" className="btn btn-dark" disabled={!!saving || !itemId || countedQty === ""} onClick={() => void runStocktake()}>
            {saving === "stocktake" ? "جاري التسجيل..." : "اعتماد فرق الجرد"}
          </button>
        ) : <p className="text-muted">لا توجد صلاحية جرد.</p>}
      </div>
    </div>
  );
}
