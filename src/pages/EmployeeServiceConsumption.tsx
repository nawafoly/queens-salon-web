import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CoreInventoryService,
  type InventoryItem,
  type PendingServiceConsumption,
  type ServiceConsumptionLifecycle,
  type ServiceRecipeLine,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";
import type { HrSession } from "./hr/shared";

function salonTodayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) return [error.code, error.message].filter(Boolean).join(" — ");
  return "تعذر تأكيد الاستهلاك.";
}

type DraftLine = {
  key: string;
  recipeLineId: string | null;
  defaultInventoryItemId: string;
  inventoryItemId: string;
  itemName: string;
  quantity: string;
  defaultQty: string;
  unit: string;
};

const LIFECYCLE_META: Record<
  ServiceConsumptionLifecycle,
  { label: string; tone: string; bg: string; border: string }
> = {
  UPCOMING: { label: "قادم", tone: "#1e3a5f", bg: "#eff6ff", border: "#bfdbfe" },
  DUE_TODAY: { label: "مطلوب اليوم", tone: "#7c2d12", bg: "#fff7ed", border: "#fed7aa" },
  PENDING_CONFIRMATION: { label: "بانتظار التأكيد", tone: "#1e3a8a", bg: "#eef2ff", border: "#c7d2fe" },
  OVERDUE: { label: "متأخر", tone: "#7f1d1d", bg: "#fef2f2", border: "#fecaca" },
  CONFIRMED: { label: "مؤكد", tone: "#14532d", bg: "#f0fdf4", border: "#bbf7d0" },
};

function Badge({ lifecycle }: { lifecycle?: ServiceConsumptionLifecycle }) {
  const key = lifecycle || "PENDING_CONFIRMATION";
  const meta = LIFECYCLE_META[key] || LIFECYCLE_META.PENDING_CONFIRMATION;
  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: 999,
        padding: "3px 10px",
        fontSize: 11,
        fontWeight: 700,
        color: meta.tone,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
      }}
    >
      {meta.label}
    </span>
  );
}

