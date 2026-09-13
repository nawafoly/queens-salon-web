import { useEffect, useMemo, useState } from "react";
import {
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardNumberInputV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import { CoreCatalogService } from "../services/CoreCatalogService";
import {
  CoreInventoryService,
  type InventoryCategory,
  type InventoryItem,
  type ServiceRecipeLineInput,
  type ServiceRecipeLineType,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

type ServiceOption = { id: string; name: string };
type DraftLine = {
  key: string;
  lineType: ServiceRecipeLineType;
  inventoryItemId: string;
  categoryId: string;
  defaultQty: string;
  unit: string;
};

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) return error.message;
  return "تعذر تحميل أو حفظ وصفة الاستهلاك.";
}

export default function DashboardInventoryRecipes() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("inventory.recipes.manage");
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const itemOptions = useMemo(
    () =>
      items
        .filter((item) => item.consumption_policy === "SERVICE_TRACKED" && Number(item.is_active) === 1)
        .map((item) => ({ value: item.id, label: `${item.name} (${item.unit})` })),
    [items]
  );
  const categoryOptions = useMemo(
    () => categories.filter((row) => Number(row.active) === 1).map((row) => ({ value: row.id, label: row.name })),
    [categories]
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [serviceRows, itemRows, categoryRows] = await Promise.all([
          CoreCatalogService.listServices({ activeOnly: true }),
          CoreInventoryService.listItems({ active: "1" }),
          CoreInventoryService.listCategories({ active: "1" }),
        ]);
        setServices((serviceRows || []).map((row) => ({ id: String(row.id), name: String((row as { name?: string }).name || row.id) })));
        setItems(itemRows || []);
        setCategories(categoryRows || []);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!serviceId) {
      setLines([]);
      return;
    }
    void (async () => {
      setError("");
      try {
        const recipe = await CoreInventoryService.getRecipeByService(serviceId);
        setLines(
          (recipe?.lines || []).map((line, index) => ({
            key: line.id || `line-${index}`,
            lineType: line.line_type,
            inventoryItemId: line.inventory_item_id || "",
            categoryId: line.category_id || "",
            defaultQty: String(line.default_qty || ""),
            unit: line.unit,
          }))
        );
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [serviceId]);

  function addLine() {
    setLines((prev) => [
      ...prev,
      { key: `new-${Date.now()}`, lineType: "SPECIFIC_ITEM", inventoryItemId: "", categoryId: "", defaultQty: "1", unit: "ml" },
    ]);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function save() {
    if (!serviceId) return;
    const payload: ServiceRecipeLineInput[] = lines.map((line) => ({
      lineType: line.lineType,
      inventoryItemId: line.lineType === "SPECIFIC_ITEM" ? line.inventoryItemId : null,
      categoryId: line.lineType === "CATEGORY" ? line.categoryId : null,
      defaultQty: Number(line.defaultQty),
      unit: line.unit,
    }));
    if (!payload.length || payload.some((line) => !line.defaultQty || line.defaultQty <= 0)) {
      setError("كل سطر يحتاج كمية أكبر من صفر.");
      return;
    }
    if (payload.some((line) => line.lineType === "SPECIFIC_ITEM" && !line.inventoryItemId)) {
      setError("اختر مادة لكل سطر من نوع مادة محددة.");
      return;
    }
    if (payload.some((line) => line.lineType === "CATEGORY" && !line.categoryId)) {
      setError("اختر فئة لكل سطر من نوع فئة.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await CoreInventoryService.saveRecipe(serviceId, payload);
      setNotice("تم حفظ وصفة الاستهلاك. الخصم لن يحدث إلا عند تأكيد التنفيذ.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={6} />;

  return (
    <div>
      <p className="text-muted">الوصفة هي الاستهلاك القياسي للخدمة. لا يُخصم شيء عند إنشاء الحجز.</p>
      {error ? <DashboardErrorStateV2 title="تعذر حفظ الوصفة" description={error} /> : null}
      {notice ? <p className="text-success">{notice}</p> : null}
      <DashboardFieldV2 id="inv-recipe-service" label="الخدمة">
        <DashboardSelectV2
          id="inv-recipe-service"
          value={serviceId}
          placeholder="اختاري خدمة"
          options={services.map((row) => ({ value: row.id, label: row.name }))}
          onChange={(value) => setServiceId(value)}
        />
      </DashboardFieldV2>
      {!serviceId ? (
        <DashboardEmptyStateV2 title="اختاري خدمة" description="بعد الاختيار تظهر أسطر الوصفة الحالية إن وجدت." />
      ) : (
        <>
          {lines.map((line) => (
            <div key={line.key} className="border rounded p-3 mb-3">
              <DashboardFieldV2 id={`${line.key}-type`} label="نوع السطر">
                <DashboardSelectV2
                  value={line.lineType}
                  options={[
                    { value: "SPECIFIC_ITEM", label: "مادة محددة" },
                    { value: "CATEGORY", label: "فئة / بدائل" },
                  ]}
                  onChange={(value) => updateLine(line.key, { lineType: value as ServiceRecipeLineType })}
                />
              </DashboardFieldV2>
              {line.lineType === "SPECIFIC_ITEM" ? (
                <DashboardFieldV2 id={`${line.key}-item`} label="المادة">
                  <DashboardSelectV2
                    value={line.inventoryItemId}
                    options={itemOptions}
                    onChange={(value) => {
                      const item = items.find((row) => row.id === value);
                      updateLine(line.key, { inventoryItemId: value, unit: item?.unit || line.unit });
                    }}
                  />
                </DashboardFieldV2>
              ) : (
                <DashboardFieldV2 id={`${line.key}-cat`} label="فئة المخزون">
                  <DashboardSelectV2
                    value={line.categoryId}
                    options={categoryOptions}
                    onChange={(value) => updateLine(line.key, { categoryId: value })}
                  />
                </DashboardFieldV2>
              )}
              <DashboardFieldV2 id={`${line.key}-qty`} label="الكمية الافتراضية">
                <DashboardNumberInputV2
                  value={line.defaultQty}
                  onChange={(e) => updateLine(line.key, { defaultQty: e.target.value })}
                />
              </DashboardFieldV2>
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setLines((prev) => prev.filter((row) => row.key !== line.key))}>
                حذف السطر
              </button>
            </div>
          ))}
          {canManage ? (
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-outline-dark" onClick={addLine}>إضافة سطر</button>
              <button type="button" className="btn btn-dark" disabled={saving || !lines.length} onClick={() => void save()}>
                {saving ? "جاري الحفظ..." : "حفظ الوصفة"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
