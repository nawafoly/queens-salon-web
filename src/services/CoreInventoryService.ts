import { coreApiRequest } from "./coreApiClient";

export type InventoryConsumptionPolicy =
  | "SERVICE_TRACKED"
  | "EMPLOYEE_ISSUED"
  | "DIRECT_SALE"
  | "SHARED_OPERATIONAL";

export type InventoryItem = {
  id: string;
  salon_id: string;
  category_id: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  consumption_policy: InventoryConsumptionPolicy;
  track_batches: number;
  min_stock_qty: number;
  is_active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryCategory = {
  id: string;
  salon_id: string;
  name: string;
  parent_id: string | null;
  active: number;
  sort_order: number;
};

export type InventoryStockLevel = {
  id: string;
  salon_id: string;
  item_id: string;
  location_id: string;
  qty_on_hand: number;
  item_name?: string;
  item_unit?: string;
  min_stock_qty?: number;
  sku?: string | null;
};

export type InventoryMovement = {
  id: string;
  item_id: string;
  movement_type: string;
  qty_delta: number;
  qty_before: number;
  qty_after: number;
  unit?: string | null;
  booking_id?: string | null;
  booking_item_id?: string | null;
  employee_id?: string | null;
  note?: string | null;
  created_at: string;
};

export type InventoryItemInput = {
  name: string;
  unit: string;
  categoryId?: string | null;
  sku?: string | null;
  barcode?: string | null;
  consumptionPolicy?: InventoryConsumptionPolicy;
  minStockQty?: number;
  isActive?: number;
  notes?: string | null;
};

export type ServiceRecipeLineType = "SPECIFIC_ITEM" | "CATEGORY";

export type ServiceRecipeLine = {
  id: string;
  recipe_id: string;
  line_type: ServiceRecipeLineType;
  inventory_item_id: string | null;
  category_id: string | null;
  default_qty: number;
  unit: string;
  sort_order: number;
};

export type ServiceConsumptionRecipe = {
  id: string;
  service_id: string;
  version: number;
  is_active: number;
  lines: ServiceRecipeLine[];
};

export type ServiceRecipeLineInput = {
  lineType: ServiceRecipeLineType;
  inventoryItemId?: string | null;
  categoryId?: string | null;
  defaultQty: number;
  unit: string;
};

export const CoreInventoryService = {
  listCategories(query: { active?: string } = {}) {
    return coreApiRequest<InventoryCategory[]>("/api/core/inventory/categories", { query });
  },
  createCategory(input: { name: string }) {
    return coreApiRequest<InventoryCategory>("/api/core/inventory/categories", { method: "POST", body: input });
  },
  listItems(query: { search?: string; active?: string; categoryId?: string; policy?: string } = {}) {
    return coreApiRequest<InventoryItem[]>("/api/core/inventory/items", { query });
  },
  createItem(input: InventoryItemInput) {
    return coreApiRequest<InventoryItem>("/api/core/inventory/items", { method: "POST", body: input });
  },
  updateItem(id: string, input: Partial<InventoryItemInput>) {
    return coreApiRequest<InventoryItem>(`/api/core/inventory/items/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
  },
  listStockLevels(query: { lowOnly?: string } = {}) {
    return coreApiRequest<InventoryStockLevel[]>("/api/core/inventory/stock-levels", { query });
  },
  listMovements(query: { itemId?: string; limit?: string } = {}) {
    return coreApiRequest<InventoryMovement[]>("/api/core/inventory/movements", { query });
  },
  recordOpeningBalance(input: { itemId: string; quantity: number; note?: string }) {
    return coreApiRequest("/api/core/inventory/opening-balance", { method: "POST", body: input });
  },
  getRecipeByService(serviceId: string) {
    return coreApiRequest<ServiceConsumptionRecipe | null>(
      `/api/core/inventory/recipes/by-service/${encodeURIComponent(serviceId)}`
    );
  },
  getConsumptionByBookingItem(bookingItemId: string) {
    return coreApiRequest(
      `/api/core/inventory/consumptions/by-booking-item/${encodeURIComponent(bookingItemId)}`
    );
  },
  confirmConsumption(input: {
    bookingItemId: string;
    employeeId: string;
    lines: Array<{ inventoryItemId: string; quantity: number; unit?: string; recipeLineId?: string | null }>;
  }) {
    return coreApiRequest("/api/core/inventory/consumptions/confirm", {
      method: "POST",
      body: input,
    });
  },
  issueToEmployee(input: { itemId: string; employeeId: string; quantity: number; note?: string }) {
    return coreApiRequest("/api/core/inventory/employee-issue", { method: "POST", body: input });
  },
  returnFromEmployee(input: { itemId: string; employeeId: string; quantity: number; note?: string }) {
    return coreApiRequest("/api/core/inventory/employee-return", { method: "POST", body: input });
  },
  saveRecipe(serviceId: string, lines: ServiceRecipeLineInput[]) {
    return coreApiRequest<ServiceConsumptionRecipe>(
      `/api/core/inventory/recipes/by-service/${encodeURIComponent(serviceId)}`,
      { method: "PUT", body: { lines } }
    );
  },
};
