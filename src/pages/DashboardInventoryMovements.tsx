import { useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [movements, itemRows] = await Promise.all([
          CoreInventoryService.listMovements({ limit: "100" }),
          CoreInventoryService.listItems(),
        ]);
        setRows(movements || []);
        setItems(itemRows || []);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const nameById = new Map(items.map((item) => [item.id, item.name]));

  if (loading) return <DashboardSkeletonV2 lines={6} />;
  if (error) return <DashboardErrorStateV2 title="تعذر تحميل الحركات" description={error} />;
  if (!rows.length) {
    return <DashboardEmptyStateV2 title="لا توجد حركات بعد" description="بعد تأكيد الاستهلاك أو الرصيد الافتتاحي تظهر الحركات هنا." />;
  }

  return (
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
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{String(row.created_at || "").replace("T", " ").slice(0, 19)}</td>
              <td>{nameById.get(row.item_id) || row.item_id}</td>
              <td>{TYPE_LABEL[row.movement_type] || row.movement_type}</td>
              <td>{row.supplier_name || (row.movement_type === "PURCHASE_RECEIPT_IN" ? "—" : "—")}</td>
              <td>{row.quantity_delta ?? row.qty_delta ?? 0}</td>
              <td>{row.unit_cost_halalas != null ? (Number(row.unit_cost_halalas) / 100).toFixed(2) : "—"}</td>
              <td>{row.balance_after ?? row.qty_after ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
