import { useEffect, useMemo, useState } from "react";
import {
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

export default function DashboardInventoryIssue() {
  const { hasPermission } = usePermissions();
  const canAdjust = hasPermission("inventory.adjust");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [itemId, setItemId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [mode, setMode] = useState<"issue" | "return">("issue");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const issueItems = useMemo(
    () => items.filter((item) => item.consumption_policy === "EMPLOYEE_ISSUED" && Number(item.is_active) === 1),
    [items]
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [itemRows, employeeRows] = await Promise.all([
          CoreInventoryService.listItems({ active: "1" }),
          CoreHrService.listEmployees({ status: "active" }),
        ]);
        setItems(itemRows || []);
        setEmployees(
          (employeeRows || []).map((row: { id?: string; fullName?: string; name?: string; displayName?: string }) => ({
            id: String(row.id || ""),
            name: String(row.fullName || row.displayName || row.name || row.id || ""),
          })).filter((row) => row.id)
        );
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function submit() {
    if (!canAdjust || !itemId || !employeeId) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("الكمية يجب أن تكون أكبر من صفر.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (mode === "issue") {
        await CoreInventoryService.issueToEmployee({ itemId, employeeId, quantity: qty });
        setNotice("تم صرف المادة للموظفة وخصمها من الدفتر.");
      } else {
        await CoreInventoryService.returnFromEmployee({ itemId, employeeId, quantity: qty });
        setNotice("تم إرجاع المادة إلى المخزن.");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={6} />;

  return (
    <div>
      <p className="text-muted">للمواد ذات سياسة «صرف للموظفة» فقط. لا تستخدم هذا لتأكيد استهلاك خدمة.</p>
      {error ? <DashboardErrorStateV2 title="تعذر تنفيذ الحركة" description={error} /> : null}
      {notice ? <p className="text-success">{notice}</p> : null}
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
              onChange={(value) => setMode(value as "issue" | "return")}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="inv-issue-item" label="المادة">
            <DashboardSelectV2
              value={itemId}
              options={issueItems.map((item) => ({ value: item.id, label: `${item.name} (${item.unit})` }))}
              onChange={setItemId}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="inv-issue-emp" label="الموظفة">
            <DashboardSelectV2
              value={employeeId}
              options={employees.map((row) => ({ value: row.id, label: row.name }))}
              onChange={setEmployeeId}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="inv-issue-qty" label="الكمية">
            <DashboardNumberInputV2 value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </DashboardFieldV2>
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
