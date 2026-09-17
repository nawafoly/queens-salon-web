import { useEffect, useMemo, useState } from "react";
import { DashboardEmptyStateV2, DashboardErrorStateV2, DashboardSkeletonV2 } from "../components/dashboard-v2";
import { CoreInventoryService, type InventoryItem, type InventoryMovement } from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

const TYPE_LABEL: Record<string, string> = {
  OPENING_BALANCE_IN: "رصيد افتتاحي",
  PURCHASE_RECEIPT_IN: "استلام شراء",
  SERVICE_CONSUMPTION_OUT: "استهلاك خدمة",
  TRANSFER_OUT: "تحويل صادر",
  TRANSFER_IN: "تحويل وارد",
  ADJUSTMENT: "تسوية",
  WASTE_OUT: "هدر",
  EMPLOYEE_ISSUE_OUT: "صرف موظفة",
  EMPLOYEE_RETURN_IN: "إرجاع موظفة",
  STOCKTAKE_VARIANCE: "فرق جرد",
  DIRECT_SALE_OUT: "بيع مباشر",
  DIRECT_SALE_RETURN_IN: "مرتجع بيع",
};

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) return error.message;
  return "تعذر تحميل الحركات.";
}

export default function DashboardInventoryMovements() {
  const [rows, setRows] = useState<InventoryMovement[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [locationId, setLocationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [movements, itemRows, locationRows] = await Promise.all([
          CoreInventoryService.listMovements({ limit: "100" }),
          CoreInventoryService.listItems(),
          CoreInventoryService.listLocations(),
        ]);
        setRows(movements || []);
        setItems(itemRows || []);
        setLocations(locationRows || []);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const nameById = new Map(items.map((item) => [item.id, item.name]));
  const locationName = (id?: string | null) => locations.find((row) => row.id === id)?.name || id || "—";
  const visible = useMemo(
    () => (locationId ? rows.filter((row) => String(row.location_id || "") === locationId) : rows),
    [rows, locationId]
  );

  if (loading) return <DashboardSkeletonV2 lines={6} />;
  if (error) return <DashboardErrorStateV2 title="تعذر تحميل الحركات" description={error} />;

  return (
    <div>
      <div className="d-flex justify-content-end mb-3">
        <select className="form-select" style={{ maxWidth: 240 }} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">كل المواقع</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>{loc.name}</option>
          ))}
        </select>
      </div>
      {!visible.length ? (
        <DashboardEmptyStateV2 title="لا توجد حركات" description="لا توجد حركات لهذا الموقع." />
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>المادة</th>
                <th>الموقع</th>
                <th>النوع</th>
                <th>المورد</th>
                <th>الكمية</th>
                <th>تكلفة الوحدة</th>
                <th>الرصيد بعد</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>{String(row.created_at || "").replace("T", " ").slice(0, 19)}</td>
                  <td>{nameById.get(row.item_id) || row.item_id}</td>
                  <td>{locationName(row.location_id)}</td>
                  <td>{TYPE_LABEL[row.movement_type] || row.movement_type}</td>
                  <td>{row.supplier_name || "—"}</td>
                  <td>{row.quantity_delta ?? row.qty_delta ?? 0}</td>
                  <td>{row.unit_cost_halalas != null ? (Number(row.unit_cost_halalas) / 100).toFixed(2) : "—"}</td>
                  <td>{row.balance_after ?? row.qty_after ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
