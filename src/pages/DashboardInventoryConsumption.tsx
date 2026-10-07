import { useEffect, useMemo, useState } from "react";
import {
  DashboardActionFeedbackV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardNumberInputV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
  DashboardDateInputV2,
} from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import { CoreBookingService } from "../services/CoreBookingService";
import { CoreHrService } from "../services/CoreHrService";
import {
  CoreInventoryService,
  type PendingServiceConsumption,
  type ServiceRecipeLine,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";
import type { CoreBooking } from "../types/coreApi";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) {
    return [error.code, error.message].filter(Boolean).join(" — ");
  }
  return "تعذر تأكيد الاستهلاك.";
}

type DraftLine = {
  recipeLineId: string | null;
  inventoryItemId: string;
  itemName: string;
  quantity: string;
  unit: string;
};
type ActionFeedback = { tone: "success" | "danger"; message: string } | null;

export default function DashboardInventoryConsumption() {
  const { hasPermission } = usePermissions();
  const canConfirm = hasPermission("inventory.consume.confirm");
  const [date, setDate] = useState(todayISO());
  const [bookings, setBookings] = useState<CoreBooking[]>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [bookingId, setBookingId] = useState("");
  const [bookingItemId, setBookingItemId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [recipeError, setRecipeError] = useState("");
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>(null);
  const [itemNames, setItemNames] = useState<Record<string, string>>({});
  const [overdueRows, setOverdueRows] = useState<PendingServiceConsumption[]>([]);

  const selectedBooking = useMemo(
    () => bookings.find((row) => row.id === bookingId) || null,
    [bookings, bookingId]
  );
  const items = selectedBooking?.items || [];

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setLoadError("");
      setBookingId("");
      setBookingItemId("");
      setLines([]);
      setLineErrors({});
      setRecipeError("");
      setActionFeedback(null);
      try {
        const [bookingRows, employeeRows, overdue] = await Promise.all([
          CoreBookingService.list({ date }),
          CoreHrService.listEmployees({ status: "active" }),
          CoreInventoryService.listPendingConsumptions({
            scope: "worklist",
            includeOverdue: "1",
            includeUpcoming: "0",
            lifecycle: "OVERDUE",
            overdueDays: 30,
            limit: 50,
          }).catch(() => []),
        ]);
        if (cancelled) return;
        setBookings(bookingRows || []);
        setOverdueRows(overdue || []);
        const inventoryItems = await CoreInventoryService.listItems({ active: "1" });
        if (cancelled) return;
        const names: Record<string, string> = {};
        for (const item of inventoryItems || []) names[item.id] = item.name;
        setItemNames(names);
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
  }, [date]);

  useEffect(() => {
    setBookingItemId("");
    setLines([]);
    setLineErrors({});
    setRecipeError("");
    setActionFeedback(null);
  }, [bookingId]);

  useEffect(() => {
    let cancelled = false;
    setLineErrors({});
    setRecipeError("");
    setActionFeedback(null);

    const item = items.find((row) => row.id === bookingItemId);
    if (!item) {
      setLines([]);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const recipe = await CoreInventoryService.getRecipeByService(item.serviceId);
        if (cancelled) return;
        const recipeLines = ((recipe as { lines?: ServiceRecipeLine[] } | null)?.lines || []).filter(
          (line) => line.line_type === "SPECIFIC_ITEM" && line.inventory_item_id
        );
        setLines(
          recipeLines.map((line) => ({
            recipeLineId: line.id,
            inventoryItemId: String(line.inventory_item_id),
            itemName: itemNames[String(line.inventory_item_id)] || String(line.inventory_item_id),
            quantity: String(line.default_qty),
            unit: line.unit,
          }))
        );
      } catch (err) {
        if (!cancelled) setRecipeError(errorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookingItemId]);

  async function confirm() {
    if (!canConfirm || !bookingItemId || !employeeId || !lines.length) return;

    const nextLineErrors: Record<string, string> = {};
    for (const line of lines) {
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        nextLineErrors[line.inventoryItemId] = "الكمية الفعلية يجب أن تكون أكبر من صفر.";
      }
    }
    if (Object.keys(nextLineErrors).length) {
      setLineErrors(nextLineErrors);
      setActionFeedback({ tone: "danger", message: "راجع كميات الاستهلاك المميزة ثم أعد التأكيد." });
      return;
    }

    setSaving(true);
    setLineErrors({});
    setActionFeedback(null);
    try {
      await CoreInventoryService.confirmConsumption({
        bookingItemId,
        employeeId,
        lines: lines.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          quantity: Number(line.quantity),
          unit: line.unit,
          recipeLineId: line.recipeLineId,
        })),
      });
      setActionFeedback({ tone: "success", message: "تم تأكيد الاستهلاك وخصم المخزون من الدفتر." });
    } catch (err) {
      setActionFeedback({ tone: "danger", message: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={6} />;
  if (loadError) {
    return <DashboardErrorStateV2 title="تعذر تحميل استهلاك الخدمات" description={loadError} />;
  }

  return (
    <div>
      <p className="text-muted">التأكيد هنا يخصم المخزون فعلياً. لا تستخدمه عند إنشاء الحجز.</p>

      {overdueRows.length ? (
        <div className="border rounded p-3 mb-3" style={{ borderColor: "#fecaca", background: "#fef2f2" }}>
          <strong style={{ color: "#7f1d1d" }}>متأخر بانتظار التأكيد ({overdueRows.length})</strong>
          <p className="text-muted mb-2" style={{ fontSize: 13 }}>
            يبقى ظاهراً حتى التأكيد — بدون إغلاق ودون خصم وهمي.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {overdueRows.slice(0, 12).map((row) => (
              <div key={row.booking_item_id} style={{ fontSize: 13 }}>
                <strong>{row.client_name || "عميلة"}</strong>
                {" — "}
                {row.service_name_snapshot || row.service_id}
                {" · "}
                {row.booking_date} {row.start_time || "--:--"}
                {row.effective_end_time || row.end_time ? `–${row.effective_end_time || row.end_time}` : ""}
                {" · موظفة: "}
                {row.item_staff_id || row.booking_staff_id || "—"}
                {row.delay_minutes != null ? ` · تأخير ~${row.delay_minutes} د` : ""}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <DashboardFieldV2 id="inv-cons-date" label="تاريخ الحجوزات">
        <div dir="ltr"><DashboardDateInputV2 className="form-control" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </DashboardFieldV2>
      <DashboardFieldV2 id="inv-cons-booking" label="الحجز">
        <DashboardSelectV2
          value={bookingId}
          placeholder="اختاري حجزاً"
          options={bookings.map((row) => ({
            value: row.id,
            label: `${row.clientName || row.clientId} — ${row.startTime || ""}`,
          }))}
          onChange={setBookingId}
        />
      </DashboardFieldV2>
      <DashboardFieldV2 id="inv-cons-item" label="بند الخدمة">
        <DashboardSelectV2
          value={bookingItemId}
          placeholder="اختاري الخدمة المنفذة"
          options={items.map((row) => ({
            value: row.id,
            label: row.serviceNameSnapshot || row.serviceId,
          }))}
          onChange={setBookingItemId}
        />
      </DashboardFieldV2>
      {recipeError ? (
        <DashboardActionFeedbackV2
          compact
          revealOnMount
          tone="danger"
          title="تعذر تحميل وصفة الخدمة"
          description={recipeError}
        />
      ) : null}
      <DashboardFieldV2 id="inv-cons-emp" label="الموظفة المنفذة">
        <DashboardSelectV2
          value={employeeId}
          placeholder="اختاري الموظفة"
          options={employees.map((row) => ({ value: row.id, label: row.name }))}
          onChange={(value) => {
            setEmployeeId(value);
            setActionFeedback(null);
          }}
        />
      </DashboardFieldV2>

      {!lines.length ? (
        <DashboardEmptyStateV2 title="لا توجد وصفة جاهزة" description="احفظ وصفة استهلاك للخدمة أولاً من التبويب السابق." />
      ) : (
        lines.map((line) => (
          <div key={line.inventoryItemId} className="border rounded p-3 mb-3">
            <div className="mb-2">{line.itemName}</div>
            <DashboardFieldV2
              id={`${line.inventoryItemId}-qty`}
              label={`الكمية الفعلية (${line.unit})`}
              error={lineErrors[line.inventoryItemId]}
            >
              <DashboardNumberInputV2
                value={line.quantity}
                onChange={(e) => {
                  setLineErrors((current) => {
                    if (!current[line.inventoryItemId]) return current;
                    const next = { ...current };
                    delete next[line.inventoryItemId];
                    return next;
                  });
                  setActionFeedback(null);
                  setLines((prev) =>
                    prev.map((row) =>
                      row.inventoryItemId === line.inventoryItemId ? { ...row, quantity: e.target.value } : row
                    )
                  );
                }}
              />
            </DashboardFieldV2>
          </div>
        ))
      )}

      {actionFeedback ? (
        <DashboardActionFeedbackV2
          revealOnMount
          tone={actionFeedback.tone}
          title={actionFeedback.tone === "success" ? "تم تأكيد الاستهلاك" : "تعذر تأكيد الاستهلاك"}
          description={actionFeedback.message}
        />
      ) : null}

      {canConfirm ? (
        <button
          type="button"
          className="btn btn-dark"
          disabled={saving || !bookingItemId || !employeeId || !lines.length}
          onClick={() => void confirm()}
        >
          {saving ? "جاري التأكيد..." : "تأكيد الاستهلاك وخصم المخزون"}
        </button>
      ) : (
        <p className="text-muted">لا توجد صلاحية تأكيد الاستهلاك.</p>
      )}
    </div>
  );
}
