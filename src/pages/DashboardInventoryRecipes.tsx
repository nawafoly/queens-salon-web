import { useEffect, useMemo, useState } from "react";
import {
  DashboardActionFeedbackV2,
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
type DraftLineErrors = {
  inventoryItemId?: string;
  categoryId?: string;
  defaultQty?: string;
};
type ActionFeedback = { tone: "success" | "danger"; message: string } | null;

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
  const [lineErrors, setLineErrors] = useState<Record<string, DraftLineErrors>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [recipeLoadError, setRecipeLoadError] = useState("");
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>(null);

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
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const [serviceRows, itemRows, categoryRows] = await Promise.all([
          CoreCatalogService.listServices({ activeOnly: true }),
          CoreInventoryService.listItems({ active: "1" }),
          CoreInventoryService.listCategories({ active: "1" }),
        ]);
        if (cancelled) return;
        setServices((serviceRows || []).map((row) => ({ id: String(row.id), name: String((row as { name?: string }).name || row.id) })));
        setItems(itemRows || []);
        setCategories(categoryRows || []);
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLines([]);
    setLineErrors({});
    setRecipeLoadError("");
    setActionFeedback(null);

    if (!serviceId) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const recipe = await CoreInventoryService.getRecipeByService(serviceId);
        if (cancelled) return;
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
        if (!cancelled) setRecipeLoadError(errorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  function addLine() {
    setActionFeedback(null);
    setLines((prev) => [
      ...prev,
      { key: `new-${Date.now()}`, lineType: "SPECIFIC_ITEM", inventoryItemId: "", categoryId: "", defaultQty: "1", unit: "ml" },
    ]);
  }

  function clearLineError(key: string, field: keyof DraftLineErrors) {
    setLineErrors((current) => {
      if (!current[key]?.[field]) return current;
      const nextRow = { ...current[key] };
      delete nextRow[field];
      const next = { ...current };
      if (Object.keys(nextRow).length) next[key] = nextRow;
      else delete next[key];
      return next;
    });
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setActionFeedback(null);
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function save() {
    if (!serviceId) return;

    const nextErrors: Record<string, DraftLineErrors> = {};
    for (const line of lines) {
      const rowErrors: DraftLineErrors = {};
      const qty = Number(line.defaultQty);
      if (!Number.isFinite(qty) || qty <= 0) {
        rowErrors.defaultQty = "أدخل كمية أكبر من صفر.";
      }
      if (line.lineType === "SPECIFIC_ITEM" && !line.inventoryItemId) {
        rowErrors.inventoryItemId = "اختر مادة لهذا السطر.";
      }
      if (line.lineType === "CATEGORY" && !line.categoryId) {
        rowErrors.categoryId = "اختر فئة لهذا السطر.";
      }
      if (Object.keys(rowErrors).length) nextErrors[line.key] = rowErrors;
    }

    if (!lines.length) {
      setActionFeedback({ tone: "danger", message: "أضف سطر استهلاك واحدًا على الأقل قبل الحفظ." });
      return;
    }
    if (Object.keys(nextErrors).length) {
      setLineErrors(nextErrors);
      setActionFeedback({ tone: "danger", message: "راجع الحقول المميزة داخل أسطر الوصفة ثم أعد الحفظ." });
      return;
    }

    const payload: ServiceRecipeLineInput[] = lines.map((line) => ({
      lineType: line.lineType,
      inventoryItemId: line.lineType === "SPECIFIC_ITEM" ? line.inventoryItemId : null,
      categoryId: line.lineType === "CATEGORY" ? line.categoryId : null,
      defaultQty: Number(line.defaultQty),
      unit: line.unit,
    }));

    setSaving(true);
    setLineErrors({});
    setActionFeedback(null);
    try {
      await CoreInventoryService.saveRecipe(serviceId, payload);
      setActionFeedback({
        tone: "success",
        message: "تم حفظ وصفة الاستهلاك. الخصم لن يحدث إلا عند تأكيد التنفيذ.",
      });
    } catch (err) {
      setActionFeedback({ tone: "danger", message: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={6} />;
  if (loadError) {
    return <DashboardErrorStateV2 title="تعذر تحميل وصفات الاستهلاك" description={loadError} />;
  }

  return (
    <div>
      <p className="text-muted">الوصفة هي الاستهلاك القياسي للخدمة. لا يُخصم شيء عند إنشاء الحجز.</p>
      <DashboardFieldV2 id="inv-recipe-service" label="الخدمة">
        <DashboardSelectV2
          id="inv-recipe-service"
          value={serviceId}
          placeholder="اختاري خدمة"
          options={services.map((row) => ({ value: row.id, label: row.name }))}
          onChange={setServiceId}
        />
      </DashboardFieldV2>
      {recipeLoadError ? (
        <DashboardActionFeedbackV2
          compact
          revealOnMount
          tone="danger"
          title="تعذر تحميل وصفة الخدمة"
          description={recipeLoadError}
        />
      ) : null}
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
                  onChange={(value) => {
                    setLineErrors((current) => {
                      const next = { ...current };
                      delete next[line.key];
                      return next;
                    });
                    updateLine(line.key, { lineType: value as ServiceRecipeLineType });
                  }}
                />
              </DashboardFieldV2>
              {line.lineType === "SPECIFIC_ITEM" ? (
                <DashboardFieldV2 id={`${line.key}-item`} label="المادة" error={lineErrors[line.key]?.inventoryItemId}>
                  <DashboardSelectV2
                    value={line.inventoryItemId}
                    options={itemOptions}
                    onChange={(value) => {
                      const item = items.find((row) => row.id === value);
                      clearLineError(line.key, "inventoryItemId");
                      updateLine(line.key, { inventoryItemId: value, unit: item?.unit || line.unit });
                    }}
                  />
                </DashboardFieldV2>
              ) : (
                <DashboardFieldV2 id={`${line.key}-cat`} label="فئة المخزون" error={lineErrors[line.key]?.categoryId}>
                  <DashboardSelectV2
                    value={line.categoryId}
                    options={categoryOptions}
                    onChange={(value) => {
                      clearLineError(line.key, "categoryId");
                      updateLine(line.key, { categoryId: value });
                    }}
                  />
                </DashboardFieldV2>
              )}
              <DashboardFieldV2 id={`${line.key}-qty`} label="الكمية الافتراضية" error={lineErrors[line.key]?.defaultQty}>
                <DashboardNumberInputV2
                  value={line.defaultQty}
                  onChange={(e) => {
                    clearLineError(line.key, "defaultQty");
                    updateLine(line.key, { defaultQty: e.target.value });
                  }}
                />
              </DashboardFieldV2>
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={() => {
                  setLines((prev) => prev.filter((row) => row.key !== line.key));
                  setLineErrors((current) => {
                    const next = { ...current };
                    delete next[line.key];
                    return next;
                  });
                  setActionFeedback(null);
                }}
              >
                حذف السطر
              </button>
            </div>
          ))}
          {actionFeedback ? (
            <DashboardActionFeedbackV2
              revealOnMount
              tone={actionFeedback.tone}
              title={actionFeedback.tone === "success" ? "تم حفظ الوصفة" : "تعذر حفظ الوصفة"}
              description={actionFeedback.message}
            />
          ) : null}
          {canManage ? (
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-outline-dark" onClick={addLine}>إضافة سطر</button>
              <button type="button" className="btn btn-dark" disabled={saving} onClick={() => void save()}>
                {saving ? "جاري الحفظ..." : "حفظ الوصفة"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
