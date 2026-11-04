import { useEffect, useMemo, useState } from "react";
import {
  DashboardActionFeedbackV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardNumberInputV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import { CoreInventoryService, type InventoryItem, type InventoryLocation } from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) return [error.code, error.message].filter(Boolean).join(" — ");
  return "تعذر تنفيذ العملية.";
}

type ActionFeedback = { tone: "success" | "danger"; message: string } | null;

/* HIDE_DIRECT_SALE: salon is not retail POS */
export default function DashboardInventoryTrade() {
  const { hasPermission } = usePermissions();
  const canAdjust = hasPermission("inventory.adjust");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemId, setItemId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [qty, setQty] = useState("1");
  const [costSar, setCostSar] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>(null);

  const saleItems = useMemo(
    () => items.filter((item) => item.consumption_policy === "DIRECT_SALE"),
    [items]
  );
  void saleItems;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setLoadError("");
      try {
        // The receiving location is mandatory. If locations cannot be loaded,
        // fail closed instead of silently receiving into an unknown default.
        const [itemRows, locationRows] = await Promise.all([
          CoreInventoryService.listItems({ active: "1" }),
          CoreInventoryService.listLocations(),
        ]);
        if (cancelled) return;
        setItems(itemRows || []);
        setLocations((locationRows || []).filter((location) => Number(location.active ?? 1) === 1));
        try {
          const supplierRows = (await CoreInventoryService.listSuppliers({ active: "1" })) || [];
          if (!cancelled) setSuppliers(supplierRows);
        } catch {
          if (!cancelled) setSuppliers([]);
        }
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

  async function buy() {
    if (!canAdjust || !itemId || !locations.some((location) => location.id === locationId)) return;
    setSaving("buy");
    setActionFeedback(null);
    try {
      const unitCostHalalas = costSar === "" ? undefined : Math.round(Number(costSar) * 100);
      await CoreInventoryService.receivePurchase({
        itemId,
        quantity: Number(qty),
        unitCostHalalas,
        supplierId: supplierId || undefined,
        locationId,
      });
      setActionFeedback({
        tone: "success",
        message: "تم استلام الشراء وإضافة الكمية إلى الدفتر.",
      });
    } catch (err) {
      setActionFeedback({ tone: "danger", message: errorMessage(err) });
    } finally {
      setSaving("");
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={6} />;
  if (loadError) {
    return <DashboardErrorStateV2 title="تعذر تحميل شاشة الاستلام" description={loadError} />;
  }

  return (
    <div>
      <p className="text-muted">استلام شراء يضيف للمخزن ويحفظ تكلفة الوحدة. البيع المباشر غير متاح من هذه الواجهة.</p>
      <DashboardFieldV2 id="inv-trade-item" label="المادة">
        <DashboardSelectV2 value={itemId} options={items.map((item) => ({ value: item.id, label: `${item.name} — ${item.consumption_policy}` }))} onChange={setItemId} />
      </DashboardFieldV2>
      <DashboardFieldV2 id="inv-trade-loc" label="الموقع">
        <DashboardSelectV2 id="inv-trade-loc" value={locationId} placeholder="اختاري موقع الاستلام"
          options={locations.map((loc) => ({ value: loc.id, label: loc.name }))} onChange={setLocationId} />
      </DashboardFieldV2>
      {!locations.length ? <p className="small text-danger">لا توجد مواقع مخزون نشطة للاستلام. فعّلي موقعًا أولًا.</p> : null}
      <DashboardFieldV2 id="inv-trade-qty" label="الكمية">
        <DashboardNumberInputV2 value={qty} onChange={(e) => setQty(e.target.value)} />
      </DashboardFieldV2>
      <DashboardFieldV2 id="inv-trade-supplier" label="المورد (اختياري، للشراء فقط)">
        <DashboardSelectV2 value={supplierId} options={[{ value: "", label: "بدون مورد" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} onChange={setSupplierId} />
      </DashboardFieldV2>
      <DashboardFieldV2 id="inv-trade-cost" label="تكلفة الوحدة بالريال (للشراء فقط، اختياري)">
        <DashboardNumberInputV2 value={costSar} onChange={(e) => setCostSar(e.target.value)} />
      </DashboardFieldV2>
      {actionFeedback ? (
        <DashboardActionFeedbackV2
          compact
          revealOnMount
          tone={actionFeedback.tone}
          title={actionFeedback.tone === "success" ? "تم استلام الشراء" : "تعذر استلام الشراء"}
          description={actionFeedback.message}
        />
      ) : null}
      {canAdjust ? (
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-dark"
            disabled={!!saving || !itemId || !locations.some((location) => location.id === locationId)}
            onClick={() => void buy()}>
            {saving === "buy" ? "جاري الاستلام..." : "استلام شراء"}
          </button>
        </div>
      ) : <p className="text-muted">لا توجد صلاحية تسوية.</p>}
    </div>
  );
}
