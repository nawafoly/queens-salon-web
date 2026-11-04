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
  type InventoryItem,
  type PendingServiceConsumption,
  type ServiceRecipeLine,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";
import type { CoreBooking } from "../types/coreApi";
import {
  buildRecipeConsumptionDraft,
  removeMixedCategoryLine,
  splitCategoryConsumptionLine,
  validateRecipeConsumptionDraft,
  type RecipeConsumptionDraft,
} from "../features/inventory/recipeMixing";

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
  const [lines, setLines] = useState<RecipeConsumptionDraft[]>([]);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [recipeError, setRecipeError] = useState("");
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>(null);
  const [trackedItems, setTrackedItems] = useState<InventoryItem[]>([]);
  const [overdueRows, setOverdueRows] = useState<PendingServiceConsumption[]>([]);

  const selectedBooking = useMemo(
    () => bookings.find((row) => row.id === bookingId) || null,
    [bookings, bookingId]
  );
  const items = selectedBooking?.items || [];
  const validationErrors = useMemo(
    () => validateRecipeConsumptionDraft(lines, trackedItems),
    [lines, trackedItems]
  );
  const materialLinesReady = lines.length > 0 && Object.keys(validationErrors).length === 0;

  function productOptions(line: RecipeConsumptionDraft) {
    return line.lineType === "SPECIFIC_ITEM"
      ? trackedItems.filter((item) => item.id === line.defaultInventoryItemId)
      : trackedItems.filter((item) => item.category_id === line.categoryId && item.unit === line.unit);
  }

  function availableMixProducts(line: RecipeConsumptionDraft) {
    if (line.lineType !== "CATEGORY" || !line.recipeLineId || !line.inventoryItemId ||
        !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) return [];
    const used = new Set(lines.filter((row) => row.recipeLineId === line.recipeLineId).map((row) => row.inventoryItemId));
    return productOptions(line).filter((item) => !used.has(item.id));
  }

  function addMixedProduct(key: string) {
    const source = lines.find((row) => row.key === key);
    if (!source) return;
    const alternative = availableMixProducts(source)[0];
    if (!alternative) return;
    setLines((current) => splitCategoryConsumptionLine(
      current, key, `mix-${crypto.randomUUID()}`, { id: alternative.id, name: alternative.name }
    ));
    setLineErrors({});
    setActionFeedback(null);
  }

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
        const inventoryItems = await CoreInventoryService.listItems({ active: "1", policy: "SERVICE_TRACKED" });
        if (cancelled) return;
        setTrackedItems(inventoryItems || []);
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
    setLines([]);
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
        const recipeLines = (recipe as { lines?: ServiceRecipeLine[] } | null)?.lines || [];
        setLines(buildRecipeConsumptionDraft(recipeLines, trackedItems));
      } catch (err) {
        if (!cancelled) setRecipeError(errorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookingItemId, selectedBooking, trackedItems]);

  async function confirm() {
    if (!canConfirm || !bookingItemId || !employeeId || !lines.length) return;

    const nextLineErrors = validateRecipeConsumptionDraft(lines, trackedItems);
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
          <div key={line.key} className="border rounded p-3 mb-3">
            {line.lineType === "CATEGORY" ? (
              <DashboardFieldV2 id={`${line.key}-product`} label="المنتج المستخدم من الفئة">
                <DashboardSelectV2
                  value={line.inventoryItemId}
                  placeholder="اختاري المنتج"
                  options={productOptions(line)
                    .filter((item) => item.id === line.inventoryItemId || !lines.some(
                      (other) => other.key !== line.key &&
                        other.recipeLineId === line.recipeLineId &&
                        other.inventoryItemId === item.id
                    ))
                    .map((item) => ({ value: item.id, label: item.name }))}
                  onChange={(inventoryItemId) => {
                    const item = trackedItems.find((row) => row.id === inventoryItemId);
                    setLines((current) => current.map((row) => row.key === line.key
                      ? { ...row, inventoryItemId, itemName: item?.name || inventoryItemId }
                      : row));
                    setLineErrors({});
                    setActionFeedback(null);
                  }}
                />
                {productOptions(line).length === 0 ? (
                  <p className="text-danger mt-2 mb-0">لا توجد منتجات تتبع فئة الوصفة بوحدة {line.unit}.</p>
                ) : null}
              </DashboardFieldV2>
            ) : (
              <div className="mb-2">{line.itemName}</div>
            )}
            <p className="text-muted mb-2" style={{ fontSize: 13 }}>
              {line.isMixAddition
                ? "منتج إضافي ضمن نفس سطر الوصفة"
                : `الكمية الافتراضية: ${line.defaultQty} ${line.unit}`}
            </p>
            <DashboardFieldV2
              id={`${line.key}-qty`}
              label={`الكمية الفعلية (${line.unit})`}
              error={lineErrors[line.key] || validationErrors[line.key]}
            >
              <DashboardNumberInputV2
                value={line.quantity}
                onChange={(e) => {
                  setLineErrors((current) => {
                    if (!current[line.key]) return current;
                    const next = { ...current };
                    delete next[line.key];
                    return next;
                  });
                  setActionFeedback(null);
                  setLines((prev) =>
                    prev.map((row) =>
                      row.key === line.key ? { ...row, quantity: e.target.value } : row
                    )
                  );
                }}
              />
            </DashboardFieldV2>
            {line.lineType === "CATEGORY" ? (
              <div className="d-flex flex-wrap gap-2">
                {availableMixProducts(line).length > 0 ? (
                  <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => addMixedProduct(line.key)}>
                    خلط منتج آخر
                  </button>
                ) : null}
                {line.isMixAddition ? (
                  <button
                    type="button"
                    className="dsv2-btn dsv2-btn--secondary"
                    onClick={() => {
                      setLines((current) => removeMixedCategoryLine(current, line.key));
                      setLineErrors({});
                      setActionFeedback(null);
                    }}
                  >
                    إزالة منتج الخلط
                  </button>
                ) : null}
              </div>
            ) : null}
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
          disabled={saving || !bookingItemId || !employeeId || !materialLinesReady}
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
