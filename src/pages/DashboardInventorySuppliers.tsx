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
    <div className="inventory-inner-workspace inventory-inner-suppliers">
      <div className="inventory-inner-intro"><div><span className="inventory-inner-eyebrow">سلسلة التوريد</span><h4>دليل الموردين</h4><p>تابع جهات التوريد وأضف موردين جدد لإدارة المشتريات بسهولة.</p></div><span className="inventory-inner-count">موردون مسجلون: {rows.length.toLocaleString("ar-SA")}</span></div>
      {loadError ? (
        <DashboardErrorStateV2 title="تعذر تحميل قائمة الموردين" description={loadError} compact />
      ) : null}
      <div className="inventory-inner-panel"><div className="inventory-inner-panel-heading"><span className="inventory-inner-step">01</span><div><h5>إضافة مورد</h5><p>بيانات جهة التوريد الأساسية.</p></div></div><div className="inventory-inner-supplier-form">
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
      </div></div>
      <div className="inventory-inner-panel inventory-inner-panel--list"><div className="inventory-inner-panel-heading"><span className="inventory-inner-step">02</span><div><h5>قائمة الموردين</h5><p>جهات التوريد المسجلة وأرقام التواصل.</p></div></div>
      {!rows.length ? <div className="inventory-inner-empty">لا يوجد موردون بعد. أضف أول مورد لبدء تنظيم التوريد.</div> : (
        <ul className="list-group inventory-inner-supplier-list">
          {rows.map((row) => (
            <li key={row.id} className="list-group-item d-flex justify-content-between">
              <span>{row.name}</span>
              <span className="text-muted">{row.phone || ""}</span>
            </li>
          ))}
        </ul>
      )}</div>
    </div>
  );
}
