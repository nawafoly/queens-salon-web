import { useEffect, useMemo, useState } from "react";
import {
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [itemNames, setItemNames] = useState<Record<string, string>>({});

  const selectedBooking = useMemo(
    () => bookings.find((row) => row.id === bookingId) || null,
    [bookings, bookingId]
  );
  const items = selectedBooking?.items || [];

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [bookingRows, employeeRows] = await Promise.all([
          CoreBookingService.list({ date }),
          CoreHrService.listEmployees({ status: "active" }),
        ]);
        setBookings(bookingRows || []);
        const inventoryItems = await CoreInventoryService.listItems({ active: "1" });
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
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [date]);

  useEffect(() => {
    setBookingItemId("");
    setLines([]);
    setNotice("");
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
    if (!canConfirm || !bookingItemId || !employeeId || !lines.length) return;
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
      setNotice("تم تأكيد الاستهلاك وخصم المخزون من الدفتر.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={6} />;

  return (
    <div>
      <p className="text-muted">التأكيد هنا يخصم المخزون فعلياً. لا تستخدمه عند إنشاء الحجز.</p>
      {error ? <DashboardErrorStateV2 title="تعذر تأكيد الاستهلاك" description={error} /> : null}
      {notice ? <p className="text-success">{notice}</p> : null}

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
      <DashboardFieldV2 id="inv-cons-emp" label="الموظفة المنفذة">
        <DashboardSelectV2
          value={employeeId}
          placeholder="اختاري الموظفة"
          options={employees.map((row) => ({ value: row.id, label: row.name }))}
          onChange={setEmployeeId}
        />
      </DashboardFieldV2>

      {!lines.length ? (
        <DashboardEmptyStateV2 title="لا توجد وصفة جاهزة" description="احفظ وصفة استهلاك للخدمة أولاً من التبويب السابق." />
      ) : (
        lines.map((line) => (
          <div key={line.inventoryItemId} className="border rounded p-3 mb-3">
            <div className="mb-2">{line.itemName}</div>
            <DashboardFieldV2 id={`${line.inventoryItemId}-qty`} label={`الكمية الفعلية (${line.unit})`}>
              <DashboardNumberInputV2
                value={line.quantity}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((row) =>
                      row.inventoryItemId === line.inventoryItemId ? { ...row, quantity: e.target.value } : row
                    )
                  )
                }
              />
            </DashboardFieldV2>
          </div>
        ))
      )}

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