export default function EmployeeServiceConsumption({ session }: { session: HrSession }) {
  const employeeId = String(session.employeeId || session.uid || "");
  const [pending, setPending] = useState<PendingServiceConsumption[]>([]);
  const [trackedItems, setTrackedItems] = useState<InventoryItem[]>([]);
  const [bookingItemId, setBookingItemId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const itemNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const item of trackedItems) names[item.id] = item.name;
    return names;
  }, [trackedItems]);

  const sections = useMemo(() => {
    const dueToday = pending.filter((row) => row.lifecycle === "DUE_TODAY");
    const awaiting = pending.filter((row) => row.lifecycle === "PENDING_CONFIRMATION");
    const overdue = pending.filter((row) => row.lifecycle === "OVERDUE");
    const upcoming = pending.filter((row) => row.lifecycle === "UPCOMING");
    return { dueToday, awaiting, overdue, upcoming };
  }, [pending]);

  const selected = pending.find((row) => row.booking_item_id === bookingItemId) || null;
  const selectedConfirmable = Boolean(selected?.can_confirm !== false && selected?.lifecycle !== "UPCOMING");
  const overdueCount = sections.overdue.length;

  const refreshPending = useCallback(async () => {
    if (!employeeId) {
      setPending([]);
      return;
    }
    const rows = await CoreInventoryService.listPendingConsumptions({
      employeeId,
      scope: "worklist",
      includeUpcoming: "1",
      includeOverdue: "1",
      upcomingDays: 7,
      overdueDays: 30,
    });
    setPending(rows || []);
  }, [employeeId]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [pendingRows, inventoryItems] = await Promise.all([
          employeeId
            ? CoreInventoryService.listPendingConsumptions({
                employeeId,
                scope: "worklist",
                includeUpcoming: "1",
                includeOverdue: "1",
                upcomingDays: 7,
                overdueDays: 30,
              })
            : Promise.resolve([]),
          CoreInventoryService.listItems({ active: "1", policy: "SERVICE_TRACKED" }),
        ]);
        setPending(pendingRows || []);
        setTrackedItems(inventoryItems || []);
        const actionable = (pendingRows || []).filter(
          (row) => row.lifecycle === "OVERDUE" || row.lifecycle === "PENDING_CONFIRMATION" || row.lifecycle === "DUE_TODAY"
        );
        if (actionable.length === 1) setBookingItemId(actionable[0].booking_item_id);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [employeeId]);

  useEffect(() => {
    setLines([]);
    setNotice("");
    if (!bookingItemId) return;
    const row = pending.find((item) => item.booking_item_id === bookingItemId);
    if (!row) return;
    void (async () => {
      setLoadingRecipe(true);
      setError("");
      try {
        const recipe = await CoreInventoryService.getRecipeByService(row.service_id);
        const recipeLines = ((recipe as { lines?: ServiceRecipeLine[] } | null)?.lines || []).filter(
          (line) => line.line_type === "SPECIFIC_ITEM" && line.inventory_item_id
        );
        setLines(
          recipeLines.map((line, index) => {
            const inventoryItemId = String(line.inventory_item_id);
            return {
              key: line.id || `${inventoryItemId}-${index}`,
              recipeLineId: line.id,
              defaultInventoryItemId: inventoryItemId,
              inventoryItemId,
              itemName: itemNames[inventoryItemId] || inventoryItemId,
              quantity: String(line.default_qty),
              defaultQty: String(line.default_qty),
              unit: line.unit,
            };
          })
        );
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoadingRecipe(false);
      }
    })();
  }, [bookingItemId, pending, itemNames]);

  async function confirm() {
    if (!employeeId || !bookingItemId || !lines.length || !selectedConfirmable) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await CoreInventoryService.confirmConsumption({
        bookingItemId,
        employeeId,
        lines: lines.map((line) => {
          const sameDefault = line.inventoryItemId === line.defaultInventoryItemId;
          return {
            inventoryItemId: line.inventoryItemId,
            quantity: Number(line.quantity),
            unit: line.unit,
            recipeLineId: sameDefault ? line.recipeLineId : null,
          };
        }),
      });
      setNotice("تم تأكيد الاستهلاك وخصم المخزون.");
      setBookingItemId("");
      setLines([]);
      await refreshPending();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function bump(key: string, delta: number) {
    setLines((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = Math.max(0, Number(row.quantity || 0) + delta);
        return { ...row, quantity: String(Number.isInteger(next) ? next : next.toFixed(1)) };
      })
    );
  }

  function changeProduct(key: string, inventoryItemId: string) {
    const item = trackedItems.find((row) => row.id === inventoryItemId);
    setLines((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        return {
          ...row,
          inventoryItemId,
          itemName: item?.name || inventoryItemId,
          unit: item?.unit || row.unit,
        };
      })
    );
  }

  function renderItemButton(row: PendingServiceConsumption) {
    const active = row.booking_item_id === bookingItemId;
    const locked = row.lifecycle === "UPCOMING" || row.can_confirm === false;
    return (
      <button
        key={row.booking_item_id}
        type="button"
        onClick={() => setBookingItemId(row.booking_item_id)}
        style={{
          textAlign: "right",
          border: active ? "2px solid #111" : `1px solid ${LIFECYCLE_META[row.lifecycle || "PENDING_CONFIRMATION"]?.border || "#e5e7eb"}`,
          background: active ? "#111" : "#fff",
          color: active ? "#fff" : "#111",
          borderRadius: 16,
          padding: "14px 16px",
          opacity: locked && !active ? 0.85 : 1,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <strong style={{ display: "block", fontSize: 16 }}>{row.client_name || "عميلة"}</strong>
          {!active ? <Badge lifecycle={row.lifecycle} /> : null}
        </div>
        <span style={{ opacity: 0.85, fontSize: 13 }}>
          {row.booking_date || "—"} · {row.start_time || "--:--"}
          {row.effective_end_time || row.end_time ? `–${row.effective_end_time || row.end_time}` : ""} —{" "}
          {row.service_name_snapshot || row.service_id}
        </span>
        {row.booking_source ? (
          <span style={{ display: "block", opacity: 0.7, fontSize: 11, marginTop: 4 }}>المصدر: {row.booking_source}</span>
        ) : null}
        {locked ? (
          <span style={{ display: "block", opacity: 0.75, fontSize: 11, marginTop: 6 }}>للمعاينة فقط — لا يمكن التأكيد قبل يوم الخدمة</span>
        ) : null}
      </button>
    );
  }

  function renderSection(
    title: string,
    rows: PendingServiceConsumption[],
    opts: { sticky?: boolean; empty?: string } = {}
  ) {
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>
            {title}{" "}
            <span style={{ fontWeight: 500, color: "#6b7280", fontSize: 13 }}>({rows.length})</span>
          </p>
          {opts.sticky && rows.length ? (
            <span style={{ color: "#b91c1c", fontSize: 12, fontWeight: 700 }}>يبقى حتى التأكيد — لا يمكن الإغلاق دون معالجة</span>
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map(renderItemButton)}
          {!rows.length ? <p className="text-muted" style={{ margin: 0 }}>{opts.empty || "لا يوجد."}</p> : null}
        </div>
      </div>
    );
  }

  if (loading) {
    return <section className="employee-portal-card">جاري تجهيز قائمة الاستهلاك الإلزامي...</section>;
  }

  return (
    <section className="employee-portal-card" dir="rtl" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>استهلاك إلزامي لنفس اليوم — بند الحجز</p>
          <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>تأكيد استهلاك الخدمات</h2>
        </div>
        <span style={{ background: "#111", color: "#fff", borderRadius: 999, padding: "6px 12px", fontSize: 12 }}>
          {salonTodayISO()} · {pending.length}
        </span>
      </div>

      {overdueCount > 0 ? (
        <div
          className="alert alert-danger"
          style={{
            borderRadius: 14,
            marginBottom: 16,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#7f1d1d",
            fontWeight: 600,
          }}
        >
          تنبيه متأخر: لديك {overdueCount} بند استهلاك دون تأكيد. المهمة لا تُغلق إلا بعد المعالجة — بدون خصم وهمي.
        </div>
      ) : null}

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {notice ? <div className="alert alert-success">{notice}</div> : null}

      {renderSection("1. مطلوب اليوم", sections.dueToday, { empty: "لا يوجد مطلوب اليوم." })}
      {renderSection("2. بانتظار التأكيد", sections.awaiting, { empty: "لا يوجد بانتظار التأكيد." })}
      {renderSection("3. متأخر", sections.overdue, { sticky: true, empty: "لا يوجد متأخر." })}
      {sections.upcoming.length ? renderSection("قادم (معاينة)", sections.upcoming, { empty: "" }) : null}

      {selected ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>الاستهلاك الافتراضي (قابل للتعديل)</p>
            <Badge lifecycle={selected.lifecycle} />
          </div>
          {!selectedConfirmable ? (
            <p className="text-muted" style={{ marginBottom: 12 }}>
              هذا البند قادم في {selected.booking_date}. التأكيد مسموح فقط في يوم الخدمة أو بعده (متأخر).
            </p>
          ) : null}
          {loadingRecipe ? <p className="text-muted">جاري تحميل الوصفة...</p> : null}
          {lines.length ? (
            <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
              {lines.map((line) => (
                <div
                  key={line.key}
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 16,
                    padding: 14,
                    display: "grid",
                    gap: 10,
                    opacity: selectedConfirmable ? 1 : 0.7,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>المنتج</label>
                      <select
                        value={line.inventoryItemId}
                        disabled={!selectedConfirmable}
                        onChange={(e) => changeProduct(line.key, e.target.value)}
                        style={{
                          width: "100%",
                          border: "1px solid #e5e7eb",
                          borderRadius: 10,
                          height: 40,
                          padding: "0 10px",
                          background: "#fff",
                        }}
                      >
                        {trackedItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
                        الافتراضي: {itemNames[line.defaultInventoryItemId] || line.defaultInventoryItemId} · {line.defaultQty}{" "}
                        {line.unit}
                      </div>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>الكمية</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          type="button"
                          className="dsv2-btn dsv2-btn--secondary"
                          disabled={!selectedConfirmable}
                          onClick={() => bump(line.key, -1)}
                        >
                          -
                        </button>
                        <input
                          value={line.quantity}
                          disabled={!selectedConfirmable}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((row) => (row.key === line.key ? { ...row, quantity: e.target.value } : row))
                            )
                          }
                          style={{ width: 72, textAlign: "center", border: "1px solid #e5e7eb", borderRadius: 10, height: 40 }}
                        />
                        <button
                          type="button"
                          className="dsv2-btn dsv2-btn--secondary"
                          disabled={!selectedConfirmable}
                          onClick={() => bump(line.key, 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : !loadingRecipe ? (
            <p className="text-muted">لا توجد بنود SPECIFIC_ITEM في وصفة هذه الخدمة.</p>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        className="dsv2-btn dsv2-btn--primary"
        style={{ width: "100%", height: 48, borderRadius: 14 }}
        disabled={saving || !employeeId || !bookingItemId || !lines.length || !selectedConfirmable}
        onClick={() => void confirm()}
      >
        {saving
          ? "جاري التأكيد..."
          : !selectedConfirmable && selected
            ? "التأكيد غير متاح قبل يوم الخدمة"
            : "تأكيد وخصم المخزون"}
      </button>
    </section>
  );
}
