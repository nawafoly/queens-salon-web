import { useEffect, useMemo, useState } from "react";
import { DashboardErrorStateV2, DashboardFieldV2, DashboardNumberInputV2, DashboardSelectV2, DashboardSkeletonV2 } from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import { CoreInventoryService, type InventoryItem } from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) return [error.code, error.message].filter(Boolean).join(" — ");
  return "تعذر تنفيذ العملية.";
}

export default function DashboardInventoryTrade() {
  const { hasPermission } = usePermissions();
  const canAdjust = hasPermission("inventory.adjust");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [costSar, setCostSar] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const saleItems = useMemo(
    () => items.filter((item) => item.consumption_policy === "DIRECT_SALE"),
    [items]
  );

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

  async function buy() {
    if (!canAdjust || !itemId) return;
    setSaving("buy");
    setError("");
    setNotice("");
    try {
      const unitCostHalalas = costSar === "" ? undefined : Math.round(Number(costSar) * 100);
      await CoreInventoryService.receivePurchase({ itemId, quantity: Number(qty), unitCostHalalas });
      setNotice("تم استلام الشراء وإضافة الكمية إلى الدفتر.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving("");
    }
  }

  async function sell() {
    if (!canAdjust || !itemId) return;
    setSaving("sell");
    setError("");
    setNotice("");
    try {
      await CoreInventoryService.sellProduct({ itemId, quantity: Number(qty) });
      setNotice("تم بيع المادة وخصمها من الدفتر.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving("");
    }
  }

  async function ret() {
    if (!canAdjust || !itemId) return;
    setSaving("ret");
    setError("");
    setNotice("");
    try {
      await CoreInventoryService.returnProduct({ itemId, quantity: Number(qty) });
      setNotice("تم إرجاع البيع إلى المخزن.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving("");
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={6} />;

  return (
    <div>
      <p className="text-muted">الشراء يضيف للمخزن ويحفظ تكلفة الوحدة. البيع فقط لمواد سياسة البيع المباشر.</p>
      {error ? <DashboardErrorStateV2 title="تعذر التنفيذ" description={error} /> : null}
      {notice ? <p className="text-success">{notice}</p> : null}
      <DashboardFieldV2 id="inv-trade-item" label="المادة">
        <DashboardSelectV2 value={itemId} options={items.map((item) => ({ value: item.id, label: `${item.name} — ${item.consumption_policy}` }))} onChange={setItemId} />
      </DashboardFieldV2>
      <DashboardFieldV2 id="inv-trade-qty" label="الكمية">
        <DashboardNumberInputV2 value={qty} onChange={(e) => setQty(e.target.value)} />
      </DashboardFieldV2>
      <DashboardFieldV2 id="inv-trade-cost" label="تكلفة الوحدة بالريال (للشراء فقط، اختياري)">
        <DashboardNumberInputV2 value={costSar} onChange={(e) => setCostSar(e.target.value)} />
      </DashboardFieldV2>
      {canAdjust ? (
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-dark" disabled={!!saving || !itemId} onClick={() => void buy()}>استلام شراء</button>
          <button type="button" className="btn btn-outline-dark" disabled={!!saving || !itemId || !saleItems.some((item) => item.id === itemId)} onClick={() => void sell()}>بيع مباشر</button>
          <button type="button" className="btn btn-outline-dark" disabled={!!saving || !itemId} onClick={() => void ret()}>مرتجع بيع</button>
        </div>
      ) : <p className="text-muted">لا توجد صلاحية تسوية.</p>}
    </div>
  );
}
