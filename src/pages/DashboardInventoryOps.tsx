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
import { CoreInventoryService, type InventoryDisposalType, type InventoryItem } from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) return [error.code, error.message].filter(Boolean).join(" — ");
  return "تعذر تنفيذ العملية.";
}

type LocationRow = { id: string; name?: string; active?: number };
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
  const [disposalType, setDisposalType] = useState<InventoryDisposalType>("WASTE_OUT");
  const [disposalNote, setDisposalNote] = useState("");
  const [countedQty, setCountedQty] = useState("");
  const [stocktakeLocationId, setStocktakeLocationId] = useState("");
  const [stocktakeBalance, setStocktakeBalance] = useState<number | null>(null);
  const [stocktakeBalanceLoading, setStocktakeBalanceLoading] = useState(false);
  const [stocktakeBalanceError, setStocktakeBalanceError] = useState("");
  const [stocktakeNote, setStocktakeNote] = useState("");
  const [stocktakeRefresh, setStocktakeRefresh] = useState(0);
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
        setLocations((locs as LocationRow[]).filter((row) => Number(row.active ?? 1) === 1));
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

  useEffect(() => {
    let cancelled = false;
    setStocktakeBalance(null);
    setStocktakeBalanceError("");
    if (!itemId || !stocktakeLocationId) {
      setStocktakeBalanceLoading(false);
      return;
    }

    setStocktakeBalanceLoading(true);
    void (async () => {
      try {
        const rows = await CoreInventoryService.listStockLevels({ itemId, locationId: stocktakeLocationId });
        if (cancelled) return;
        const row = rows.find((entry) => entry.item_id === itemId && entry.location_id === stocktakeLocationId);
        const balance = row ? Number(row.qty_on_hand) : 0;
        if (!Number.isFinite(balance) || balance < 0) throw new Error("Invalid stock balance");
        setStocktakeBalance(balance);
      } catch (err) {
        if (!cancelled) setStocktakeBalanceError(errorMessage(err));
      } finally {
        if (!cancelled) setStocktakeBalanceLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [itemId, stocktakeLocationId, stocktakeRefresh]);

  const countedNumber = countedQty.trim() === "" ? NaN : Number(countedQty);
  const validCounted = Number.isFinite(countedNumber) && countedNumber >= 0;
  const stocktakeDelta = validCounted && stocktakeBalance !== null ? countedNumber - stocktakeBalance : null;
  const canConfirmStocktake = canAdjust && !!itemId && !!stocktakeLocationId &&
    !stocktakeBalanceLoading && stocktakeBalance !== null && validCounted &&
    stocktakeDelta !== 0 && stocktakeNote.trim().length >= 3 && stocktakeNote.trim().length <= 300;

  async function runWaste() {
    if (!canWaste || !itemId) return;
    setSaving("waste");
    setOperationFeedback("waste", null);
    try {
      await CoreInventoryService.recordWaste({
        itemId,
        quantity: Number(wasteQty),
        movementType: disposalType,
        note: disposalNote.trim() || undefined,
        locationId: wasteLocationId || undefined,
      });
      setOperationFeedback("waste", {
        tone: "success",
        message: "تم تسجيل الاستبعاد وخصم الكمية من دفتر المخزون.",
      });
      setDisposalNote("");
    } catch (err) {
      setOperationFeedback("waste", { tone: "danger", message: errorMessage(err) });
    } finally {
      setSaving("");
    }
  }

  async function runStocktake() {
    if (!canConfirmStocktake || stocktakeBalance === null) return;
    setSaving("stocktake");
    setOperationFeedback("stocktake", null);
    try {
      await CoreInventoryService.adjustAfterStocktake({
        itemId,
        locationId: stocktakeLocationId,
        countedQty: countedNumber,
        expectedQty: stocktakeBalance,
        note: stocktakeNote.trim(),
      });
      setOperationFeedback("stocktake", {
        tone: "success",
        message: "تم تسجيل فرق الجرد في الدفتر.",
      });
      setCountedQty("");
      setStocktakeNote("");
      setStocktakeRefresh((current) => current + 1);
    } catch (err) {
      setOperationFeedback("stocktake", { tone: "danger", message: errorMessage(err) });
      if (err instanceof CoreApiError && err.code === "inventory:stocktake_stale_balance") {
        setCountedQty("");
        setStocktakeRefresh((current) => current + 1);
      }
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
      <p className="text-muted">استبعاد الهدر والتالف والمنتهي يسجل حركة خصم. الجرد يسجل الفرق، والتحويل يحتاج موقعين مختلفين.</p>
      <DashboardFieldV2 id="inv-ops-item" label="المادة">
        <DashboardSelectV2 value={itemId} options={items.map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => {
          setItemId(value);
          setCountedQty("");
          setOperationFeedback("stocktake", null);
        }} />
      </DashboardFieldV2>
      <div className="border rounded p-3 mb-3">
        <h3 className="h6">استبعاد مادة من المخزون</h3>
        <DashboardFieldV2 id="inv-disposal-type" label="سبب الاستبعاد">
          <DashboardSelectV2
            value={disposalType}
            options={[
              { value: "WASTE_OUT", label: "هدر" },
              { value: "DAMAGED_OUT", label: "تالف" },
              { value: "EXPIRED_OUT", label: "منتهي الصلاحية" },
            ]}
            onChange={(value) => setDisposalType(value as InventoryDisposalType)}
          />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-waste-loc" label="الموقع">
          <DashboardSelectV2 value={wasteLocationId} options={locations.map((loc) => ({ value: loc.id, label: loc.name || loc.id }))} onChange={setWasteLocationId} />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-waste-qty" label="الكمية المستبعدة">
          <DashboardNumberInputV2 value={wasteQty} onChange={(e) => setWasteQty(e.target.value)} />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-disposal-note" label="ملاحظة (اختياري)">
          <input className="form-control" value={disposalNote} onChange={(event) => setDisposalNote(event.target.value)} placeholder="سبب إضافي أو رقم التشغيلة إن وجد" />
        </DashboardFieldV2>
        {feedback.waste ? (
          <DashboardActionFeedbackV2
            compact
            revealOnMount
            tone={feedback.waste.tone}
            title={feedback.waste.tone === "success" ? "تم تسجيل الاستبعاد" : "تعذر تسجيل الاستبعاد"}
            description={feedback.waste.message}
          />
        ) : null}
        {canWaste ? (
          <button type="button" className="btn btn-dark" disabled={!!saving || !itemId || !(Number(wasteQty) > 0)} onClick={() => void runWaste()}>
            {saving === "waste" ? "جاري التسجيل..." : "تسجيل الاستبعاد"}
          </button>
        ) : <p className="text-muted">لا توجد صلاحية هدر.</p>}
      </div>
      <div className="border rounded p-3 mb-3">
        <h3 className="h6">جرد حسب الموقع</h3>
        <p className="small text-muted">اختاري موقع التخزين، ثم قارني الكمية الفعلية بالرصيد المسجل قبل الاعتماد. لا يتم تغيير مواقع أخرى.</p>
        <DashboardFieldV2 id="inv-stocktake-location" label="الموقع المطلوب جرده">
          <DashboardSelectV2 value={stocktakeLocationId} options={locations.map((loc) => ({ value: loc.id, label: loc.name || loc.id }))} onChange={(value) => {
            setStocktakeLocationId(value);
            setCountedQty("");
            setOperationFeedback("stocktake", null);
          }} />
        </DashboardFieldV2>
        <div className="alert alert-light border" role="status">
          {!itemId || !stocktakeLocationId ? "حددي المادة وموقع التخزين لعرض الرصيد الحالي." :
            stocktakeBalanceLoading ? "جاري قراءة الرصيد من Core..." :
              stocktakeBalanceError ? `تعذر قراءة الرصيد: ${stocktakeBalanceError}` :
                stocktakeBalance === null ? "الرصيد غير متاح حالياً." :
                  `الرصيد المسجل في هذا الموقع: ${stocktakeBalance} ${items.find((item) => item.id === itemId)?.unit || ""}`}
        </div>
        <DashboardFieldV2 id="inv-count-qty" label="الكمية المعدودة فعلياً">
          <DashboardNumberInputV2 value={countedQty} onChange={(e) => setCountedQty(e.target.value)} />
        </DashboardFieldV2>
        {stocktakeDelta !== null ? (
          <div className={`alert ${stocktakeDelta === 0 ? "alert-success" : "alert-warning"}`} role="status">
            {stocktakeDelta === 0 ? "الرصيد مطابق، لا يوجد فرق جرد لتسجيله." :
              `فرق الجرد: ${stocktakeDelta > 0 ? "+" : ""}${stocktakeDelta} ${items.find((item) => item.id === itemId)?.unit || ""}`}
          </div>
        ) : null}
        <DashboardFieldV2 id="inv-stocktake-note" label="سبب فرق الجرد (إلزامي)">
          <input className="form-control" value={stocktakeNote} maxLength={300} onChange={(event) => setStocktakeNote(event.target.value)} placeholder="سبب الفرق أو مرجع محضر الجرد" />
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
          <button type="button" className="btn btn-dark" disabled={!!saving || !canConfirmStocktake} onClick={() => void runStocktake()}>
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
