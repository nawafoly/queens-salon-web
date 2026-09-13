// CORE D1 ONLY — do not add Firestore fallback.
// Inventory Control Center — Phase 1 foundation repository.

import {
  activeFlag,
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  integer,
  nowIso,
  optionalText,
  requiredId,
  requiredText,
  rowNotFound,
} from '../d1.js';
import { AppError } from '../errors.js';

const UNITS = new Set(['ml', 'g', 'piece', 'pair', 'unit', 'bottle', 'box']);
const POLICIES = new Set([
  'SERVICE_TRACKED',
  'EMPLOYEE_ISSUED',
  'DIRECT_SALE',
  'SHARED_OPERATIONAL',
]);
const LINE_TYPES = new Set(['SPECIFIC_ITEM', 'CATEGORY']);

function preferred(data, camel, snake) {
  return data[camel] !== undefined ? data[camel] : data[snake];
}

function positiveQty(value, field = 'quantity') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', `${field} must be > 0`);
  }
  return n;
}

function nonNegativeQty(value, field = 'quantity') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', `${field} must be >= 0`);
  }
  return n;
}

function requireUnit(value) {
  const unit = cleanText(value).toLowerCase();
  if (!UNITS.has(unit)) {
    throw new AppError(400, 'core_validation:invalid_unit', `unit is invalid: ${unit}`);
  }
  return unit;
}

function requirePolicy(value) {
  const policy = cleanText(value || 'SERVICE_TRACKED').toUpperCase();
  if (!POLICIES.has(policy)) {
    throw new AppError(400, 'core_validation:invalid_policy', `consumption_policy is invalid`);
  }
  return policy;
}

function actorFields(actor = {}) {
  return {
    uid: optionalText(actor.uid || actor.userId || actor.firebaseUid) || null,
    name: optionalText(actor.name || actor.displayName) || null,
  };
}

async function getStockLevelRow(db, salonId, itemId, locationId) {
  return dbFirst(
    db,
    `SELECT * FROM inventory_stock_levels
      WHERE salon_id = ? AND item_id = ? AND location_id = ?
      LIMIT 1`,
    [salonId, itemId, locationId]
  );
}

