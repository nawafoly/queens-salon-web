import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBoxesStacked, faPlus, faMagnifyingGlass, faRotate, faTriangleExclamation, faCheckCircle, faLayerGroup, faArrowTrendDown, faArrowLeft, faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import "../styles/DashboardInventoryCommandCenter.css";
import {
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
const DashboardInventoryRecipes = lazy(() => import("./DashboardInventoryRecipes"));
const DashboardInventorySuppliers = lazy(() => import("./DashboardInventorySuppliers"));
const DashboardInventoryConsumption = lazy(() => import("./DashboardInventoryConsumption"));
const DashboardInventoryPurchaseOrders = lazy(() => import("./DashboardInventoryPurchaseOrders"));
const DashboardInventoryMovements = lazy(() => import("./DashboardInventoryMovements"));
const DashboardInventoryIssue = lazy(() => import("./DashboardInventoryIssue"));
const DashboardInventoryOps = lazy(() => import("./DashboardInventoryOps"));
const DashboardInventoryTrade = lazy(() => import("./DashboardInventoryTrade"));
const DashboardInventoryCosts = lazy(() => import("./DashboardInventoryCosts"));
const DashboardInventoryStaffLocations = lazy(() => import("./DashboardInventoryStaffLocations"));

type InventoryTab = "items" | "recipes" | "consume" | "moves" | "issue" | "ops" | "trade" | "suppliers" | "po" | "costs" | "staff-locations";

const INVENTORY_TABS: { id: InventoryTab; label: string; group: "core" | "operations" | "supply" | "control" }[] = [
  { id: "items", label: "المواد", group: "core" },
  { id: "recipes", label: "وصفات الاستهلاك", group: "core" },
  { id: "consume", label: "تأكيد الاستهلاك", group: "operations" },
  { id: "moves", label: "سجل الحركات", group: "operations" },
  { id: "issue", label: "صرف الموظفات", group: "operations" },
  { id: "ops", label: "الهدر والجرد", group: "operations" },
  { id: "po", label: "أوامر الشراء", group: "supply" },
  { id: "trade", label: "استلام المشتريات", group: "supply" },
  { id: "suppliers", label: "الموردون", group: "supply" },
  { id: "costs", label: "رقابة التكلفة", group: "control" },
  { id: "staff-locations", label: "مواقع الموظفات", group: "control" },
];

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
  const canViewCosts = hasPermission("inventory.movements.view");

  const [tab, setTab] = useState<InventoryTab>("items");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [levels, setLevels] = useState<InventoryStockLevel[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [openingQty, setOpeningQty] = useState("");
  const [saving, setSaving] = useState(false);

  const qtyByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of levels) { map.set(row.item_id, Number(map.get(row.item_id) || 0) + Number(row.qty_on_hand || 0)); }
    return map;
  }, [levels]);
  function locationName(id: string) { return locations.find((row) => row.id === id)?.name || id || "-"; }
  function locationStockLabel(itemId: string) {
    const rows = levels.filter((row) => row.item_id === itemId);
    if (!rows.length) return "0";
    return rows.map((row) => locationName(row.location_id) + ": " + String(row.qty_on_hand ?? 0)).join(" | ");
  }

  const lowStockItems = useMemo(() => {
    return items.filter((item) => {
      if (Number(item.is_active) !== 1) return false;
      const min = Number(item.min_stock_qty || 0);
      if (!(min > 0)) return false;
      const qty = qtyByItem.get(item.id);
      return qty != null && qty <= min;
    });
  }, [items, qtyByItem]);

  async function load(query = search) {
    setLoading(true);
    setError("");
    try {
      const [itemRows, levelRows, locationRows] = await Promise.all([
        CoreInventoryService.listItems({ search: query || undefined }),
        CoreInventoryService.listStockLevels(),
        CoreInventoryService.listLocations(),
      ]);
      setItems(itemRows || []);
      setLevels(levelRows || []);
      setLocations(Array.isArray(locationRows) ? locationRows : []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
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

  const activeItemsCount = items.filter((item) => Number(item.is_active) === 1).length;
  const inactiveItemsCount = items.length - activeItemsCount;
  const selectedTab = INVENTORY_TABS.find((item) => item.id === tab);
  const availableTabs = INVENTORY_TABS.filter((item) =>
    item.id === "costs" ? canViewCosts : item.id === "staff-locations" ? canManage : true
  );

  return (
    <section className="dash-card inventory-command-center" dir="rtl" aria-label="مركز إدارة المخزون">
      <div className="inventory-command-hero">
        <div className="inventory-command-hero-copy">
          <span className="inventory-command-eyebrow"><FontAwesomeIcon icon={faLayerGroup} /> الإدارة التشغيلية <span aria-hidden="true">/</span> المخزون</span>
          <div className="inventory-command-heading">
            <span className="inventory-command-heading-icon"><FontAwesomeIcon icon={faBoxesStacked} /></span>
            <div>
              <h2>إدارة المخزون</h2>
              <p>كل المواد، وحركة الاستهلاك، والمشتريات في مساحة عمل واحدة.</p>
            </div>
          </div>
        </div>
        <div className="inventory-command-hero-actions">
          <span className="inventory-command-live"><span /> بيانات المخزون</span>
          {canManage && tab === "items" ? (
            <button type="button" className="inventory-command-primary" onClick={openCreate}>
              <FontAwesomeIcon icon={faPlus} /> إضافة مادة
            </button>
          ) : null}
        </div>
      </div>

      <div className="inventory-command-stats" aria-label="ملخص المخزون">
        <div className="inventory-command-stat">
          <span className="inventory-command-stat-icon inventory-command-stat-icon--neutral"><FontAwesomeIcon icon={faBoxesStacked} /></span>
          <div><span className="inventory-command-stat-label">إجمالي المواد</span><strong>{loading ? "—" : items.length.toLocaleString("ar-SA-u-nu-latn")}</strong><small>المواد المعروضة في القائمة</small></div>
        </div>
        <div className="inventory-command-stat">
          <span className="inventory-command-stat-icon inventory-command-stat-icon--success"><FontAwesomeIcon icon={faCheckCircle} /></span>
          <div><span className="inventory-command-stat-label">مواد نشطة</span><strong>{loading ? "—" : activeItemsCount.toLocaleString("ar-SA-u-nu-latn")}</strong><small>{loading ? "جاري التحديث" : `${inactiveItemsCount.toLocaleString("ar-SA-u-nu-latn")} موقوفة`}</small></div>
        </div>
        <div className="inventory-command-stat">
          <span className="inventory-command-stat-icon inventory-command-stat-icon--warning"><FontAwesomeIcon icon={faTriangleExclamation} /></span>
          <div><span className="inventory-command-stat-label">تحتاج إعادة طلب</span><strong>{loading ? "—" : lowStockItems.length.toLocaleString("ar-SA-u-nu-latn")}</strong><small>بحسب حدود إعادة الطلب المحددة</small></div>
        </div>
        <div className="inventory-command-stat">
          <span className="inventory-command-stat-icon inventory-command-stat-icon--accent"><FontAwesomeIcon icon={faLayerGroup} /></span>
          <div><span className="inventory-command-stat-label">مواقع التخزين</span><strong>{loading ? "—" : locations.length.toLocaleString("ar-SA-u-nu-latn")}</strong><small>مواقع مسجلة</small></div>
        </div>
      </div>

      <div className="inventory-command-workspace">
        <div className="inventory-command-workspace-header">
          <div>
            <span className="inventory-command-section-kicker">مساحة العمل</span>
            <h3>{selectedTab?.label || "المواد"}</h3>
          </div>
          <span className="inventory-command-workspace-hint"><FontAwesomeIcon icon={faCircleInfo} /> انتقل بين الأقسام لإدارة عمليات المخزون</span>
        </div>
        <nav className="inventory-command-tabs" aria-label="أقسام المخزون">
          {availableTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`inventory-command-tab ${tab === item.id ? "is-active" : ""}`}
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="inventory-command-tab-body">
          <Suspense fallback={<DashboardSkeletonV2 lines={4} />}>
      {tab === "recipes" ? <DashboardInventoryRecipes /> : null}
      {tab === "consume" ? <DashboardInventoryConsumption /> : null}
      {tab === "moves" ? <DashboardInventoryMovements /> : null}
      {tab === "issue" ? <DashboardInventoryIssue /> : null}
      {tab === "ops" ? <DashboardInventoryOps /> : null}
      {tab === "trade" ? <DashboardInventoryTrade /> : null}
      {tab === "po" ? <DashboardInventoryPurchaseOrders /> : null}
      {tab === "suppliers" ? <DashboardInventorySuppliers /> : null}
      {tab === "costs" && canViewCosts ? <DashboardInventoryCosts /> : null}
      {tab === "staff-locations" && canManage ? <DashboardInventoryStaffLocations /> : null}

      {tab === "items" ? (
        <div className="inventory-command-items">
          <div className="inventory-command-toolbar">
            <label className="inventory-command-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
              <span className="visually-hidden">بحث عن مادة بالاسم أو الرمز</span>
              <input
                type="search"
                placeholder="ابحث عن مادة بالاسم أو SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void load(); }}
              />
            </label>
            <button type="button" className="inventory-command-refresh" onClick={() => void load()} disabled={loading}>
              <FontAwesomeIcon icon={faRotate} /> تحديث البيانات
            </button>
          </div>

          {!loading && lowStockItems.length > 0 ? (
            <div className="inventory-command-alert" role="status">
              <span className="inventory-command-alert-icon"><FontAwesomeIcon icon={faTriangleExclamation} /></span>
              <div>
                <strong>{lowStockItems.length.toLocaleString("ar-SA-u-nu-latn")} مواد تحتاج إعادة طلب</strong>
                <p>{lowStockItems.slice(0, 3).map((item) => `${item.name} (${qtyByItem.get(item.id) ?? "—"} / الحد ${item.min_stock_qty})`).join(" · ")}{lowStockItems.length > 3 ? " · وغيرها" : ""}</p>
              </div>
              <FontAwesomeIcon icon={faArrowTrendDown} className="inventory-command-alert-trend" />
            </div>
          ) : null}

          {error ? <DashboardErrorStateV2 title="تعذر تحميل المخزون" description={error} /> : null}
          {loading ? <DashboardSkeletonV2 lines={6} /> : null}

          {!loading && !error && items.length === 0 ? (
            <div className="inventory-command-empty" role="status">
              <div className="inventory-command-empty-art" aria-hidden="true">
                <div className="inventory-command-empty-circle"><FontAwesomeIcon icon={faBoxesStacked} /></div>
                <span className="inventory-command-empty-dot inventory-command-empty-dot--one" />
                <span className="inventory-command-empty-dot inventory-command-empty-dot--two" />
              </div>
              <h4>{search.trim() ? "لا توجد نتائج مطابقة" : "مخزونك يبدأ من هنا"}</h4>
              <p>{search.trim() ? "جرّب اسمًا أو رمزًا مختلفًا، ثم اضغط بحث أو Enter." : "أضف المواد المستخدمة في الخدمات، وحدد حد إعادة الطلب لكل مادة، ثم اربطها بوصفات الاستهلاك."}</p>
              {canManage && !search.trim() ? (
                <button type="button" className="inventory-command-primary" onClick={openCreate}><FontAwesomeIcon icon={faPlus} /> إضافة أول مادة <FontAwesomeIcon icon={faArrowLeft} /></button>
              ) : null}
              {search.trim() ? <button type="button" className="inventory-command-link" onClick={() => { setSearch(""); void load(""); }}>مسح البحث وعرض المواد</button> : null}
            </div>
          ) : null}

          {!loading && items.length > 0 ? (
            <div className="inventory-command-table-wrap">
              <div className="inventory-command-table-heading">
                <div><h4>قائمة المواد</h4><p>عرض الرصيد والحالة حسب كل مادة</p></div>
                <span>{items.length.toLocaleString("ar-SA-u-nu-latn")} مادة</span>
              </div>
              <div className="table-responsive">
                <table className="inventory-command-table">
                  <thead><tr>
                    <th scope="col">المادة</th>
                    <th scope="col">الوحدة</th>
                    <th scope="col">سياسة الاستهلاك</th>
                    <th scope="col">الرصيد حسب الموقع</th>
                    <th scope="col">حد الطلب</th>
                    <th scope="col">الحالة</th>
                    {canManage ? <th scope="col">الإجراءات</th> : null}
                  </tr></thead>
                  <tbody>{items.map((item) => {
                    const qty = qtyByItem.get(item.id);
                    const low = qty != null && Number(item.min_stock_qty || 0) > 0 && qty <= Number(item.min_stock_qty);
                    const active = Number(item.is_active) === 1;
                    return <tr key={item.id}>
                      <td><strong className="inventory-command-item-name">{item.name}</strong>{item.sku ? <span className="inventory-command-sku">{item.sku}</span> : null}</td>
                      <td>{item.unit}</td>
                      <td>{POLICIES.find((p) => p.value === item.consumption_policy)?.label || item.consumption_policy}</td>
                      <td><span className="inventory-command-stock">{locationStockLabel(item.id)}</span><span className="inventory-command-stock-total">الإجمالي: {qty == null ? "—" : qty.toLocaleString("ar-SA-u-nu-latn")}</span>{low ? <span className="inventory-command-pill inventory-command-pill--warning">مخزون منخفض</span> : null}</td>
                      <td>{item.min_stock_qty}</td>
                      <td><span className={`inventory-command-pill ${active ? "inventory-command-pill--success" : "inventory-command-pill--muted"}`}>{active ? "نشط" : "موقوف"}</span></td>
                      {canManage ? <td><button type="button" className="inventory-command-edit" onClick={() => openEdit(item)}>تعديل</button></td> : null}
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </div>
          ) : null}
          <div className="inventory-command-footnote"><FontAwesomeIcon icon={faCircleInfo} /> لا يُخصم المخزون إلا عند تأكيد الاستهلاك وفق السياسة المحددة.</div>
        </div>
      ) : null}
          </Suspense>
      </div>
      </div>

      <DashboardModalV2
        open={modalOpen}
        title={editing ? "تعديل مادة" : "مادة جديدة"}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setModalOpen(false)}>إلغاء</button>
            <button type="button" className="btn btn-dark" disabled={saving || !form.name.trim()} onClick={() => void save()}>
              {saving ? "جاري الحفظ..." : "حفظ"}
            </button>
          </>
        }
      >
        <DashboardFieldV2 id="inv-item-name" label="الاسم">
          <input className="form-control" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-item-unit" label="الوحدة">
          <DashboardSelectV2 id="inv-item-unit" value={form.unit} options={UNITS} onChange={(value) => setForm((prev) => ({ ...prev, unit: value }))} />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-item-policy" label="سياسة الاستهلاك">
          <DashboardSelectV2
            id="inv-item-policy"
            value={form.consumptionPolicy}
            options={POLICIES}
            onChange={(value) => setForm((prev) => ({ ...prev, consumptionPolicy: value as InventoryConsumptionPolicy }))}
          />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-item-min" label="حد إعادة الطلب">
          <DashboardNumberInputV2 id="inv-item-min" value={form.minStockQty} onChange={(e) => setForm((prev) => ({ ...prev, minStockQty: Number(e.target.value || 0) }))} />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-item-sku" label="SKU">
          <input className="form-control" value={form.sku} onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))} />
        </DashboardFieldV2>
        {editing ? (
          <DashboardFieldV2 id="inv-item-active" label="الحالة">
            <DashboardSelectV2
              id="inv-item-active"
              value={form.isActive}
              options={[{ value: "1", label: "نشط" }, { value: "0", label: "موقوف" }]}
              onChange={(value) => setForm((prev) => ({ ...prev, isActive: value }))}
            />
          </DashboardFieldV2>
        ) : canAdjust ? (
          <DashboardFieldV2 id="inv-item-opening" label="رصيد افتتاحي (اختياري)">
            <input className="form-control" inputMode="decimal" value={openingQty} onChange={(e) => setOpeningQty(e.target.value)} />
          </DashboardFieldV2>
        ) : null}
        <DashboardFieldV2 id="inv-item-notes" label="ملاحظات">
          <textarea className="form-control" rows={3} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
        </DashboardFieldV2>
      </DashboardModalV2>
    </section>
  );
}
