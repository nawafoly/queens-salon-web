/**
 * A CATEGORY recipe slot may be fulfilled by several products in the same
 * configured category and unit. Core validates every line against that slot
 * and aggregates duplicate item quantities before checking stock.
 */
import type { InventoryItem, ServiceRecipeLine } from "../../services/CoreInventoryService";

export type CategoryConsumptionDraft = {
  key: string;
  recipeLineId: string | null;
  lineType: "SPECIFIC_ITEM" | "CATEGORY";
  inventoryItemId: string;
  itemName: string;
  quantity: string;
  defaultQty: string;
  isMixAddition?: boolean;
};

export type RecipeConsumptionDraft = CategoryConsumptionDraft & {
  categoryId: string | null;
  defaultInventoryItemId: string;
  unit: string;
};

export function buildRecipeConsumptionDraft(
  recipeLines: ServiceRecipeLine[],
  trackedItems: InventoryItem[]
): RecipeConsumptionDraft[] {
  return recipeLines.flatMap((line, index) => {
    if (
      !((line.line_type === "SPECIFIC_ITEM" && line.inventory_item_id) ||
        (line.line_type === "CATEGORY" && line.category_id))
    ) return [];

    const categoryId = line.category_id ? String(line.category_id) : null;
    const specificItemId = line.inventory_item_id ? String(line.inventory_item_id) : "";
    const categoryDefault = categoryId
      ? trackedItems.find((item) => item.category_id === categoryId && item.unit === line.unit)?.id || ""
      : "";
    const inventoryItemId = line.line_type === "SPECIFIC_ITEM" ? specificItemId : categoryDefault;

    return [{
      key: line.id || `recipe-${index}`,
      recipeLineId: line.id || null,
      lineType: line.line_type,
      categoryId,
      defaultInventoryItemId: specificItemId || categoryDefault,
      inventoryItemId,
      itemName: trackedItems.find((item) => item.id === inventoryItemId)?.name || inventoryItemId,
      quantity: String(line.default_qty),
      defaultQty: String(line.default_qty),
      unit: line.unit,
    }];
  });
}

export function validateRecipeConsumptionDraft(
  lines: RecipeConsumptionDraft[],
  trackedItems: InventoryItem[]
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const line of lines) {
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || !line.quantity.trim()) {
      errors[line.key] = "الكمية الفعلية يجب أن تكون أكبر من صفر.";
      continue;
    }
    if (!line.inventoryItemId) {
      errors[line.key] = "اختاري منتجًا من الفئة المحددة.";
      continue;
    }
    if (line.lineType === "CATEGORY") {
      const valid = trackedItems.some((item) =>
        item.id === line.inventoryItemId && item.category_id === line.categoryId && item.unit === line.unit
      );
      if (!valid) {
        errors[line.key] = "المنتج لا يتبع فئة الوصفة ووحدة القياس المحددتين.";
        continue;
      }
      if (lines.some((other) => other.key !== line.key &&
        other.recipeLineId === line.recipeLineId && other.inventoryItemId === line.inventoryItemId)) {
        errors[line.key] = "لا يمكن تكرار المنتج في السطر نفسه من الوصفة.";
      }
    } else if (line.inventoryItemId !== line.defaultInventoryItemId) {
      errors[line.key] = "المنتج المحدد لا يطابق وصفة الاستهلاك.";
    }
  }
  return errors;
}

export function splitCategoryConsumptionLine<T extends CategoryConsumptionDraft>(
  lines: T[],
  key: string,
  nextKey: string,
  alternative: { id: string; name: string }
): T[] {
  const index = lines.findIndex((line) => line.key === key);
  const source = lines[index];
  if (
    !source || source.lineType !== "CATEGORY" || !source.recipeLineId || !source.inventoryItemId ||
    !alternative.id || !nextKey || lines.some((line) => line.key === nextKey) ||
    lines.some((line) => line.recipeLineId === source.recipeLineId && line.inventoryItemId === alternative.id)
  ) return lines;

  const quantity = Number(source.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return lines;
  const secondQty = quantity / 2;
  const firstQty = quantity - secondQty;

  return [
    ...lines.slice(0, index),
    { ...source, quantity: String(firstQty) },
    {
      ...source,
      key: nextKey,
      inventoryItemId: alternative.id,
      itemName: alternative.name,
      quantity: String(secondQty),
      defaultQty: "0",
      isMixAddition: true,
    },
    ...lines.slice(index + 1),
  ];
}

export function removeMixedCategoryLine<T extends CategoryConsumptionDraft>(lines: T[], key: string): T[] {
  const mixed = lines.find((line) => line.key === key);
  if (!mixed?.isMixAddition || !mixed.recipeLineId) return lines;
  const parent = lines.find((line) => line.recipeLineId === mixed.recipeLineId && !line.isMixAddition);
  if (!parent) return lines;
  const parentQuantity = Number(parent.quantity);
  const mixedQuantity = Number(mixed.quantity);
  if (!Number.isFinite(parentQuantity) || !Number.isFinite(mixedQuantity)) return lines;

  return lines
    .filter((line) => line.key !== key)
    .map((line) => line.key === parent.key
      ? { ...line, quantity: String(parentQuantity + mixedQuantity) }
      : line);
}