async function ensureStockLevel(db, salonId, itemId, locationId, now) {
  const existing = await getStockLevelRow(db, salonId, itemId, locationId);
  if (existing) return existing;

  const id = generatedId('invlvl');
  await dbRun(
    db,
    `INSERT INTO inventory_stock_levels
      (id, salon_id, item_id, location_id, qty_on_hand, updated_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [id, salonId, itemId, locationId, now]
  );
  return {
    id,
    salon_id: salonId,
    item_id: itemId,
    location_id: locationId,
    qty_on_hand: 0,
    updated_at: now,
  };
}

/**
 * Append a ledger movement and update the stock level read-model.
 * Never call from UI paths directly for arbitrary qty edits.
 */
async function appendMovement(db, salonId, input, actor = {}) {
  const now = nowIso();
  const who = actorFields(actor);
  const itemId = requiredId(input.itemId || input.item_id, 'itemId');
  const locationId = requiredId(input.locationId || input.location_id, 'locationId');
  const movementType = requiredText(input.movementType || input.movement_type, 'movementType', 64);
  const quantityDelta = Number(input.quantityDelta ?? input.quantity_delta);
  if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', 'quantity_delta must be non-zero');
  }
  const unit = requireUnit(input.unit);
  const sourceType = requiredText(input.sourceType || input.source_type, 'sourceType', 64);
  const sourceId = requiredText(input.sourceId || input.source_id, 'sourceId', 128);
  const lineKey = cleanText(input.lineKey || input.line_key || '0') || '0';

  const level = await ensureStockLevel(db, salonId, itemId, locationId, now);
  const balanceAfter = Number(level.qty_on_hand || 0) + quantityDelta;
  if (balanceAfter < -1e-9) {
    throw new AppError(409, 'inventory:insufficient_stock', 'Insufficient stock for this movement');
  }

  const movementId = generatedId('invmov');
  await dbRun(
    db,
    `INSERT INTO inventory_stock_movements (
      id, salon_id, item_id, location_id, movement_type,
      quantity_delta, unit, unit_cost_halalas, balance_after,
      source_type, source_id, line_key, operation_id,
      employee_id, booking_id, booking_item_id, service_id,
      reverses_movement_id, note,
      created_by_uid, created_by_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      movementId,
      salonId,
      itemId,
      locationId,
      movementType,
      quantityDelta,
      unit,
      input.unitCostHalalas != null ? integer(input.unitCostHalalas, 'unitCostHalalas', { min: 0 }) : null,
      balanceAfter,
      sourceType,
      sourceId,
      lineKey,
      optionalText(input.operationId || input.operation_id) || null,
      optionalText(input.employeeId || input.employee_id) || null,
      optionalText(input.bookingId || input.booking_id) || null,
      optionalText(input.bookingItemId || input.booking_item_id) || null,
      optionalText(input.serviceId || input.service_id) || null,
      optionalText(input.reversesMovementId || input.reverses_movement_id) || null,
      optionalText(input.note) || null,
      who.uid,
      who.name,
      now,
    ]
  );

  await dbRun(
    db,
    `UPDATE inventory_stock_levels
        SET qty_on_hand = ?, updated_at = ?
      WHERE salon_id = ? AND item_id = ? AND location_id = ?`,
    [balanceAfter, now, salonId, itemId, locationId]
  );

  return { movementId, balanceAfter, createdAt: now };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export async function listCategories(db, salonId, query = {}) {
  const where = ['salon_id = ?'];
  const params = [salonId];
  if (query.active !== undefined && query.active !== '') {
    where.push('active = ?');
    params.push(activeFlag(query.active));
  }
  return dbAll(
    db,
    `SELECT * FROM inventory_categories
      WHERE ${where.join(' AND ')}
      ORDER BY sort_order, name
      LIMIT 500`,
    params
  );
}

export async function createCategory(db, salonId, data, actor = {}) {
  const now = nowIso();
  const id = generatedId('invcat');
  await dbRun(
    db,
    `INSERT INTO inventory_categories
      (id, salon_id, name, parent_id, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      salonId,
      requiredText(data.name, 'name', 200),
      optionalText(data.parentId || data.parent_id) || null,
      activeFlag(data.active, 1),
      integer(data.sortOrder ?? data.sort_order ?? 0, 'sortOrder', { min: 0, max: 1_000_000 }),
      now,
      now,
    ]
  );
  return getCategory(db, salonId, id);
}

export async function getCategory(db, salonId, id) {
  const row = await dbFirst(
    db,
    'SELECT * FROM inventory_categories WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, requiredId(id)]
  );
  if (!row) rowNotFound('inventory_category');
  return row;
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------
export async function listLocations(db, salonId, query = {}) {
  const where = ['salon_id = ?'];
  const params = [salonId];
  if (query.active !== undefined && query.active !== '') {
    where.push('active = ?');
    params.push(activeFlag(query.active));
  }
  return dbAll(
    db,
    `SELECT * FROM inventory_locations
      WHERE ${where.join(' AND ')}
      ORDER BY is_default DESC, name
      LIMIT 100`,
    params
  );
}

export async function ensureDefaultLocation(db, salonId) {
  const existing = await dbFirst(
    db,
    `SELECT * FROM inventory_locations
      WHERE salon_id = ? AND is_default = 1 AND active = 1
      LIMIT 1`,
    [salonId]
  );
  if (existing) return existing;

  const now = nowIso();
  const id = generatedId('invloc');
  await dbRun(
    db,
    `INSERT INTO inventory_locations
      (id, salon_id, name, is_default, active, created_at, updated_at)
     VALUES (?, ?, ?, 1, 1, ?, ?)`,
    [id, salonId, 'Main', now, now]
  );
  return getLocation(db, salonId, id);
}

export async function getLocation(db, salonId, id) {
  const row = await dbFirst(
    db,
    'SELECT * FROM inventory_locations WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, requiredId(id)]
  );
  if (!row) rowNotFound('inventory_location');
  return row;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
export async function listItems(db, salonId, query = {}) {
  const where = ['salon_id = ?'];
  const params = [salonId];
  if (query.active !== undefined && query.active !== '') {
    where.push('is_active = ?');
    params.push(activeFlag(query.active));
  }
  if (optionalText(query.categoryId || query.category_id)) {
    where.push('category_id = ?');
    params.push(cleanText(query.categoryId || query.category_id));
  }
  if (optionalText(query.policy || query.consumption_policy)) {
    where.push('consumption_policy = ?');
    params.push(requirePolicy(query.policy || query.consumption_policy));
  }
  if (optionalText(query.search)) {
    where.push('(LOWER(name) LIKE ? OR LOWER(COALESCE(sku, \'\')) LIKE ? OR LOWER(COALESCE(barcode, \'\')) LIKE ?)');
    const s = `%${cleanText(query.search).toLowerCase()}%`;
    params.push(s, s, s);
  }
  return dbAll(
    db,
    `SELECT * FROM inventory_items
      WHERE ${where.join(' AND ')}
      ORDER BY name
      LIMIT 1000`,
    params
  );
}

export async function getItem(db, salonId, id) {
  const row = await dbFirst(
    db,
    'SELECT * FROM inventory_items WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, requiredId(id)]
  );
  if (!row) rowNotFound('inventory_item');
  return row;
}

export async function createItem(db, salonId, data, actor = {}) {
  const now = nowIso();
  const id = generatedId('invitem');
  await dbRun(
    db,
    `INSERT INTO inventory_items (
      id, salon_id, category_id, name, sku, barcode, unit,
      consumption_policy, track_batches, min_stock_qty, is_active, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      salonId,
      optionalText(preferred(data, 'categoryId', 'category_id')) || null,
      requiredText(data.name, 'name', 200),
      optionalText(data.sku) || null,
      optionalText(data.barcode) || null,
      requireUnit(data.unit),
      requirePolicy(preferred(data, 'consumptionPolicy', 'consumption_policy')),
      activeFlag(preferred(data, 'trackBatches', 'track_batches'), 0),
      nonNegativeQty(preferred(data, 'minStockQty', 'min_stock_qty') ?? 0, 'minStockQty'),
      activeFlag(preferred(data, 'isActive', 'is_active'), 1),
      optionalText(data.notes) || null,
      now,
      now,
    ]
  );
  return getItem(db, salonId, id);
}

export async function updateItem(db, salonId, id, data, actor = {}) {
  const current = await getItem(db, salonId, id);
  const now = nowIso();
  const name = data.name !== undefined ? requiredText(data.name, 'name', 200) : current.name;
  const unit = data.unit !== undefined ? requireUnit(data.unit) : current.unit;
  const policy =
    preferred(data, 'consumptionPolicy', 'consumption_policy') !== undefined
      ? requirePolicy(preferred(data, 'consumptionPolicy', 'consumption_policy'))
      : current.consumption_policy;

  await dbRun(
    db,
    `UPDATE inventory_items SET
      category_id = ?, name = ?, sku = ?, barcode = ?, unit = ?,
      consumption_policy = ?, track_batches = ?, min_stock_qty = ?,
      is_active = ?, notes = ?, updated_at = ?
     WHERE salon_id = ? AND id = ?`,
    [
      preferred(data, 'categoryId', 'category_id') !== undefined
        ? optionalText(preferred(data, 'categoryId', 'category_id')) || null
        : current.category_id,
      name,
      data.sku !== undefined ? optionalText(data.sku) || null : current.sku,
      data.barcode !== undefined ? optionalText(data.barcode) || null : current.barcode,
      unit,
      policy,
      preferred(data, 'trackBatches', 'track_batches') !== undefined
        ? activeFlag(preferred(data, 'trackBatches', 'track_batches'), 0)
        : current.track_batches,
      preferred(data, 'minStockQty', 'min_stock_qty') !== undefined
        ? nonNegativeQty(preferred(data, 'minStockQty', 'min_stock_qty'), 'minStockQty')
        : current.min_stock_qty,
      preferred(data, 'isActive', 'is_active') !== undefined
        ? activeFlag(preferred(data, 'isActive', 'is_active'), 1)
        : current.is_active,
      data.notes !== undefined ? optionalText(data.notes) || null : current.notes,
      now,
      salonId,
      requiredId(id),
    ]
  );
  return getItem(db, salonId, id);
}

// ---------------------------------------------------------------------------
// Stock levels + opening balance
// ---------------------------------------------------------------------------
export async function listStockLevels(db, salonId, query = {}) {
  const where = ['l.salon_id = ?'];
  const params = [salonId];
  if (optionalText(query.itemId || query.item_id)) {
    where.push('l.item_id = ?');
    params.push(cleanText(query.itemId || query.item_id));
  }
  if (optionalText(query.locationId || query.location_id)) {
    where.push('l.location_id = ?');
    params.push(cleanText(query.locationId || query.location_id));
  }
  if (String(query.lowOnly || query.low_only || '').toLowerCase() === 'true') {
    where.push('l.qty_on_hand <= i.min_stock_qty');
  }
  return dbAll(
    db,
    `SELECT l.*, i.name AS item_name, i.unit AS item_unit, i.min_stock_qty, i.sku, i.barcode
       FROM inventory_stock_levels l
       JOIN inventory_items i ON i.id = l.item_id AND i.salon_id = l.salon_id
      WHERE ${where.join(' AND ')}
      ORDER BY i.name
      LIMIT 2000`,
    params
  );
}

export async function recordOpeningBalance(db, salonId, data, actor = {}) {
  const itemId = requiredId(preferred(data, 'itemId', 'item_id'), 'itemId');
  const locationId =
    optionalText(preferred(data, 'locationId', 'location_id')) ||
    (await ensureDefaultLocation(db, salonId)).id;
  const qty = positiveQty(preferred(data, 'quantity', 'qty'), 'quantity');
  const item = await getItem(db, salonId, itemId);
  const sourceId = generatedId('invopen');

  return appendMovement(
    db,
    salonId,
    {
      itemId,
      locationId,
      movementType: 'OPENING_BALANCE_IN',
      quantityDelta: qty,
      unit: item.unit,
      unitCostHalalas: preferred(data, 'unitCostHalalas', 'unit_cost_halalas'),
      sourceType: 'opening_balance',
      sourceId,
      lineKey: '0',
      note: optionalText(data.note) || 'Opening balance',
    },
    actor
  );
}

export async function listMovements(db, salonId, query = {}) {
  const where = ['salon_id = ?'];
  const params = [salonId];
  if (optionalText(query.itemId || query.item_id)) {
    where.push('item_id = ?');
    params.push(cleanText(query.itemId || query.item_id));
  }
  if (optionalText(query.bookingItemId || query.booking_item_id)) {
    where.push('booking_item_id = ?');
    params.push(cleanText(query.bookingItemId || query.booking_item_id));
  }
  if (optionalText(query.employeeId || query.employee_id)) {
    where.push('employee_id = ?');
    params.push(cleanText(query.employeeId || query.employee_id));
  }
  const limit = integer(query.limit ?? 100, 'limit', { min: 1, max: 500 });
  return dbAll(
    db,
    `SELECT * FROM inventory_stock_movements
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${limit}`,
    params
  );
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
export async function getActiveRecipeForService(db, salonId, serviceId) {
  const recipe = await dbFirst(
    db,
    `SELECT * FROM service_consumption_recipes
      WHERE salon_id = ? AND service_id = ? AND is_active = 1
      LIMIT 1`,
    [salonId, requiredId(serviceId, 'serviceId')]
  );
  if (!recipe) return null;
  const lines = await dbAll(
    db,
    `SELECT * FROM service_consumption_recipe_lines
      WHERE salon_id = ? AND recipe_id = ?
      ORDER BY sort_order, created_at`,
    [salonId, recipe.id]
  );
  return { ...recipe, lines };
}

export async function upsertServiceRecipe(db, salonId, serviceId, data, actor = {}) {
  const sid = requiredId(serviceId, 'serviceId');
  const now = nowIso();
  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (!lines.length) {
    throw new AppError(400, 'core_validation:empty_recipe', 'Recipe must include at least one line');
  }

  const existing = await dbFirst(
    db,
    `SELECT * FROM service_consumption_recipes
      WHERE salon_id = ? AND service_id = ? AND is_active = 1
      LIMIT 1`,
    [salonId, sid]
  );

  let recipeId;
  if (existing) {
    await dbRun(
      db,
      `UPDATE service_consumption_recipes
          SET is_active = 0, updated_at = ?
        WHERE salon_id = ? AND id = ?`,
      [now, salonId, existing.id]
    );
    recipeId = generatedId('svcrecipe');
    await dbRun(
      db,
      `INSERT INTO service_consumption_recipes
        (id, salon_id, service_id, version, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [recipeId, salonId, sid, Number(existing.version || 1) + 1, now, now]
    );
  } else {
    recipeId = generatedId('svcrecipe');
    await dbRun(
      db,
      `INSERT INTO service_consumption_recipes
        (id, salon_id, service_id, version, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1, ?, ?)`,
      [recipeId, salonId, sid, now, now]
    );
  }

  let sort = 0;
  for (const line of lines) {
    const lineType = cleanText(line.lineType || line.line_type || 'SPECIFIC_ITEM').toUpperCase();
    if (!LINE_TYPES.has(lineType)) {
      throw new AppError(400, 'core_validation:invalid_line_type', 'Invalid recipe line_type');
    }
    const inventoryItemId = optionalText(line.inventoryItemId || line.inventory_item_id) || null;
    const categoryId = optionalText(line.categoryId || line.category_id) || null;
    if (lineType === 'SPECIFIC_ITEM' && !inventoryItemId) {
      throw new AppError(400, 'core_validation:missing_item', 'SPECIFIC_ITEM requires inventory_item_id');
    }
    if (lineType === 'CATEGORY' && !categoryId) {
      throw new AppError(400, 'core_validation:missing_category', 'CATEGORY requires category_id');
    }
    await dbRun(
      db,
      `INSERT INTO service_consumption_recipe_lines (
        id, salon_id, recipe_id, line_type, inventory_item_id, category_id,
        default_qty, unit, sort_order, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generatedId('svcrecipeln'),
        salonId,
        recipeId,
        lineType,
        lineType === 'SPECIFIC_ITEM' ? inventoryItemId : null,
        lineType === 'CATEGORY' ? categoryId : null,
        positiveQty(line.defaultQty ?? line.default_qty, 'defaultQty'),
        requireUnit(line.unit),
        sort++,
        now,
      ]
    );
  }

  return getActiveRecipeForService(db, salonId, sid);
}

// ---------------------------------------------------------------------------
// Confirm actual service consumption (core operation)
// ---------------------------------------------------------------------------
/**
 * data = {
 *   bookingId, bookingItemId, serviceId, employeeId, locationId?,
 *   operationId?,
 *   lines: [{ inventoryItemId, quantity, unit?, recipeLineId?, unitCostHalalas? }]
 * }
 *
 * Creates service_consumptions + lines + SERVICE_CONSUMPTION_OUT movements.
 * Protected by unique index on confirmed booking_item_id + optional operation_id.
 */
export async function confirmServiceConsumption(db, salonId, data, actor = {}) {
  const bookingId = requiredId(preferred(data, 'bookingId', 'booking_id'), 'bookingId');
  const bookingItemId = requiredId(preferred(data, 'bookingItemId', 'booking_item_id'), 'bookingItemId');
  const serviceId = requiredId(preferred(data, 'serviceId', 'service_id'), 'serviceId');
  const employeeId = requiredId(preferred(data, 'employeeId', 'employee_id'), 'employeeId');
  const locationId =
    optionalText(preferred(data, 'locationId', 'location_id')) ||
    (await ensureDefaultLocation(db, salonId)).id;
  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (!lines.length) {
    throw new AppError(400, 'core_validation:empty_consumption', 'Consumption requires at least one line');
  }

  const existing = await dbFirst(
    db,
    `SELECT id FROM service_consumptions
      WHERE salon_id = ? AND booking_item_id = ? AND status = 'confirmed'
      LIMIT 1`,
    [salonId, bookingItemId]
  );
  if (existing) {
    throw new AppError(
      409,
      'inventory:consumption_already_confirmed',
      'Service consumption already confirmed for this booking item'
    );
  }

  const now = nowIso();
  const who = actorFields(actor);
  const consumptionId = generatedId('svccons');
  const operationId =
    optionalText(preferred(data, 'operationId', 'operation_id')) || generatedId('invop');

  let totalCost = 0;
  const prepared = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const itemId = requiredId(line.inventoryItemId || line.inventory_item_id, 'inventoryItemId');
    const item = await getItem(db, salonId, itemId);
    const qty = positiveQty(line.quantity, 'quantity');
    const unit = line.unit ? requireUnit(line.unit) : item.unit;
    if (unit !== item.unit) {
      throw new AppError(400, 'core_validation:unit_mismatch', `Unit mismatch for item ${item.name}`);
    }
    const unitCost =
      line.unitCostHalalas != null || line.unit_cost_halalas != null
        ? integer(line.unitCostHalalas ?? line.unit_cost_halalas, 'unitCostHalalas', { min: 0 })
        : null;
    const lineCost = unitCost != null ? Math.round(unitCost * qty) : 0;
    totalCost += lineCost;
    prepared.push({
      item,
      itemId,
      qty,
      unit,
      unitCost,
      lineCost,
      recipeLineId: optionalText(line.recipeLineId || line.recipe_line_id) || null,
      lineKey: String(i),
    });
  }

  await dbRun(
    db,
    `INSERT INTO service_consumptions (
      id, salon_id, booking_id, booking_item_id, service_id, employee_id, location_id,
      status, total_material_cost_halalas, operation_id,
      confirmed_at, confirmed_by_uid, confirmed_by_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?)`,
    [
      consumptionId,
      salonId,
      bookingId,
      bookingItemId,
      serviceId,
      employeeId,
      locationId,
      totalCost,
      operationId,
      now,
      who.uid,
      who.name,
      now,
    ]
  );

  const movementIds = [];
  for (const line of prepared) {
    const mov = await appendMovement(
      db,
      salonId,
      {
        itemId: line.itemId,
        locationId,
        movementType: 'SERVICE_CONSUMPTION_OUT',
        quantityDelta: -line.qty,
        unit: line.unit,
        unitCostHalalas: line.unitCost,
        sourceType: 'service_consumption',
        sourceId: consumptionId,
        lineKey: line.lineKey,
        operationId,
        employeeId,
        bookingId,
        bookingItemId,
        serviceId,
        note: `Service consumption ${serviceId}`,
      },
      actor
    );
    movementIds.push(mov.movementId);

    await dbRun(
      db,
      `INSERT INTO service_consumption_lines (
        id, salon_id, consumption_id, recipe_line_id, inventory_item_id,
        quantity, unit, unit_cost_halalas, line_cost_halalas, stock_movement_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generatedId('svcconsln'),
        salonId,
        consumptionId,
        line.recipeLineId,
        line.itemId,
        line.qty,
        line.unit,
        line.unitCost,
        line.lineCost,
        mov.movementId,
        now,
      ]
    );
  }

  return {
    consumptionId,
    operationId,
    totalMaterialCostHalalas: totalCost,
    movementIds,
    confirmedAt: now,
  };
}

export async function getServiceConsumptionByBookingItem(db, salonId, bookingItemId) {
  const row = await dbFirst(
    db,
    `SELECT * FROM service_consumptions
      WHERE salon_id = ? AND booking_item_id = ? AND status = 'confirmed'
      LIMIT 1`,
    [salonId, requiredId(bookingItemId, 'bookingItemId')]
  );
  if (!row) return null;
  const lines = await dbAll(
    db,
    `SELECT * FROM service_consumption_lines
      WHERE salon_id = ? AND consumption_id = ?
      ORDER BY created_at`,
    [salonId, row.id]
  );
  return { ...row, lines };
}