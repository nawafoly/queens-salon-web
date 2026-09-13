import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBoxesStacked, faPlus } from "@fortawesome/free-solid-svg-icons";
import {
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardModalV2,
  DashboardNumberInputV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import {
  CoreInventoryService,
  type InventoryConsumptionPolicy,
  type InventoryItem,
  type InventoryStockLevel,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";
import DashboardInventoryRecipes from "./DashboardInventoryRecipes";

const UNITS = [
  { value: "ml", label: "مل" },
  { value: "g", label: "غرام" },
  { value: "piece", label: "قطعة" },
  { value: "pair", label: "زوج" },
  { value: "unit", label: "وحدة" },
  { value: "bottle", label: "زجاجة" },
  { value: "box", label: "علبة" },
];

const POLICIES: { value: InventoryConsumptionPolicy; label: string }[] = [
  { value: "SERVICE_TRACKED", label: "استهلاك خدمة" },
  { value: "EMPLOYEE_ISSUED", label: "صرف للموظفة (لاحقاً)" },
  { value: "DIRECT_SALE", label: "بيع مباشر (لاحقاً)" },
  { value: "SHARED_OPERATIONAL", label: "تشغيلي مشترك" },
];

type FormState = {
  name: string;
  unit: string;
  consumptionPolicy: InventoryConsumptionPolicy;
  minStockQty: number;
  sku: string;
  notes: string;
  isActive: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  unit: "ml",
  consumptionPolicy: "SERVICE_TRACKED",
  minStockQty: 0,
  sku: "",
  notes: "",
  isActive: "1",
};

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) return error.message;
  return "تعذر تحميل أو حفظ بيانات المخزون.";
}

