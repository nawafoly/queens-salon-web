import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CoreInventoryService,
  type InventoryItem,
  type PendingServiceConsumption,
  type ServiceRecipeLine,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";
import type { HrSession } from "./hr/shared";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

  const selected = pending.find((row) => row.booking_item_id === bookingItemId) || null;

  const refreshPending = useCallback(async () => {
    if (!employeeId) {
      setPending([]);
      return;
    }
    const rows = await CoreInventoryService.listPendingConsumptions({
      employeeId,
      date: todayISO(),
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
            ? CoreInventoryService.listPendingConsumptions({ employeeId, date: todayISO() })
            : Promise.resolve([]),
          CoreInventoryService.listItems({ active: "1", policy: "SERVICE_TRACKED" }),
        ]);
        setPending(pendingRows || []);
        setTrackedItems(inventoryItems || []);
        if ((pendingRows || []).length === 1) setBookingItemId(pendingRows[0].booking_item_id);
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
    if (!employeeId || !bookingItemId || !lines.length) return;
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
            // Keep recipe link only when product still matches SPECIFIC_ITEM default.
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

  if (loading) {
    return <section className="employee-portal-card">جاري تجهيز قائمة الاستهلاك المعلق...</section>;
  }

  return (
    <section className="employee-portal-card" dir="rtl" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>بعد التنفيذ فقط — بند الحجز</p>
          <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>استهلاك بانتظار التأكيد</h2>
        </div>
        <span style={{ background: "#111", color: "#fff", borderRadius: 999, padding: "6px 12px", fontSize: 12 }}>
          {todayISO()} · {pending.length}
        </span>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {notice ? <div className="alert alert-success">{notice}</div> : null}

      <p style={{ margin: "0 0 10px", fontWeight: 600 }}>1. البنود المعلقة</p>
      <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
        {pending.map((row) => {
          const active = row.booking_item_id === bookingItemId;
          return (
            <button
              key={row.booking_item_id}
              type="button"
              onClick={() => setBookingItemId(row.booking_item_id)}
              style={{
                textAlign: "right",
                border: active ? "2px solid #111" : "1px solid #e5e7eb",
                background: active ? "#111" : "#fff",
                color: active ? "#fff" : "#111",
                borderRadius: 16,
                padding: "14px 16px",
              }}
            >
              <strong style={{ display: "block", fontSize: 16 }}>{row.client_name || "عميلة"}</strong>
              <span style={{ opacity: 0.85, fontSize: 13 }}>
                {row.start_time || "--:--"} — {row.service_name_snapshot || row.service_id}
              </span>
              {row.booking_source ? (
                <span style={{ display: "block", opacity: 0.7, fontSize: 11, marginTop: 4 }}>
                  المصدر: {row.booking_source}
                </span>
              ) : null}
            </button>
          );
        })}
        {!pending.length ? (
          <p className="text-muted">لا يوجد بند حجز بانتظار تأكيد الاستهلاك اليوم.</p>
        ) : null}
      </div>

      {selected ? (
        <>
          <p style={{ margin: "0 0 10px", fontWeight: 600 }}>2. الاستهلاك الافتراضي (قابل للتعديل)</p>
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
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>المنتج</label>
                      <select
                        value={line.inventoryItemId}
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
                        الافتراضي: {itemNames[line.defaultInventoryItemId] || line.defaultInventoryItemId} · {line.defaultQty} {line.unit}
                      </div>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>الكمية</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => bump(line.key, -1)}>
                          -
                        </button>
                        <input
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((row) => (row.key === line.key ? { ...row, quantity: e.target.value } : row))
                            )
                          }
                          style={{ width: 72, textAlign: "center", border: "1px solid #e5e7eb", borderRadius: 10, height: 40 }}
                        />
                        <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => bump(line.key, 1)}>
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
        disabled={saving || !employeeId || !bookingItemId || !lines.length}
        onClick={() => void confirm()}
      >
        {saving ? "جاري التأكيد..." : "تأكيد وخصم المخزون"}
      </button>
    </section>
  );
}
