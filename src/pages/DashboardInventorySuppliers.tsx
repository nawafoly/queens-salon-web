import { useEffect, useState } from "react";
import { usePermissions } from "../security/PermissionContext";
import { CoreInventoryService, type InventorySupplier } from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

export default function DashboardInventorySuppliers() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("inventory.items.manage");
  const [rows, setRows] = useState<InventorySupplier[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      setRows((await CoreInventoryService.listSuppliers()) || []);
    } catch (err) {
      setError(err instanceof CoreApiError ? err.message : "تعذر تحميل الموردين");
    }
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    if (!name.trim()) return;
    setError("");
    try {
      if (!canManage) return;
      await CoreInventoryService.createSupplier({ name: name.trim(), phone: phone.trim() || undefined });
      setName("");
      setPhone("");
      await load();
    } catch (err) {
      setError(err instanceof CoreApiError ? err.message : "تعذر حفظ المورد");
    }
  }

  return (
    <div>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div className="d-flex gap-2 mb-3">
        <input className="form-control" placeholder="اسم المورد" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="form-control" placeholder="الجوال" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button type="button" className="btn btn-dark" onClick={() => void save()}>إضافة</button>
      </div>
      {!rows.length ? <p className="text-muted">لا يوجد موردون بعد.</p> : (
        <ul className="list-group">
          {rows.map((row) => (
            <li key={row.id} className="list-group-item d-flex justify-content-between">
              <span>{row.name}</span>
              <span className="text-muted">{row.phone || ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
