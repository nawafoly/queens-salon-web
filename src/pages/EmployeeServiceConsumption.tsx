import { useEffect, useMemo, useState } from "react";
import { CoreBookingService } from "../services/CoreBookingService";
import {
  CoreInventoryService,
  type ServiceRecipeLine,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";
import type { CoreBooking, CoreBookingItem } from "../types/coreApi";
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
  recipeLineId: string | null;
  inventoryItemId: string;
  itemName: string;
  quantity: string;
  unit: string;
};

export default function EmployeeServiceConsumption({ session }: { session: HrSession }) {
  const employeeId = String(session.employeeId || session.uid || "");
  const [bookings, setBookings] = useState<CoreBooking[]>([]);
  const [itemNames, setItemNames] = useState<Record<string, string>>({});
  const [bookingId, setBookingId] = useState("");
  const [bookingItemId, setBookingItemId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const mine = useMemo(() => {
    return (bookings || []).filter((row) => {
      if (String(row.status || "").toLowerCase() === "cancelled") return false;
      if (String(row.staffId || "") === employeeId) return true;
      return (row.items || []).some((item) => String(item.staffId || "") === employeeId);
    });
  }, [bookings, employeeId]);

  const selected = mine.find((row) => row.id === bookingId) || null;
  const items: CoreBookingItem[] = selected?.items || [];

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [bookingRows, inventoryItems] = await Promise.all([
          CoreBookingService.list({ date: todayISO() }),
          CoreInventoryService.listItems({ active: "1" }),
        ]);
        setBookings(bookingRows || []);
        const names: Record<string, string> = {};
        for (const item of inventoryItems || []) names[item.id] = item.name;
        setItemNames(names);
        if ((bookingRows || []).length === 1) setBookingId(bookingRows[0].id);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    setBookingItemId("");
    setLines([]);
    setNotice("");
    if (selected?.items?.length === 1) setBookingItemId(selected.items[0].id);
  }, [bookingId]);

  useEffect(() => {
    const item = items.find((row) => row.id === bookingItemId);
    if (!item) {
      setLines([]);
      return;
    }
    void (async () => {
      setError("");
      try {
        const recipe = await CoreInventoryService.getRecipeByService(item.serviceId);
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
        setError(errorMessage(err));
      }
    })();
  }, [bookingItemId]);

  async function confirm() {
    if (!employeeId || !bookingItemId || !lines.length) return;
    setSaving(true);
    setError("");
    setNotice("");
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
      setNotice("تم تأكيد الاستهلاك وخصم المخزون.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function bump(id: string, delta: number) {
    setLines((prev) =>
      prev.map((row) => {
        if (row.inventoryItemId !== id) return row;
        const next = Math.max(0, Number(row.quantity || 0) + delta);
        return { ...row, quantity: String(Number.isInteger(next) ? next : next.toFixed(1)) };
      })
    );
  }

  if (loading) {
    return <section className="employee-portal-card">جاري تجهيز حجوزات اليوم...</section>;
  }

  return (
    <section className="employee-portal-card" dir="rtl" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>بعد التنفيذ فقط</p>
          <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>تأكيد الاستهلاك</h2>
        </div>
        <span style={{ background: "#111", color: "#fff", borderRadius: 999, padding: "6px 12px", fontSize: 12 }}>{todayISO()}</span>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {notice ? <div className="alert alert-success">{notice}</div> : null}

      <p style={{ margin: "0 0 10px", fontWeight: 600 }}>1. حجزك اليوم</p>
      <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
        {mine.map((row) => {
          const active = row.id === bookingId;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => setBookingId(row.id)}
              style={{
                textAlign: "right",
                border: active ? "2px solid #111" : "1px solid #e5e7eb",
                background: active ? "#111" : "#fff",
                color: active ? "#fff" : "#111",
                borderRadius: 16,
                padding: "14px 16px",
              }}
            >
              <strong style={{ display: "block", fontSize: 16 }}>{row.clientName || "عميلة"}</strong>
              <span style={{ opacity: 0.8, fontSize: 13 }}>{row.startTime} — {row.items?.[0]?.serviceNameSnapshot || "خدمة"}</span>
            </button>
          );
        })}
        {!mine.length ? <p className="text-muted">لا يوجد حجز مرتبط بك اليوم.</p> : null}
      </div>

      {selected ? (
        <>
          <p style={{ margin: "0 0 10px", fontWeight: 600 }}>2. الخدمة المنفذة</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
            {items.map((row) => {
              const active = row.id === bookingItemId;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setBookingItemId(row.id)}
                  style={{
                    border: "none",
                    borderRadius: 999,
                    padding: "8px 14px",
                    background: active ? "#111" : "#f3f4f6",
                    color: active ? "#fff" : "#111",
                  }}
                >
                  {row.serviceNameSnapshot || row.serviceId}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {lines.length ? (
        <>
          <p style={{ margin: "0 0 10px", fontWeight: 600 }}>3. الكمية الفعلية</p>
          <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
            {lines.map((line) => (
              <div key={line.inventoryItemId} style={{ border: "1px solid #eee", borderRadius: 16, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <strong>{line.itemName}</strong>
                  <div style={{ color: "#6b7280", fontSize: 12 }}>{line.unit}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => bump(line.inventoryItemId, -1)}>-</button>
                  <input
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((row) =>
                          row.inventoryItemId === line.inventoryItemId ? { ...row, quantity: e.target.value } : row
                        )
                      )
                    }
                    style={{ width: 72, textAlign: "center", border: "1px solid #e5e7eb", borderRadius: 10, height: 40 }}
                  />
                  <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => bump(line.inventoryItemId, 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
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
