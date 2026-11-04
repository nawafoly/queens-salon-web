import { useEffect, useState } from "react";
import { usePermissions } from "../security/PermissionContext";
import {
  CoreInventoryService,
  type InventoryItem,
  type InventoryLocation,
  type InventoryPurchaseOrder,
  type InventoryPurchaseOrderDetail,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

type Supplier = { id: string; name: string };

const statusLabel: Record<string, string> = {
  DRAFT: "مسودة", ORDERED: "طلب قديم بانتظار الاعتماد", APPROVED: "معتمد",
  PARTIAL: "مستلم جزئيًا", RECEIVED: "مستلم بالكامل", CANCELLED: "ملغى",
};

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) return [error.code, error.message].filter(Boolean).join(" — ");
  return "تعذّر إكمال العملية. حدّث البيانات وحاول مرة أخرى.";
}

function asList<T>(value: unknown, names: string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of names) if (Array.isArray(rec[key])) return rec[key] as T[];
  }
  return [];
}

export default function DashboardInventoryPurchaseOrders() {
  const { role, hasPermission } = usePermissions();
  const canAdjust = hasPermission("inventory.adjust");
  const canDecide = canAdjust && (role === "admin" || role === "owner");
  const [orders, setOrders] = useState<InventoryPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<InventoryPurchaseOrderDetail | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("10");
  const [cost, setCost] = useState("3");
  const [reason, setReason] = useState("");
  const [receiveLineId, setReceiveLineId] = useState("");
  const [receiveQty, setReceiveQty] = useState("1");
  const [receiveLocationId, setReceiveLocationId] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh(id = selectedId) {
    const [orderRows, next] = await Promise.all([
      CoreInventoryService.listPurchaseOrders(),
      id ? CoreInventoryService.getPurchaseOrderDetail(id) : Promise.resolve(null),
    ]);
    setOrders(asList<InventoryPurchaseOrder>(orderRows, ["orders", "items", "data"]));
    setDetail(next);
    if (next) {
      const available = next.lines.filter((line) => Number(line.qty_ordered) > Number(line.qty_received));
      setReceiveLineId((prev) => available.some((line) => line.id === prev) ? prev : (available[0]?.id || ""));
    } else setReceiveLineId("");
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      CoreInventoryService.listPurchaseOrders(),
      CoreInventoryService.listSuppliers(),
      canAdjust ? CoreInventoryService.listItems({ active: "1" }) : Promise.resolve([]),
      canAdjust ? CoreInventoryService.listLocations() : Promise.resolve([]),
    ]).then(([orderRows, supplierRows, itemRows, locationRows]) => {
      if (!active) return;
      setOrders(asList<InventoryPurchaseOrder>(orderRows, ["orders", "items", "data"]));
      setSuppliers(asList<Supplier>(supplierRows, ["suppliers", "items", "data"]));
      setItems(asList<InventoryItem>(itemRows, ["items", "data"]));
      setLocations(asList<InventoryLocation>(locationRows, ["locations", "items", "data"])
        .filter((location) => Number(location.active ?? 1) === 1));
    }).catch((error: unknown) => { if (active) setNotice(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canAdjust]);

  async function selectOrder(id: string) {
    setSelectedId(id);
    setDetail(null);
    setNotice("");
    setBusy("select");
    try {
      const next = await CoreInventoryService.getPurchaseOrderDetail(id);
      setDetail(next);
      setReceiveLineId(next.lines.find((line) => Number(line.qty_ordered) > Number(line.qty_received))?.id || "");
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(""); }
  }

  async function run(name: string, action: () => Promise<string>) {
    if (busy) return;
    setBusy(name);
    setNotice("");
    try { setNotice(await action()); }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(""); }
  }

  const editable = detail?.status === "DRAFT";
  const approved = detail?.decisions.some((entry) => entry.decision === "APPROVE") || false;
  const receivable = (detail?.status === "APPROVED" || detail?.status === "PARTIAL") && approved;
  const reviewable = detail?.status === "DRAFT" || detail?.status === "ORDERED" ||
    (detail?.status === "PARTIAL" && !approved);
  const cancellable = detail?.status === "DRAFT" ||
    detail?.status === "ORDERED" || detail?.status === "APPROVED";
  const availableLines = detail?.lines.filter((line) => Number(line.qty_ordered) > Number(line.qty_received)) || [];
  const pickedLine = availableLines.find((line) => line.id === receiveLineId) || availableLines[0];

  return (
    <div className="d-flex flex-column gap-3">
      <p className="text-muted mb-0">
        دورة الشراء: إنشاء مسودة، إضافة المواد، اعتماد الإدارة بسبب موثق، ثم الاستلام الفعلي.
        لا يتغير رصيد المخزون عند إنشاء الأمر أو اعتماده؛ يتغير فقط عند الاستلام.
      </p>
      {notice && <div className="alert alert-info py-2" role="status">{notice}</div>}
      {loading && <p className="text-muted">جارٍ تحميل أوامر الشراء...</p>}

      {canAdjust && <section className="card card-body">
        <h3 className="h6">إنشاء أمر شراء جديد</h3>
        <div className="row g-2 align-items-end">
          <div className="col-12 col-md-4">
            <label className="form-label">المورد</label>
            <select className="form-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">بدون مورد</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="col-12 col-md-5">
            <label className="form-label">ملاحظة الأمر</label>
            <input className="form-control" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="col-12 col-md-3">
            <button className="btn btn-dark w-100" disabled={!!busy} onClick={() => void run("create", async () => {
              const created = await CoreInventoryService.createPurchaseOrder({ supplierId: supplierId || null, note }) as InventoryPurchaseOrder;
              setSelectedId(created.id);
              await refresh(created.id);
              return "أُنشئت المسودة. أضف مواد الأمر قبل الاعتماد.";
            })}>إنشاء مسودة</button>
          </div>
        </div>
      </section>}

      <section className="card card-body">
        <h3 className="h6">أوامر الشراء</h3>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead><tr><th>رقم الأمر</th><th>المورد</th><th>الحالة</th><th>التفاصيل</th></tr></thead>
            <tbody>
              {orders.map((o) => <tr key={o.id} className={selectedId === o.id ? "table-active" : ""}>
                <td className="text-break">{o.id}</td>
                <td>{suppliers.find((s) => s.id === o.supplier_id)?.name || o.supplier_id || "—"}</td>
                <td>{statusLabel[o.status] || o.status}</td>
                <td><button className="btn btn-outline-secondary btn-sm" disabled={!!busy} onClick={() => void selectOrder(o.id)}>فتح</button></td>
              </tr>)}
              {!orders.length && <tr><td colSpan={4} className="text-center text-muted">لا توجد أوامر شراء بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selectedId && !detail && <p className="text-muted">جارٍ تحميل تفاصيل الأمر...</p>}
      {detail && <section className="card card-body d-flex flex-column gap-3">
        <div className="d-flex flex-wrap justify-content-between gap-2">
          <h3 className="h6 mb-0">تفاصيل الأمر {detail.id}</h3>
          <span className="badge text-bg-secondary">{statusLabel[detail.status] || detail.status}</span>
        </div>
        {detail.note && <div className="text-muted">{detail.note}</div>}

        {canAdjust && editable && <div className="row g-2 align-items-end">
          <div className="col-12 col-md-4">
            <label className="form-label">المادة</label>
            <select className="form-select" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">اختر مادة</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label">الكمية</label>
            <input type="number" min="0.0001" step="any" className="form-control" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label">تكلفة الوحدة (ر.س)</label>
            <input type="number" min="0" step="0.01" className="form-control" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div className="col-12 col-md-3">
            <button className="btn btn-outline-dark w-100" disabled={!!busy || !itemId || !(Number(qty) > 0) || !cost.trim() || Number(cost) < 0 || !Number.isFinite(Number(cost))} onClick={() => void run("line", async () => {
              await CoreInventoryService.addPurchaseOrderLine({ purchaseOrderId: detail.id, itemId, qtyOrdered: Number(qty), unitCostHalalas: Math.round(Number(cost) * 100) });
              await refresh(detail.id);
              return "تمت إضافة المادة إلى المسودة.";
            })}>إضافة مادة</button>
          </div>
        </div>}

        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0">
            <thead><tr><th>المادة</th><th>المطلوب</th><th>المستلم</th><th>المتبقي</th><th>تكلفة الوحدة</th></tr></thead>
            <tbody>
              {detail.lines.map((line) => <tr key={line.id}>
                <td>{line.item_name || line.item_id}</td>
                <td>{line.qty_ordered} {line.item_unit}</td><td>{line.qty_received}</td>
                <td>{Math.max(0, Number(line.qty_ordered) - Number(line.qty_received))}</td>
                <td>{line.unit_cost_halalas == null ? "—" : `${(line.unit_cost_halalas / 100).toFixed(2)} ر.س`}</td>
              </tr>)}
              {!detail.lines.length && <tr><td colSpan={5} className="text-center text-muted">لم تضف أي مواد بعد.</td></tr>}
            </tbody>
          </table>
        </div>

          {detail.status === "PARTIAL" && !approved && <div className="alert alert-warning mb-0">
            أمر شراء قديم مستلم جزئيًا دون اعتماد موثق. يجب مراجعته واعتماد استكماله قبل أي استلام جديد.
          </div>}
          {canDecide && (reviewable || cancellable) && <div className="border rounded p-3">
          <label className="form-label" htmlFor="po-decision-reason">سبب الاعتماد أو الإلغاء (إلزامي، 3 أحرف على الأقل)</label>
          <textarea id="po-decision-reason" className="form-control" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="d-flex flex-wrap gap-2 mt-2">
            {reviewable && <button className="btn btn-success" disabled={!!busy || reason.trim().length < 3 || !detail.lines.length} onClick={() => void run("approve", async () => {
              await CoreInventoryService.decidePurchaseOrder(detail.id, { decision: "APPROVE", reason: reason.trim() });
              setReason(""); await refresh(detail.id);
              return "تم اعتماد أمر الشراء. يمكن الآن تسجيل الاستلام الفعلي.";
            })}>اعتماد الأمر</button>}
            {cancellable && <button className="btn btn-outline-danger" disabled={!!busy || reason.trim().length < 3} onClick={() => void run("cancel", async () => {
              await CoreInventoryService.decidePurchaseOrder(detail.id, { decision: "CANCEL", reason: reason.trim() });
              setReason(""); await refresh(detail.id);
              return "أُلغي أمر الشراء دون التأثير على رصيد المخزون.";
            })}>إلغاء الأمر</button>}
          </div>
        </div>}

        {canAdjust && receivable && availableLines.length > 0 && <div className="row g-2 align-items-end">
          <div className="col-12 col-md-4">
            <label className="form-label">المادة المطلوب استلامها</label>
            <select className="form-select" value={pickedLine?.id || ""} onChange={(e) => setReceiveLineId(e.target.value)}>
              {availableLines.map((line) => <option key={line.id} value={line.id}>{line.item_name || line.item_id} — المتبقي {Number(line.qty_ordered) - Number(line.qty_received)} {line.item_unit}</option>)}
            </select>
          </div>
          <div className="col-12 col-md-3">
            <label className="form-label">موقع الاستلام</label>
            <select className="form-select" value={receiveLocationId} onChange={(e) => setReceiveLocationId(e.target.value)}>
              <option value="">اختر مستودعًا</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label">الكمية المستلمة فعليًا</label>
            <input type="number" min="0.0001" step="any" className="form-control" value={receiveQty} onChange={(e) => setReceiveQty(e.target.value)} />
          </div>
          <div className="col-6 col-md-3">
            <button className="btn btn-dark w-100" disabled={!!busy || !pickedLine || !locations.some((location) => location.id === receiveLocationId) || !(Number(receiveQty) > 0) || Number(receiveQty) > Number(pickedLine.qty_ordered) - Number(pickedLine.qty_received)} onClick={() => void run("receive", async () => {
              if (!pickedLine) throw new Error("Select a line");
              await CoreInventoryService.receivePurchaseOrderLine({ lineId: pickedLine.id, quantity: Number(receiveQty), locationId: receiveLocationId });
              await refresh(detail.id);
              return "تم توثيق الاستلام وإضافة الكمية للمخزون.";
            })}>تأكيد الاستلام</button>
          </div>
        </div>}

        <div>
          <h4 className="h6">سجل قرارات الأمر</h4>
          {detail.decisions.length === 0
            ? <p className="text-muted mb-0">لا توجد قرارات مسجلة.</p>
            : <ul className="list-group">{detail.decisions.map((entry, i) => <li className="list-group-item" key={`${entry.decision}-${i}`}>
              <strong>{entry.decision === "APPROVE" ? "اعتماد" : "إلغاء"}</strong> — {entry.reason}
              <div className="small text-muted">{entry.decided_by_name || "الإدارة"} — {new Date(entry.decided_at).toLocaleString("ar-SA")}</div>
            </li>)}</ul>}
        </div>
      </section>}
    </div>
  );
}
