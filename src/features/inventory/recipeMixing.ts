/**
 * A CATEGORY recipe slot may be fulfilled by several products in the same
 * configured category and unit. Core validates every line against that slot
 * and aggregates duplicate item quantities before checking stock.
 */
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
