import { useEffect, useState } from "react";
import {
  DashboardActionFeedbackV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import { CoreInventoryService, type InventorySupplier } from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

type ActionFeedback = { tone: "success" | "danger" | "warning"; message: string } | null;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof CoreApiError ? error.message : fallback;
}

export default function DashboardInventorySuppliers() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("inventory.items.manage");
  const [rows, setRows] = useState<InventorySupplier[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [nameError, setNameError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>(null);

  async function load(signal?: { cancelled: boolean }) {
    try {
      const nextRows = (await CoreInventoryService.listSuppliers()) || [];
      if (!signal?.cancelled) setRows(nextRows);
      return true;
    } catch (err) {
      if (!signal?.cancelled) setLoadError(errorMessage(err, "تعذر تحميل الموردين"));
      return false;
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };
    setLoading(true);
    setLoadError("");
    void load(signal).finally(() => {
      if (!signal.cancelled) setLoading(false);
    });
    return () => {
      signal.cancelled = true;
    };
  }, []);

  async function save() {
    if (!canManage) return;
    if (!name.trim()) {
      setNameError("اسم المورد مطلوب.");
      return;
    }

    setSaving(true);
    setNameError("");
    setActionFeedback(null);
    try {
      await CoreInventoryService.createSupplier({
        name: name.trim(),
        phone: phone.trim() || undefined,
      });
      setName("");
      setPhone("");
      setLoadError("");
      const refreshed = await load();
      setActionFeedback(
        refreshed
          ? { tone: "success", message: "تم إنشاء المورد وتحديث القائمة." }
          : { tone: "warning", message: "تم إنشاء المورد، لكن تعذر تحديث القائمة الآن. أعد تحميل الصفحة لعرضه." }
      );
    } catch (err) {
      setActionFeedback({ tone: "danger", message: errorMessage(err, "تعذر حفظ المورد") });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={4} />;

  return (
    <div>
      {loadError ? (
        <DashboardErrorStateV2 title="تعذر تحميل قائمة الموردين" description={loadError} compact />
      ) : null}
      <div className="d-flex gap-2 mb-3 flex-wrap align-items-end">
        <DashboardFieldV2 id="inventory-supplier-name" label="اسم المورد" required error={nameError || undefined}>
          <input
            className="form-control"
            placeholder="اسم المورد"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError("");
              setActionFeedback(null);
            }}
          />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inventory-supplier-phone" label="الجوال">
          <input
            className="form-control"
            placeholder="الجوال"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setActionFeedback(null);
            }}
          />
        </DashboardFieldV2>
        <div>
          {actionFeedback ? (
            <DashboardActionFeedbackV2
              compact
              revealOnMount
              tone={actionFeedback.tone}
              title={
                actionFeedback.tone === "success"
                  ? "تم إنشاء المورد"
                  : actionFeedback.tone === "warning"
                    ? "تم الحفظ مع تعذر التحديث"
                    : "تعذر إنشاء المورد"
              }
              description={actionFeedback.message}
            />
          ) : null}
          {canManage ? (
            <button type="button" className="btn btn-dark" disabled={saving} onClick={() => void save()}>
              {saving ? "جاري الإضافة..." : "إضافة"}
            </button>
          ) : null}
        </div>
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
