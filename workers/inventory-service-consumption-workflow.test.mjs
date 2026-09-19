import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveServiceConsumptionLifecycle } from "./core/repositories/inventory.js";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("Guard: booking create/status paths never call inventory consumption deduct", () => {
  const bookings = read("workers/core/repositories/bookings.js");
  assert.doesNotMatch(bookings, /confirmServiceConsumption/);
  assert.doesNotMatch(bookings, /SERVICE_CONSUMPTION_OUT/);
  assert.doesNotMatch(bookings, /from ['\"].*inventory/);
});

test("Guard: confirm binds booking item, SERVICE_TRACKED only, and is idempotent", () => {
  const inv = read("workers/core/repositories/inventory.js");
  assert.match(inv, /export async function confirmServiceConsumption/);
  assert.match(inv, /bookingItemId/);
  assert.match(inv, /consumption_policy !== 'SERVICE_TRACKED'/);
  assert.match(inv, /inventory:consumption_already_confirmed/);
  assert.match(inv, /idx_svc_consumptions_booking_item_confirmed|status = 'confirmed'/);
  assert.match(inv, /SERVICE_CONSUMPTION_OUT/);
  assert.match(inv, /source_type[\s\S]*service_consumption|'service_consumption'/);
  assert.match(inv, /inventory:consumption_not_due/);
  assert.match(inv, /cannot be confirmed before the booking date/);
});

test("Guard: pending worklist is booking-item grain with derived lifecycle", () => {
  const inv = read("workers/core/repositories/inventory.js");
  const worker = read("workers/core/index.js");
  const ui = read("src/pages/EmployeeServiceConsumption.tsx");
  const service = read("src/services/CoreInventoryService.ts");

  assert.match(inv, /export async function listPendingServiceConsumptions/);
  assert.match(inv, /export function deriveServiceConsumptionLifecycle/);
  assert.match(inv, /sc\.status = 'confirmed'/);
  assert.match(inv, /sc\.id IS NULL/);
  assert.match(inv, /service_consumption_recipes/);
  assert.match(inv, /bi\.staff_id = \? OR b\.staff_id = \?/);
  assert.match(inv, /UPCOMING|DUE_TODAY|PENDING_CONFIRMATION|OVERDUE/);
  assert.match(inv, /scope === 'worklist'/);
  assert.match(inv, /can_confirm/);

  assert.match(worker, /inventory:consumptions-pending/);
  assert.match(worker, /\/api\/core\/inventory\/consumptions\/pending/);
  assert.match(worker, /listPendingServiceConsumptions/);

  assert.match(service, /listPendingConsumptions/);
  assert.match(service, /ServiceConsumptionLifecycle/);
  assert.match(ui, /listPendingConsumptions/);
  assert.match(ui, /scope: "worklist"/);
  assert.match(ui, /booking_item_id/);
  assert.match(ui, /refreshPending|setPending/);
  assert.match(ui, /policy: "SERVICE_TRACKED"/);
  assert.match(ui, /مطلوب اليوم/);
  assert.match(ui, /بانتظار التأكيد/);
  assert.match(ui, /متأخر/);
  assert.match(ui, /UPCOMING/);
  assert.match(ui, /can_confirm|selectedConfirmable/);
});

test("Guard: employee portal wires consumption confirm route", () => {
  const portal = read("src/pages/EmployeePortal.tsx");
  assert.match(portal, /EmployeeServiceConsumption/);
  assert.match(portal, /\/employee\/consumption/);
  assert.match(portal, /inventory\.consume\.confirm/);
});

test("Guard: recipe default qty shown and product\/qty editable before confirm", () => {
  const ui = read("src/pages/EmployeeServiceConsumption.tsx");
  assert.match(ui, /default_qty/);
  assert.match(ui, /changeProduct|inventoryItemId/);
  assert.match(ui, /<select/);
  assert.match(ui, /quantity/);
  assert.match(ui, /confirmConsumption/);
});

test("Guard: admin consumption UI surfaces overdue without new dashboard", () => {
  const admin = read("src/pages/DashboardInventoryConsumption.tsx");
  assert.match(admin, /lifecycle: "OVERDUE"/);
  assert.match(admin, /overdueRows/);
  assert.match(admin, /متأخر بانتظار التأكيد/);
  assert.match(admin, /item_staff_id|booking_staff_id/);
});

test("Lifecycle: next-week booking is UPCOMING and not confirmable", () => {
  const lifecycle = deriveServiceConsumptionLifecycle(
    {
      booking_date: "2026-09-23",
      start_time: "10:00",
      end_time: "11:00",
      booking_status: "confirmed",
    },
    { today: "2026-09-16", nowHHMM: "12:00" }
  );
  assert.equal(lifecycle, "UPCOMING");
});

test("Lifecycle: booking day before start is DUE_TODAY", () => {
  const lifecycle = deriveServiceConsumptionLifecycle(
    {
      booking_date: "2026-09-16",
      start_time: "15:00",
      end_time: "16:00",
      booking_status: "confirmed",
    },
    { today: "2026-09-16", nowHHMM: "10:00" }
  );
  assert.equal(lifecycle, "DUE_TODAY");
});

test("Lifecycle: after start becomes PENDING_CONFIRMATION", () => {
  const lifecycle = deriveServiceConsumptionLifecycle(
    {
      booking_date: "2026-09-16",
      start_time: "10:00",
      end_time: "11:00",
      booking_status: "confirmed",
    },
    { today: "2026-09-16", nowHHMM: "10:30" }
  );
  assert.equal(lifecycle, "PENDING_CONFIRMATION");
});

test("Lifecycle: after end without confirm is OVERDUE and sticky across days", () => {
  assert.equal(
    deriveServiceConsumptionLifecycle(
      {
        booking_date: "2026-09-16",
        start_time: "10:00",
        end_time: "11:00",
        booking_status: "confirmed",
      },
      { today: "2026-09-16", nowHHMM: "11:01" }
    ),
    "OVERDUE"
  );
  assert.equal(
    deriveServiceConsumptionLifecycle(
      {
        booking_date: "2026-09-15",
        start_time: "10:00",
        end_time: "11:00",
        booking_status: "completed",
      },
      { today: "2026-09-16", nowHHMM: "09:00" }
    ),
    "OVERDUE"
  );
});

test("Lifecycle: confirmed row stays CONFIRMED", () => {
  assert.equal(
    deriveServiceConsumptionLifecycle(
      {
        booking_date: "2026-09-16",
        start_time: "10:00",
        end_time: "11:00",
        consumption_status: "confirmed",
      },
      { today: "2026-09-16", nowHHMM: "12:00" }
    ),
    "CONFIRMED"
  );
});

test("Lifecycle: duration derives end time when end_time missing", () => {
  assert.equal(
    deriveServiceConsumptionLifecycle(
      {
        booking_date: "2026-09-16",
        start_time: "10:00",
        duration_minutes: 60,
        booking_status: "confirmed",
      },
      { today: "2026-09-16", nowHHMM: "11:05" }
    ),
    "OVERDUE"
  );
});


test("Guard: stock transfer is one atomic D1 batch with idempotent replay", () => {
  const inv = read("workers/core/repositories/inventory.js");
  const start = inv.indexOf("export async function transferStock");
  assert.notEqual(start, -1);
  const transfer = inv.slice(start);

  assert.match(transfer, /const statements = \[/);
  assert.match(transfer, /results = await dbBatch\(db, statements\)/);
  assert.doesNotMatch(transfer, /await appendMovement\(/);
  assert.match(transfer, /TRANSFER_OUT/);
  assert.match(transfer, /TRANSFER_IN/);
  assert.match(
    transfer,
    /source_movement\.movement_type = 'TRANSFER_OUT'/
  );
  assert.match(transfer, /inventory:insufficient_stock/);
  assert.match(transfer, /inventory:operation_id_reused/);
  assert.match(transfer, /replayed: true/);
});


test("Guard: purchase-order receipt is atomic, guarded, and idempotent", () => {
  const inv = read("workers/core/repositories/inventory.js");
  const start = inv.indexOf("export async function receivePurchaseOrderLine");
  const end = inv.indexOf("export async function transferStock", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const receive = inv.slice(start, end);

  assert.match(receive, /const statements = \[/);
  assert.match(receive, /results = await dbBatch\(\s*db,\s*statements\s*\)/);
  assert.doesNotMatch(receive, /await receivePurchase\(/);
  assert.match(receive, /PURCHASE_RECEIPT_IN/);
  assert.match(receive, /qty_received \+ \?/);
  assert.match(receive, /qty_ordered \+ 0\.000000001/);
  assert.match(receive, /inventory:po_over_receive/);
  assert.match(receive, /inventory:operation_id_reused/);
  assert.match(receive, /replayed: true/);
  assert.match(receive, /THEN 'PARTIAL'/);
  assert.match(receive, /ELSE 'RECEIVED'/);
});

test("Guard: inventory ledger writes inherit the HTTP idempotency key", () => {
  const worker = read("workers/core/index.js");
  assert.match(worker, /"inventory:consumption-confirm"/);
  assert.match(worker, /"inventory:purchase-order-receive"/);
  assert.match(worker, /"inventory:transfer"/);
  assert.match(worker, /request\.headers\.get\("Idempotency-Key"\)/);
  assert.match(worker, /operationId: headerOperationId/);
});


test("Guard: service consumption deducts from the employee home inventory location", () => {
  const inv = read("workers/core/repositories/inventory.js");
  const start = inv.indexOf("export async function confirmServiceConsumption");
  const end = inv.indexOf("export async function getServiceConsumptionByBookingItem", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const confirm = inv.slice(start, end);

  assert.match(confirm, /getStaffHomeLocation\(/);
  assert.match(confirm, /staffHomeLocation\.locationId/);
  assert.match(confirm, /ensureDefaultLocation\(/);
  assert.doesNotMatch(confirm, /preferred\(data, 'locationId', 'location_id'\)/);
});


test("Guard: consumption cannot be confirmed before execution or by another employee", () => {
  const inv = read("workers/core/repositories/inventory.js");
  const worker = read("workers/core/index.js");
  const ui = read("src/pages/EmployeeServiceConsumption.tsx");

  const validationStart = inv.indexOf("async function validateServiceConsumptionContext");
  const validationEnd = inv.indexOf("async function getStockLevelRow", validationStart);
  assert.notEqual(validationStart, -1);
  assert.notEqual(validationEnd, -1);
  const validation = inv.slice(validationStart, validationEnd);

  assert.match(validation, /booking_staff_id/);
  assert.match(validation, /inventory:booking_employee_mismatch/);
  assert.match(validation, /deriveServiceConsumptionLifecycle/);
  assert.match(validation, /lifecycle === 'UPCOMING'/);
  assert.match(validation, /lifecycle === 'DUE_TODAY'/);
  assert.match(validation, /inventory:consumption_not_due/);

  assert.match(worker, /ctx\.role === "staff"/);
  assert.match(worker, /employeeId: ctx\.employeeId/);

  assert.match(ui, /selected\?\.can_confirm === true/);
  assert.match(ui, /selected\?\.lifecycle === "PENDING_CONFIRMATION"/);
  assert.match(ui, /selected\?\.lifecycle === "OVERDUE"/);
});


test("Guard: material use requires an accepted booking state", () => {
  const inv = read("workers/core/repositories/inventory.js");
  assert.match(inv, /inventory:booking_not_confirmed/);
  assert.match(inv, /'booked', 'confirmed', 'completed'/);
  assert.match(inv, /bookingAllowsConsumption/);
});


test("Guard: category recipe alternatives stay constrained to the configured category", () => {
  const ui = read("src/pages/EmployeeServiceConsumption.tsx");
  const inv = read("workers/core/repositories/inventory.js");

  assert.match(ui, /lineType: ServiceRecipeLine\["line_type"\]/);
  assert.match(ui, /line\.line_type === "CATEGORY"/);
  assert.match(ui, /item\.category_id === line\.categoryId/);
  assert.match(ui, /recipeLineId: line\.recipeLineId/);
  assert.match(
    ui,
    /disabled=\{!selectedConfirmable \|\| line\.lineType === "SPECIFIC_ITEM"\}/
  );
  assert.match(inv, /inventory:item_not_in_recipe_category/);
  assert.match(inv, /inventory:item_not_matching_recipe_line/);
});

test("Guard: empty recipes do not create impossible material tasks", () => {
  const inv = read("workers/core/repositories/inventory.js");
  assert.match(
    inv,
    /service_consumption_recipe_lines rl[\s\S]*rl\.recipe_id = r\.id/
  );
});
