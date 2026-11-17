import { useEffect, useState } from "react";
import { CoreInventoryService } from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

function msg(error: unknown) {
  if (error instanceof CoreApiError) return [error.code, error.message].filter(Boolean).join(" — ");
  return "تعذر تنفيذ أمر الشراء.";
}

export default function DashboardInventoryPurchaseOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [supplierNameById, setSupplierNameById] = useState<Record<string, string>>({});
  const [items, setItems] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("10");
  const [cost, setCost] = useState("3");
  const [orderId, setOrderId] = useState("");
  const [lineId, setLineId] = useState("");
  const [recvQty, setRecvQty] = useState("10");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const unwrap = (value: unknown) => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") {
        const rec = value as Record<string, unknown>;
        for (const key of ["items", "suppliers", "orders", "data", "rows", "results"]) {
          if (Array.isArray(rec[key])) return rec[key];
        }
      }
      return [];
    };
    try {
      const po = await CoreInventoryService.listPurchaseOrders();
      setOrders(unwrap(po) as any[]);
    } catch (e) {
      console.error("listPurchaseOrders", e);
    }
    try {
      const inv = await CoreInventoryService.listItems();
      setItems(unwrap(inv) as any[]);
    } catch (e) {
      console.error("listItems", e);
    }
    try {
      const sup = await CoreInventoryService.listSuppliers();
      const list = unwrap(sup) as any[];
      setSuppliers(list);
      const map: Record<string, string> = {};
      for (const row of list || []) map[String(row.id || row.supplier_id)] = String(row.name || row.supplier_name || row.id);
      setSupplierNameById(map);
    } catch (e) {
      console.error("listSuppliers", e);
      setNotice(msg(e));
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="inventory-inner-workspace inventory-inner-purchase-orders">
      <div className="inventory-inner-intro"><div><span className="inventory-inner-eyebrow">دورة المشتريات</span><h4>إدارة أوامر الشراء</h4><p>أنشئ أمر شراء، أضف المواد والكميات، ثم سجّل الاستلام إلى المخزون.</p></div><span className="inventory-inner-count">أوامر مسجلة: {orders.length.toLocaleString("ar-SA")}</span></div>
      {notice ? <div className="alert alert-info py-2">{notice}</div> : null}
      <div className="inventory-inner-panel"><div className="inventory-inner-panel-heading"><span className="inventory-inner-step">01</span><div><h5>إنشاء أمر شراء</h5><p>حدّد المورد وأضف ملاحظة اختيارية.</p></div></div><div className="row g-3">
        <div className="col-md-4"><label className="inventory-inner-label" htmlFor="inventory-po-supplier">المورد</label>
          <select id="inventory-po-supplier" className="form-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">بدون مورد</option>
            {suppliers.map((s) => <option key={s.id || s.supplier_id} value={s.id || s.supplier_id}>{s.name || s.supplier_name || s.id}</option>)}
          </select>
        </div>
        <div className="col-md-5"><label className="inventory-inner-label" htmlFor="inventory-po-note">ملاحظة الأمر</label>
          <input id="inventory-po-note" className="form-control" placeholder="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="col-md-3 inventory-inner-action-column"><button className="btn btn-dark w-100" disabled={busy} onClick={() => void (async () => {
            try { setBusy(true); setNotice(""); const created: any = await CoreInventoryService.createPurchaseOrder({ supplierId: supplierId || null, note }); setOrderId(created?.id || ""); setNotice("تم إنشاء الأمر"); await load(); }
            catch (e) { setNotice(msg(e)); } finally { setBusy(false); }
          })()}>إنشاء أمر</button>
        </div>
      </div></div>
      <div className="inventory-inner-panel"><div className="inventory-inner-panel-heading"><span className="inventory-inner-step">02</span><div><h5>تفاصيل المواد</h5><p>اختر الأمر والمادة وأدخل الكمية وتكلفة الوحدة.</p></div></div><div className="row g-3">
        <div className="col-md-3"><label className="inventory-inner-label" htmlFor="inventory-po-order-id">رقم الأمر</label><input id="inventory-po-order-id" className="form-control" placeholder="رقم الأمر" value={orderId} onChange={(e) => setOrderId(e.target.value)} /></div>
        <div className="col-md-3"><label className="inventory-inner-label" htmlFor="inventory-po-item">المادة</label>
          <select id="inventory-po-item" className="form-select" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">مادة</option>
            {items.map((it) => <option key={it.id} value={it.id}>{it.name || it.item_name || it.id}</option>)}
          </select>
        </div>
        <div className="col-md-2"><label className="inventory-inner-label" htmlFor="inventory-po-qty">الكمية</label><input id="inventory-po-qty" inputMode="decimal" className="form-control" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="col-md-2"><label className="inventory-inner-label" htmlFor="inventory-po-cost">تكلفة الوحدة (ر.س)</label><input id="inventory-po-cost" inputMode="decimal" className="form-control" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
        <div className="col-md-2 inventory-inner-action-column">
          <button className="btn btn-outline-dark w-100" disabled={busy} onClick={() => void (async () => {
            try {
              setBusy(true); setNotice("");
              const line: any = await CoreInventoryService.addPurchaseOrderLine({ purchaseOrderId: orderId, itemId, qtyOrdered: Number(qty), unitCostHalalas: Math.round(Number(cost) * 100) });
              setLineId(line?.id || ""); setNotice("تمت إضافة السطر"); await load();
            } catch (e) { setNotice(msg(e)); } finally { setBusy(false); }
          })()}>إضافة سطر</button>
        </div>
      </div></div>
      <div className="inventory-inner-panel"><div className="inventory-inner-panel-heading"><span className="inventory-inner-step">03</span><div><h5>تسجيل استلام</h5><p>أدخل رقم السطر والكمية المستلمة لإضافتها للمخزون.</p></div></div><div className="row g-3">
        <div className="col-md-4"><label className="inventory-inner-label" htmlFor="inventory-po-line">رقم السطر</label><input id="inventory-po-line" className="form-control" placeholder="رقم السطر" value={lineId} onChange={(e) => setLineId(e.target.value)} /></div>
        <div className="col-md-4"><label className="inventory-inner-label" htmlFor="inventory-po-received">الكمية المستلمة</label><input id="inventory-po-received" inputMode="decimal" className="form-control" value={recvQty} onChange={(e) => setRecvQty(e.target.value)} /></div>
        <div className="col-md-4 inventory-inner-action-column">
          <button className="btn btn-dark w-100" disabled={busy} onClick={() => void (async () => {
            try { setBusy(true); setNotice(""); await CoreInventoryService.receivePurchaseOrderLine({ lineId, quantity: Number(recvQty) }); setNotice("تم الاستلام ودخول المخزون"); await load(); }
            catch (e) { setNotice(msg(e)); } finally { setBusy(false); }
          })()}>استلام</button>
        </div>
      </div></div>
      <div className="inventory-inner-panel inventory-inner-panel--list"><div className="inventory-inner-panel-heading"><span className="inventory-inner-step">04</span><div><h5>الأوامر المسجلة</h5><p>اضغط على أي أمر لاستخدام رقمه عند إضافة المواد.</p></div></div>
      <div className="table-responsive">
        <table className="table align-middle inventory-inner-table">
          <thead><tr><th>الأمر</th><th>المورد</th><th>الحالة</th><th>ملاحظة</th></tr></thead>
          <tbody>
            {orders.map((row) => (
              <tr key={row.id} onClick={() => setOrderId(row.id)} style={{ cursor: "pointer" }}>
                <td>{row.id}</td><td>{supplierNameById[String(row.supplier_id)] || row.supplier_id || "—"}</td><td>{row.status}</td><td>{row.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>{orders.length === 0 ? <p className="inventory-inner-empty">لا توجد أوامر شراء مسجلة حاليًا.</p> : null}</div>
    </div>
  );
}