export default function DashboardInventory() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("inventory.items.manage");
  const canAdjust = hasPermission("inventory.adjust");

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [levels, setLevels] = useState<InventoryStockLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [openingQty, setOpeningQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"items" | "recipes">("items");

  const qtyByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of levels) {
      map.set(row.item_id, Number(row.qty_on_hand || 0));
    }
    return map;
  }, [levels]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [itemRows, levelRows] = await Promise.all([
        CoreInventoryService.listItems({ search: search || undefined }),
        CoreInventoryService.listStockLevels(),
      ]);
      setItems(itemRows || []);
      setLevels(levelRows || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpeningQty("");
    setModalOpen(true);
  }

  function openEdit(item: InventoryItem) {
    setEditing(item);
    setForm({
      name: item.name,
      unit: item.unit,
      consumptionPolicy: item.consumption_policy,
      minStockQty: Number(item.min_stock_qty || 0),
      sku: item.sku || "",
      notes: item.notes || "",
      isActive: String(item.is_active ?? 1),
    });
    setOpeningQty("");
    setModalOpen(true);
  }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        unit: form.unit,
        consumptionPolicy: form.consumptionPolicy,
        minStockQty: Number(form.minStockQty || 0),
        sku: form.sku.trim() || null,
        notes: form.notes.trim() || null,
        isActive: form.isActive === "1" ? 1 : 0,
      };
      const saved = editing
        ? await CoreInventoryService.updateItem(editing.id, payload)
        : await CoreInventoryService.createItem(payload);

      const qty = Number(openingQty);
      if (!editing && canAdjust && Number.isFinite(qty) && qty > 0) {
        await CoreInventoryService.recordOpeningBalance({
          itemId: saved.id,
          quantity: qty,
          note: "Opening balance from inventory UI",
        });
      }

      setModalOpen(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="dash-card" dir="rtl">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
        <div>
          <h2 className="h5 mb-1">
            <FontAwesomeIcon icon={faBoxesStacked} className="ms-2" />
            مركز رقابة المخزون
          </h2>
          <p className="text-muted mb-0">المواد والرصيد الحالي. الخصم يتم فقط عند تأكيد الاستهلاك لاحقاً.</p>
        </div>
        {canManage ? (
          <button type="button" className="btn btn-dark" onClick={openCreate}>
            <FontAwesomeIcon icon={faPlus} className="ms-2" />
            مادة جديدة
          </button>
        ) : null}
      </div>

      <div className="d-flex gap-2 mb-3">
        <button type="button" className={tn ${tab === "items" ? "btn-dark" : "btn-outline-dark"}} onClick={() => setTab("items")}>المواد</button>
        <button type="button" className={tn ${tab === "recipes" ? "btn-dark" : "btn-outline-dark"}} onClick={() => setTab("recipes")}>وصفات الاستهلاك</button>
      </div>

      {tab === "recipes" ? <DashboardInventoryRecipes /> : null}

      {tab === "items" ? (
      <div className="d-flex gap-2 mb-3">
        <input
          className="form-control"
          placeholder="بحث بالاسم أو SKU"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load();
          }}
        />
        <button type="button" className="btn btn-outline-secondary" onClick={() => void load()}>
          تحديث
        </button>
      </div>

      {error ? <DashboardErrorStateV2 title="تعذر تحميل المخزون" description={error} /> : null}
      {loading ? <DashboardSkeletonV2 rows={6} /> : null}

      {!loading && !items.length ? (
        <DashboardEmptyStateV2
          title="لا توجد مواد بعد"
          description="أضيفي المواد المستخدمة في الخدمات أولاً، ثم نربط الوصفات."
        />
      ) : null}

      {!loading && items.length ? (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>المادة</th>
                <th>الوحدة</th>
                <th>السياسة</th>
                <th>الرصيد</th>
                <th>حد إعادة الطلب</th>
                <th>الحالة</th>
                {canManage ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const qty = qtyByItem.get(item.id);
                const low =
                  qty != null && Number(item.min_stock_qty || 0) > 0 && qty <= Number(item.min_stock_qty);
                return (
                  <tr key={item.id}>
                    <td>
                      <div>{item.name}</div>
                      {item.sku ? <small className="text-muted">{item.sku}</small> : null}
                    </td>
                    <td>{item.unit}</td>
                    <td>{POLICIES.find((p) => p.value === item.consumption_policy)?.label || item.consumption_policy}</td>
                    <td>
                      {qty == null ? "—" : qty}
                      {low ? <span className="badge bg-warning text-dark me-2">منخفض</span> : null}
                    </td>
                    <td>{item.min_stock_qty}</td>
                    <td>{Number(item.is_active) === 1 ? "نشط" : "موقوف"}</td>
                    {canManage ? (
                      <td>
                        <button type="button" className="btn btn-sm btn-outline-dark" onClick={() => openEdit(item)}>
                          تعديل
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      </>) : null}
      <DashboardModalV2
        open={modalOpen}
        title={editing ? "تعديل مادة" : "مادة جديدة"}
        onClose={() => setModalOpen(false)}
      >
        <DashboardFieldV2 label="الاسم">
          <input
            className="form-control"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          />
        </DashboardFieldV2>
        <DashboardFieldV2 label="الوحدة">
          <DashboardSelectV2
            value={form.unit}
            options={UNITS}
            onChange={(value) => setForm((prev) => ({ ...prev, unit: String(value) }))}
          />
        </DashboardFieldV2>
        <DashboardFieldV2 label="سياسة الاستهلاك">
          <DashboardSelectV2
            value={form.consumptionPolicy}
            options={POLICIES}
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                consumptionPolicy: value as InventoryConsumptionPolicy,
              }))
            }
          />
        </DashboardFieldV2>
        <DashboardFieldV2 label="حد إعادة الطلب">
          <DashboardNumberInputV2
            value={form.minStockQty}
            onChange={(value) => setForm((prev) => ({ ...prev, minStockQty: Number(value || 0) }))}
          />
        </DashboardFieldV2>
        <DashboardFieldV2 label="SKU">
          <input
            className="form-control"
            value={form.sku}
            onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
          />
        </DashboardFieldV2>
        {editing ? (
          <DashboardFieldV2 label="الحالة">
            <DashboardSelectV2
              value={form.isActive}
              options={[
                { value: "1", label: "نشط" },
                { value: "0", label: "موقوف" },
              ]}
              onChange={(value) => setForm((prev) => ({ ...prev, isActive: String(value) }))}
            />
          </DashboardFieldV2>
        ) : canAdjust ? (
          <DashboardFieldV2 label="رصيد افتتاحي (اختياري)">
            <input
              className="form-control"
              inputMode="decimal"
              value={openingQty}
              onChange={(e) => setOpeningQty(e.target.value)}
            />
          </DashboardFieldV2>
        ) : null}
        <DashboardFieldV2 label="ملاحظات">
          <textarea
            className="form-control"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
        </DashboardFieldV2>
        <div className="d-flex justify-content-end gap-2 mt-3">
          <button type="button" className="btn btn-outline-secondary" onClick={() => setModalOpen(false)}>
            إلغاء
          </button>
          <button type="button" className="btn btn-dark" disabled={saving || !form.name.trim()} onClick={() => void save()}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
        </div>
      </DashboardModalV2>
    </section>
  );
}