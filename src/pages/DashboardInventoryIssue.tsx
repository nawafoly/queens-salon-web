import { useEffect, useMemo, useState } from "react";
import {
  DashboardActionFeedbackV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardNumberInputV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import { CoreHrService } from "../services/CoreHrService";
import { CoreInventoryService, type InventoryItem } from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) return [error.code, error.message].filter(Boolean).join(" — ");
  return "تعذر تنفيذ حركة الصرف.";
}

type ActionFeedback = { tone: "success" | "danger"; message: string } | null;

export default function DashboardInventoryIssue() {
  const { hasPermission } = usePermissions();
  const canAdjust = hasPermission("inventory.adjust");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [itemId, setItemId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [quantityError, setQuantityError] = useState("");
  const [mode, setMode] = useState<"issue" | "return">("issue");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>(null);

  const issueItems = useMemo(
    () => items.filter((item) => item.consumption_policy === "EMPLOYEE_ISSUED" && Number(item.is_active) === 1),
    [items]
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const [itemRows, employeeRows] = await Promise.all([
          CoreInventoryService.listItems({ active: "1" }),
          CoreHrService.listEmployees({ status: "active" }),
        ]);
        if (cancelled) return;
        setItems(itemRows || []);
        setEmployees(
          (employeeRows || []).map((row: { id?: string; fullName?: string; name?: string; displayName?: string }) => ({
            id: String(row.id || ""),
            name: String(row.fullName || row.displayName || row.name || row.id || ""),
          })).filter((row) => row.id)
        );
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

  async function submit() {
    if (!canAdjust || !itemId || !employeeId) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setQuantityError("الكمية يجب أن تكون أكبر من صفر.");
      return;
    }

    setSaving(true);
    setQuantityError("");
    setActionFeedback(null);
    try {
      if (mode === "issue") {
        await CoreInventoryService.issueToEmployee({ itemId, employeeId, quantity: qty });
        setActionFeedback({ tone: "success", message: "تم صرف المادة للموظفة وخصمها من الدفتر." });
      } else {
        await CoreInventoryService.returnFromEmployee({ itemId, employeeId, quantity: qty });
        setActionFeedback({ tone: "success", message: "تم إرجاع المادة إلى المخزن." });
      }
    } catch (err) {
      setActionFeedback({ tone: "danger", message: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={6} />;
  if (loadError) {
    return <DashboardErrorStateV2 title="تعذر تحميل شاشة صرف المخزون" description={loadError} />;
  }

  return (
    <div>
      <p className="text-muted">للمواد ذات سياسة «صرف للموظفة» فقط. لا تستخدم هذا لتأكيد استهلاك خدمة.</p>
      {!issueItems.length ? (
        <DashboardEmptyStateV2 title="لا توجد مواد قابلة للصرف" description="أنشئ مادة بسياسة صرف للموظفة من تبويب المواد." />
      ) : (
        <>
          <DashboardFieldV2 id="inv-issue-mode" label="نوع الحركة">
            <DashboardSelectV2
              value={mode}
              options={[
                { value: "issue", label: "صرف للموظفة" },
                { value: "return", label: "إرجاع من الموظفة" },
              ]}
              onChange={(value) => {
                setMode(value as "issue" | "return");
                setActionFeedback(null);
              }}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="inv-issue-item" label="المادة">
            <DashboardSelectV2
              value={itemId}
              options={issueItems.map((item) => ({ value: item.id, label: `${item.name} (${item.unit})` }))}
              onChange={(value) => {
                setItemId(value);
                setActionFeedback(null);
              }}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="inv-issue-emp" label="الموظفة">
            <DashboardSelectV2
              value={employeeId}
              options={employees.map((row) => ({ value: row.id, label: row.name }))}
              onChange={(value) => {
                setEmployeeId(value);
                setActionFeedback(null);
              }}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="inv-issue-qty" label="الكمية" error={quantityError || undefined}>
            <DashboardNumberInputV2
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                if (quantityError) setQuantityError("");
                setActionFeedback(null);
              }}
            />
          </DashboardFieldV2>
          {actionFeedback ? (
            <DashboardActionFeedbackV2
              compact
              revealOnMount
              tone={actionFeedback.tone}
              title={
                actionFeedback.tone === "success"
                  ? mode === "issue" ? "تم الصرف" : "تم الإرجاع"
                  : mode === "issue" ? "تعذر الصرف" : "تعذر الإرجاع"
              }
              description={actionFeedback.message}
            />
          ) : null}
          {canAdjust ? (
            <button type="button" className="btn btn-dark" disabled={saving || !itemId || !employeeId} onClick={() => void submit()}>
              {saving ? "جاري التنفيذ..." : mode === "issue" ? "تأكيد الصرف" : "تأكيد الإرجاع"}
            </button>
          ) : (
            <p className="text-muted">لا توجد صلاحية تسوية/صرف مخزون.</p>
          )}
        </>
      )}
    </div>
  );
}
