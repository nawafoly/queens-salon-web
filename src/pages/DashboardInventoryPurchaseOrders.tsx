import { useEffect, useState } from "react";
import { CoreInventoryService } from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

function msg(error: unknown) {
  if (error instanceof CoreApiError) return [error.code, error.message].filter(Boolean).join(" — ");
  return "تعذر تنفيذ أمر الشراء.";
}

export default function DashboardInventoryPurchaseOrders() {
  const [orders, setOrders] = useState<any[]>([]);
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
      setSuppliers(unwrap(sup) as any[]);
    } catch (e) {
      console.error("listSuppliers", e);
      setNotice(msg(e));
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="d-flex flex-column gap-3">
      <p className="text-muted mb-0">أمر شراء بسيط. الاستلام ينشئ حركة PURCHASE_RECEIPT_IN بتكلفة السطر (FIFO لاحقاً عند الصرف).</p>
      {notice ? <div className="alert alert-info py-2">{notice}</div> : null}
      <div className="row g-2">
        <div className="col-md-4">
          <select className="form-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">بدون مورد</option>
            {suppliers.map((s) => <option key={s.id || s.supplier_id} value={s.id || s.supplier_id}>{s.name || s.supplier_name || s.id}</option>)}
          </select>
        </div>
        <div className="col-md-5">
          <input className="form-control" placeholder="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="col-md-3">
          <button className="btn btn-dark w-100" disabled={busy} onClick={() => void (async () => {
            try { setBusy(true); setNotice(""); const created: any = await CoreInventoryService.createPurchaseOrder({ supplierId: supplierId || null, note }); setOrderId(created?.id || ""); setNotice("تم إنشاء الأمر"); await load(); }
            catch (e) { setNotice(msg(e)); } finally { setBusy(false); }
          })()}>إنشاء أمر</button>
        </div>
      </div>
      <div className="row g-2">
        <div className="col-md-3"><input className="form-control" placeholder="رقم الأمر" value={orderId} onChange={(e) => setOrderId(e.target.value)} /></div>
        <div className="col-md-3">
          <select className="form-select" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">مادة</option>
            {items.map((it) => <option key={it.id} value={it.id}>{it.name || it.item_name || it.id}</option>)}
          </select>
        </div>
        <div className="col-md-2"><input className="form-control" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="col-md-2"><input className="form-control" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
        <div className="col-md-2">
          <button className="btn btn-outline-dark w-100" disabled={busy} onClick={() => void (async () => {
            try {
              setBusy(true); setNotice("");
              const line: any = await CoreInventoryService.addPurchaseOrderLine({ purchaseOrderId: orderId, itemId, qtyOrdered: Number(qty), unitCostHalalas: Math.round(Number(cost) * 100) });
              setLineId(line?.id || ""); setNotice("تمت إضافة السطر"); await load();
            } catch (e) { setNotice(msg(e)); } finally { setBusy(false); }
          })()}>إضافة سطر</button>
        </div>
      </div>
      <div className="row g-2">
        <div className="col-md-4"><input className="form-control" placeholder="رقم السطر" value={lineId} onChange={(e) => setLineId(e.target.value)} /></div>
        <div className="col-md-4"><input className="form-control" value={recvQty} onChange={(e) => setRecvQty(e.target.value)} /></div>
        <div className="col-md-4">
          <button className="btn btn-dark w-100" disabled={busy} onClick={() => void (async () => {
            try { setBusy(true); setNotice(""); await CoreInventoryService.receivePurchaseOrderLine({ lineId, quantity: Number(recvQty) }); setNotice("تم الاستلام ودخول المخزون"); await load(); }
            catch (e) { setNotice(msg(e)); } finally { setBusy(false); }
          })()}>استلام</button>
        </div>
      </div>
      <div className="table-responsive">
        <table className="table align-middle">
          <thead><tr><th>الأمر</th><th>المورد</th><th>الحالة</th><th>ملاحظة</th></tr></thead>
          <tbody>
            {orders.map((row) => (
              <tr key={row.id} onClick={() => setOrderId(row.id)} style={{ cursor: "pointer" }}>
                <td>{row.id}</td><td>{row.supplier_id || "—"}</td><td>{row.status}</td><td>{row.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
