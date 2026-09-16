// CORE D1 ONLY ظ¤ do not add Firestore fallback.
// Inventory Control Center ظ¤ Phase 1 foundation repository.

import {
  activeFlag,
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  changes,
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


const SALON_TZ = 'Asia/Riyadh';
const CONSUMPTION_LIFECYCLES = new Set([
  'UPCOMING',
  'DUE_TODAY',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'OVERDUE',
]);

function salonTodayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SALON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function salonNowHHMM(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${read('hour')}:${read('minute')}`;
}

function normalizeClock(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hh = Math.min(23, Math.max(0, Number(match[1])));
  const mm = Math.min(59, Math.max(0, Number(match[2])));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function addMinutesToClock(clock, minutes) {
  const normalized = normalizeClock(clock);
  if (!normalized || !Number.isFinite(Number(minutes))) return '';
  const [hh, mm] = normalized.split(':').map(Number);
  const total = hh * 60 + mm + Math.max(0, Math.trunc(Number(minutes)));
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

function effectiveEndTime(row = {}) {
  const explicit = normalizeClock(row.end_time || row.endTime);
  if (explicit) return explicit;
  const start = normalizeClock(row.start_time || row.startTime);
  const duration = Number(row.duration_minutes ?? row.durationMinutes);
  if (start && Number.isFinite(duration) && duration > 0) {
    return addMinutesToClock(start, duration);
  }
  return '';
}

function shiftISODate(isoDate, deltaDays) {
  const raw = cleanText(isoDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [y, m, d] = raw.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + Number(deltaDays || 0));
  return utc.toISOString().slice(0, 10);
}

function queryFlag(value) {
  const raw = cleanText(value).toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Derived same-day consumption lifecycle (booking-item grain).
 * Prefer computed read-model — no persisted status column required.
 */
export function deriveServiceConsumptionLifecycle(row = {}, clock = {}) {
  const today = cleanText(clock.today) || salonTodayISO();
  const nowHHMM = normalizeClock(clock.nowHHMM) || salonNowHHMM();
  if (
    cleanText(row.consumption_status || row.consumptionStatus).toLowerCase() === 'confirmed' ||
    row.confirmed === true ||
    row.is_confirmed === 1
  ) {
    return 'CONFIRMED';
  }

  const bookingDate = cleanText(row.booking_date || row.bookingDate);
  if (!bookingDate) return 'PENDING_CONFIRMATION';
  if (bookingDate > today) return 'UPCOMING';
  if (bookingDate < today) return 'OVERDUE';

  const start = normalizeClock(row.start_time || row.startTime);
  const end = effectiveEndTime(row);
  const bookingStatus = cleanText(row.booking_status || row.bookingStatus).toLowerCase();
  const executed = bookingStatus === 'completed' || bookingStatus === 'done';

  if (end && nowHHMM > end) return 'OVERDUE';
  if (executed || (start && nowHHMM >= start)) return 'PENDING_CONFIRMATION';
  return 'DUE_TODAY';
}


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
async function validateServiceConsumptionContext(
  db,
  salonId,
  { bookingItemId, employeeId }
) {
  const context = await dbFirst(
    db,
    `SELECT
       bi.id AS booking_item_id,
       bi.booking_id,
       bi.service_id,
       bi.staff_id,
       COALESCE(bi.booking_date, b.booking_date) AS booking_date,
       COALESCE(bi.start_time, b.start_time) AS start_time,
       COALESCE(bi.end_time, b.end_time) AS end_time,
       bi.duration_minutes,
       b.status AS booking_status,
       b.deleted_at AS booking_deleted_at,
       s.id AS service_exists,
       s.active AS service_active,
       ep.id AS employee_exists,
       ep.status AS employee_status
     FROM booking_items bi
     JOIN bookings b
       ON b.id = bi.booking_id
      AND b.salon_id = bi.salon_id
     JOIN services s
       ON s.id = bi.service_id
      AND s.salon_id = bi.salon_id
     LEFT JOIN employee_profiles ep
       ON ep.id = ?
      AND ep.salon_id = bi.salon_id
     WHERE bi.salon_id = ?
       AND bi.id = ?
     LIMIT 1`,
    [employeeId, salonId, bookingItemId]
  );

  if (!context) {
    throw new AppError(
      404,
      'inventory:booking_item_not_found',
      'Booking item was not found'
    );
  }


  if (
    context.booking_deleted_at ||
    cleanText(context.booking_status).toLowerCase() === 'cancelled'
  ) {
    throw new AppError(
      409,
      'inventory:booking_not_consumable',
      'Inventory consumption is not allowed for this booking'
    );
  }

  const bookingDate = cleanText(context.booking_date);
  const today = salonTodayISO();
  if (bookingDate && bookingDate > today) {
    throw new AppError(
      409,
      'inventory:consumption_not_due',
      'Service consumption cannot be confirmed before the booking date'
    );
  }

  if (!context.employee_exists) {
    throw new AppError(
      404,
      'inventory:employee_not_found',
      'Employee was not found'
    );
  }

  if (cleanText(context.employee_status).toLowerCase() !== 'active') {
    throw new AppError(
      409,
      'inventory:employee_inactive',
      'Inventory consumption cannot be confirmed by an inactive employee'
    );
  }

  return context;
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
  const id = generatedId('invlvl');

  await dbRun(
    db,
    `INSERT INTO inventory_stock_levels
      (id, salon_id, item_id, location_id, qty_on_hand, updated_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(salon_id, item_id, location_id) DO NOTHING`,
    [id, salonId, itemId, locationId, now]
  );

  const level = await getStockLevelRow(db, salonId, itemId, locationId);

  if (!level) {
    throw new AppError(
      500,
      'inventory:stock_level_unavailable',
      'Inventory stock level could not be initialized'
    );
  }

  return level;
}
/**
 * Append a ledger movement and update the stock level read-model.
 * Never call from UI paths directly for arbitrary qty edits.
 */
async function appendMovement(db, salonId, input, actor = {}) {
  const now = nowIso();
  const who = actorFields(actor);
  const itemId = requiredId(input.itemId || input.item_id, 'itemId');
  const locationId = requiredId(
    input.locationId || input.location_id,
    'locationId'
  );
  const movementType = requiredText(
    input.movementType || input.movement_type,
    'movementType',
    64
  );
  const quantityDelta = Number(
    input.quantityDelta ?? input.quantity_delta
  );

  if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
    throw new AppError(
      400,
      'core_validation:invalid_quantity',
      'quantity_delta must be non-zero'
    );
  }

  const unit = requireUnit(input.unit);
  const sourceType = requiredText(
    input.sourceType || input.source_type,
    'sourceType',
    64
  );
  const sourceId = requiredText(
    input.sourceId || input.source_id,
    'sourceId',
    128
  );
  const lineKey =
    cleanText(input.lineKey || input.line_key || '0') || '0';

  const unitCostHalalas =
    input.unitCostHalalas != null
      ? integer(input.unitCostHalalas, 'unitCostHalalas', { min: 0 })
      : null;

  await ensureStockLevel(db, salonId, itemId, locationId, now);

  const movementId = generatedId('invmov');

  const results = await dbBatch(db, [
    {
      sql: `INSERT INTO inventory_stock_movements (
        id, salon_id, item_id, location_id, movement_type,
        quantity_delta, unit, unit_cost_halalas, balance_after,
        source_type, source_id, line_key, operation_id,
        employee_id, supplier_id, booking_id, booking_item_id, service_id,
        reverses_movement_id, note,
        created_by_uid, created_by_name, created_at
      )
      SELECT
        ?, ?, ?, ?, ?,
        ?, ?, ?, sl.qty_on_hand + ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?
      FROM inventory_stock_levels sl
      WHERE sl.salon_id = ?
        AND sl.item_id = ?
        AND sl.location_id = ?
        AND sl.qty_on_hand + ? >= 0`,
      params: [
        movementId,
        salonId,
        itemId,
        locationId,
        movementType,
        quantityDelta,
        unit,
        unitCostHalalas,
        quantityDelta,
        sourceType,
        sourceId,
        lineKey,
        optionalText(input.operationId || input.operation_id) || null,
        optionalText(input.employeeId || input.employee_id) || null,
        optionalText(input.supplierId || input.supplier_id) || null,
        optionalText(input.bookingId || input.booking_id) || null,
        optionalText(input.bookingItemId || input.booking_item_id) || null,
        optionalText(input.serviceId || input.service_id) || null,
        optionalText(
          input.reversesMovementId || input.reverses_movement_id
        ) || null,
        optionalText(input.note) || null,
        who.uid,
        who.name,
        now,
        salonId,
        itemId,
        locationId,
        quantityDelta,
      ],
    },
    {
      sql: `UPDATE inventory_stock_levels
              SET qty_on_hand = qty_on_hand + ?,
                  updated_at = ?
            WHERE salon_id = ?
              AND item_id = ?
              AND location_id = ?
              AND EXISTS (
                SELECT 1
                  FROM inventory_stock_movements
                 WHERE id = ?
                   AND salon_id = ?
              )`,
      params: [
        quantityDelta,
        now,
        salonId,
        itemId,
        locationId,
        movementId,
        salonId,
      ],
    },
  ]);

  const movementChanges = changes(results?.[0]);
  const levelChanges = changes(results?.[1]);

  if (movementChanges !== 1) {
    throw new AppError(
      409,
      'inventory:insufficient_stock',
      'Insufficient stock for this movement'
    );
  }

  if (levelChanges !== 1) {
    throw new AppError(
      500,
      'inventory:stock_level_update_failed',
      'Inventory movement was created but stock level was not updated'
    );
  }

  const movement = await dbFirst(
    db,
    `SELECT balance_after, created_at
       FROM inventory_stock_movements
      WHERE salon_id = ? AND id = ?
      LIMIT 1`,
    [salonId, movementId]
  );

  if (!movement) {
    throw new AppError(
      500,
      'inventory:movement_not_found_after_write',
      'Inventory movement could not be read after creation'
    );
  }

  return {
    movementId,
    balanceAfter: Number(movement.balance_after),
    createdAt: movement.created_at || now,
  };
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


async function getItemsByIds(db, salonId, itemIds) {
  const ids = [...new Set(itemIds.map((id) => requiredId(id)))];
  if (!ids.length) return [];

  const placeholders = ids.map(() => '?').join(', ');
  return dbAll(
    db,
    `SELECT * FROM inventory_items
      WHERE salon_id = ? AND id IN (${placeholders})`,
    [salonId, ...ids]
  );
}


async function getFifoCostForQuantity(db, salonId, itemId, quantity) {
  const inbounds = await dbAll(
    db,
    `SELECT id, quantity_delta, unit_cost_halalas, created_at
       FROM inventory_stock_movements
      WHERE salon_id = ?
        AND item_id = ?
        AND movement_type IN ('PURCHASE_RECEIPT_IN', 'OPENING_BALANCE_IN')
        AND quantity_delta > 0
      ORDER BY created_at ASC, id ASC`,
    [salonId, itemId]
  );
  const outbound = await dbFirst(
    db,
    `SELECT COALESCE(SUM(CASE WHEN quantity_delta < 0 THEN -quantity_delta ELSE 0 END), 0) AS consumed
       FROM inventory_stock_movements
      WHERE salon_id = ?
        AND item_id = ?
        AND movement_type NOT IN ('PURCHASE_RECEIPT_IN', 'OPENING_BALANCE_IN')`,
    [salonId, itemId]
  );
  let alreadyConsumed = Number(outbound?.consumed || 0);
  const layers = [];
  for (const row of inbounds) {
    let qty = Number(row.quantity_delta);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (alreadyConsumed >= qty) {
      alreadyConsumed -= qty;
      continue;
    }
    qty -= alreadyConsumed;
    alreadyConsumed = 0;
    const cost = Number(row.unit_cost_halalas);
    layers.push({
      qty,
      unitCost: Number.isInteger(cost) && cost >= 0 ? cost : 0,
    });
  }
  let left = Number(quantity);
  let total = 0;
  let used = 0;
  const lastCost = layers.length ? layers[layers.length - 1].unitCost : 0;
  for (const layer of layers) {
    if (left <= 0) break;
    const take = Math.min(left, layer.qty);
    total += Math.round(layer.unitCost * take);
    used += take;
    left -= take;
  }
  if (left > 0) {
    total += Math.round(lastCost * left);
    used += left;
  }
  return {
    unitCostHalalas: used > 0 ? Math.round(total / used) : null,
    lineCostHalalas: total,
  };
}

async function getTrustedUnitCostsByItemIds(db, salonId, itemIds) {
  const ids = [...new Set(itemIds.filter(Boolean))];

  if (!ids.length) {
    return new Map();
  }

  const placeholders = ids.map(() => '?').join(', ');

  const rows = await dbAll(
    db,
    `SELECT
       item_id,
       unit_cost_halalas,
       movement_type,
       created_at
     FROM inventory_stock_movements
     WHERE salon_id = ?
       AND item_id IN (${placeholders})
       AND unit_cost_halalas IS NOT NULL
       AND movement_type IN (
         'PURCHASE_RECEIPT_IN',
         'OPENING_BALANCE_IN'
       )
     ORDER BY
       item_id,
       CASE movement_type
         WHEN 'PURCHASE_RECEIPT_IN' THEN 0
         WHEN 'OPENING_BALANCE_IN' THEN 1
         ELSE 2
       END,
       created_at DESC,
       id DESC`,
    [salonId, ...ids]
  );

  const costsByItemId = new Map();

  for (const row of rows) {
    if (costsByItemId.has(row.item_id)) {
      continue;
    }

    const cost = Number(row.unit_cost_halalas);

    if (
      Number.isInteger(cost) &&
      cost >= 0
    ) {
      costsByItemId.set(row.item_id, cost);
    }
  }

  return costsByItemId;
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
  const where = ['m.salon_id = ?'];
  const params = [salonId];
  if (optionalText(query.itemId || query.item_id)) {
    where.push('m.item_id = ?');
    params.push(cleanText(query.itemId || query.item_id));
  }
  if (optionalText(query.bookingItemId || query.booking_item_id)) {
    where.push('m.booking_item_id = ?');
    params.push(cleanText(query.bookingItemId || query.booking_item_id));
  }
  if (optionalText(query.employeeId || query.employee_id)) {
    where.push('m.employee_id = ?');
    params.push(cleanText(query.employeeId || query.employee_id));
  }
  const limit = integer(query.limit ?? 100, 'limit', { min: 1, max: 500 });
  return dbAll(
    db,
    `SELECT m.*, s.name AS supplier_name
       FROM inventory_stock_movements m
       LEFT JOIN inventory_suppliers s
         ON s.salon_id = m.salon_id AND s.id = m.supplier_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.created_at DESC
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
  const bookingItemId = requiredId(
    preferred(data, 'bookingItemId', 'booking_item_id'),
    'bookingItemId'
  );
  const employeeId = requiredId(
    preferred(data, 'employeeId', 'employee_id'),
    'employeeId'
  );

  const consumptionContext = await validateServiceConsumptionContext(
    db,
    salonId,
    {
      bookingItemId,
      employeeId,
    }
  );

  const bookingId = consumptionContext.booking_id;
  const serviceId = consumptionContext.service_id;

  const requestedLocationId = optionalText(
    preferred(data, 'locationId', 'location_id')
  );

  const location = requestedLocationId
    ? await getLocation(db, salonId, requestedLocationId)
    : await ensureDefaultLocation(db, salonId);

  if (Number(location.active) !== 1) {
    throw new AppError(
      409,
      'inventory:location_inactive',
      'Inventory location is inactive'
    );
  }

  const locationId = location.id;

  const lines = Array.isArray(data.lines) ? data.lines : [];

  if (!lines.length) {
    throw new AppError(
      400,
      'core_validation:empty_consumption',
      'Consumption requires at least one line'
    );
  }

  const existing = await dbFirst(
    db,
    `SELECT id
       FROM service_consumptions
      WHERE salon_id = ?
        AND booking_item_id = ?
        AND status = 'confirmed'
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
    optionalText(preferred(data, 'operationId', 'operation_id')) ||
    generatedId('invop');

  const requestedItemIds = lines.map((line) =>
    requiredId(
      line.inventoryItemId || line.inventory_item_id,
      'inventoryItemId'
    )
  );

  const itemRows = await getItemsByIds(
    db,
    salonId,
    requestedItemIds
  );

  const itemsById = new Map(
    itemRows.map((item) => [item.id, item])
  );

  const trustedUnitCostsByItemId =
    await getTrustedUnitCostsByItemIds(
      db,
      salonId,
      requestedItemIds
    );

  let totalCost = 0;
  const prepared = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const itemId = requestedItemIds[i];
    const item = itemsById.get(itemId);

    if (!item) {
      throw new AppError(
        404,
        'inventory:item_not_found',
        `Inventory item ${itemId} was not found`
      );
    }

    if (Number(item.is_active) !== 1) {
      throw new AppError(
        409,
        'inventory:item_inactive',
        `Inventory item ${item.name} is inactive`
      );
    }

    if (item.consumption_policy !== 'SERVICE_TRACKED') {
      throw new AppError(
        409,
        'inventory:item_policy_mismatch',
        `Inventory item ${item.name} is not configured for service consumption`
      );
    }

    const qty = positiveQty(line.quantity, 'quantity');
    const unit = line.unit ? requireUnit(line.unit) : item.unit;

    if (unit !== item.unit) {
      throw new AppError(
        400,
        'core_validation:unit_mismatch',
        `Unit mismatch for item ${item.name}`
      );
    }

    const fifo = await getFifoCostForQuantity(db, salonId, itemId, qty);
    const unitCost = fifo.unitCostHalalas;
    const lineCost = fifo.lineCostHalalas;

    totalCost += lineCost;

    prepared.push({
      item,
      itemId,
      qty,
      unit,
      unitCost,
      lineCost,
      recipeLineId:
        optionalText(
          line.recipeLineId ||
            line.recipe_line_id
        ) || null,
      lineKey: String(i),
      movementId: generatedId('invmov'),
      consumptionLineId: generatedId('svcconsln'),
    });
  }

  // Recipe membership: actual item must match SPECIFIC_ITEM or belong to CATEGORY.
  const recipeLineIds = [
    ...new Set(
      prepared
        .map((line) => line.recipeLineId)
        .filter(Boolean)
    ),
  ];

  if (recipeLineIds.length) {
    const placeholders = recipeLineIds.map(() => '?').join(', ');
    const recipeLineRows = await dbAll(
      db,
      `SELECT id, line_type, inventory_item_id, category_id
         FROM service_consumption_recipe_lines
        WHERE salon_id = ?
          AND id IN (${placeholders})`,
      [salonId, ...recipeLineIds]
    );

    const recipeLinesById = new Map(
      recipeLineRows.map((row) => [row.id, row])
    );

    for (const line of prepared) {
      if (!line.recipeLineId) continue;

      const recipeLine = recipeLinesById.get(line.recipeLineId);
      if (!recipeLine) {
        throw new AppError(
          404,
          'inventory:recipe_line_not_found',
          `Recipe line ${line.recipeLineId} was not found`
        );
      }

      const lineType = cleanText(recipeLine.line_type).toUpperCase();

      if (lineType === 'SPECIFIC_ITEM') {
        if (
          cleanText(recipeLine.inventory_item_id) !==
          cleanText(line.itemId)
        ) {
          throw new AppError(
            409,
            'inventory:item_not_matching_recipe_line',
            `Item ${line.itemId} does not match recipe line ${line.recipeLineId}`
          );
        }
      } else if (lineType === 'CATEGORY') {
        if (
          cleanText(line.item.category_id) !==
          cleanText(recipeLine.category_id)
        ) {
          throw new AppError(
            409,
            'inventory:item_not_in_recipe_category',
            `Item ${line.itemId} is not in recipe category ${recipeLine.category_id}`
          );
        }
      } else {
        throw new AppError(
          400,
          'inventory:invalid_recipe_line_type',
          `Unsupported recipe line type: ${lineType}`
        );
      }
    }
  }

  const uniqueItemIds = [
    ...new Set(prepared.map((line) => line.itemId)),
  ];


  const requirementSelects = prepared
    .map(() => 'SELECT ? AS item_id, ? AS required_qty')
    .join(' UNION ALL ');

  const requirementParams = prepared.flatMap((line) => [
    line.itemId,
    line.qty,
  ]);

  const statements = [];

  // Initialize every stock-level row inside the same transaction.
  // ON CONFLICT makes this safe when the read model already exists.
  for (const itemId of uniqueItemIds) {
    statements.push({
      sql: `INSERT INTO inventory_stock_levels (
        id,
        salon_id,
        item_id,
        location_id,
        qty_on_hand,
        updated_at
      )
      VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(salon_id, item_id, location_id)
      DO NOTHING`,
      params: [
        generatedId('invlvl'),
        salonId,
        itemId,
        locationId,
        now,
      ],
    });
  }

  const ensureStatementCount = statements.length;

  /*
   * Transactional stock guard.
   *
   * Requirements are aggregated by inventory item so duplicate lines
   * cannot independently pass against the same starting balance.
   *
   * If any requested total exceeds stock, status becomes NULL.
   * service_consumptions.status is NOT NULL, so SQLite aborts this
   * statement and D1 rolls back the entire batch.
   */
  statements.push({
    sql: `INSERT INTO service_consumptions (
      id,
      salon_id,
      booking_id,
      booking_item_id,
      service_id,
      employee_id,
      location_id,
      status,
      total_material_cost_halalas,
      operation_id,
      confirmed_at,
      confirmed_by_uid,
      confirmed_by_name,
      created_at
    )
    SELECT
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM (
            SELECT
              requested.item_id,
              SUM(requested.required_qty) AS required_qty
            FROM (
              ${requirementSelects}
            ) requested
            GROUP BY requested.item_id
          ) required
          LEFT JOIN inventory_stock_levels sl
            ON sl.salon_id = ?
           AND sl.item_id = required.item_id
           AND sl.location_id = ?
          WHERE COALESCE(sl.qty_on_hand, 0) + 0.000000001
                < required.required_qty
        )
        THEN 'confirmed'
        ELSE NULL
      END,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?`,
    params: [
      consumptionId,
      salonId,
      bookingId,
      bookingItemId,
      serviceId,
      employeeId,
      locationId,
      ...requirementParams,
      salonId,
      locationId,
      totalCost,
      operationId,
      now,
      who.uid,
      who.name,
      now,
    ],
  });

  const headerStatementIndex = statements.length - 1;

  for (const line of prepared) {
    statements.push({
      sql: `INSERT INTO inventory_stock_movements (
        id,
        salon_id,
        item_id,
        location_id,
        movement_type,
        quantity_delta,
        unit,
        unit_cost_halalas,
        balance_after,
        source_type,
        source_id,
        line_key,
        operation_id,
        employee_id,
        booking_id,
        booking_item_id,
        service_id,
        reverses_movement_id,
        note,
        created_by_uid,
        created_by_name,
        created_at
      )
      SELECT
        ?,
        ?,
        ?,
        ?,
        'SERVICE_CONSUMPTION_OUT',
        ?,
        ?,
        ?,
        sl.qty_on_hand - ?,
        'service_consumption',
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        NULL,
        ?,
        ?,
        ?,
        ?
      FROM inventory_stock_levels sl
      WHERE sl.salon_id = ?
        AND sl.item_id = ?
        AND sl.location_id = ?`,
      params: [
        line.movementId,
        salonId,
        line.itemId,
        locationId,
        -line.qty,
        line.unit,
        line.unitCost,
        line.qty,
        consumptionId,
        line.lineKey,
        operationId,
        employeeId,
        bookingId,
        bookingItemId,
        serviceId,
        `Service consumption ${serviceId}`,
        who.uid,
        who.name,
        now,
        salonId,
        line.itemId,
        locationId,
      ],
    });

    statements.push({
      sql: `UPDATE inventory_stock_levels
               SET qty_on_hand = qty_on_hand - ?,
                   updated_at = ?
             WHERE salon_id = ?
               AND item_id = ?
               AND location_id = ?`,
      params: [
        line.qty,
        now,
        salonId,
        line.itemId,
        locationId,
      ],
    });

    statements.push({
      sql: `INSERT INTO service_consumption_lines (
        id,
        salon_id,
        consumption_id,
        recipe_line_id,
        inventory_item_id,
        quantity,
        unit,
        unit_cost_halalas,
        line_cost_halalas,
        stock_movement_id,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        line.consumptionLineId,
        salonId,
        consumptionId,
        line.recipeLineId,
        line.itemId,
        line.qty,
        line.unit,
        line.unitCost,
        line.lineCost,
        line.movementId,
        now,
      ],
    });
  }

  let results;

  try {
    results = await dbBatch(db, statements);
  } catch (error) {
    const message = String(
      error?.message ||
      error ||
      ''
    );

    if (
      message.includes('service_consumptions.status') &&
      message.toLowerCase().includes('not null')
    ) {
      throw new AppError(
        409,
        'inventory:insufficient_stock',
        'Insufficient stock for this service consumption'
      );
    }

    if (
      message.includes('service_consumptions') &&
      message.toLowerCase().includes('unique')
    ) {
      throw new AppError(
        409,
        'inventory:consumption_already_confirmed',
        'Service consumption already confirmed for this booking item'
      );
    }

    throw error;
  }

  if (changes(results?.[headerStatementIndex]) !== 1) {
    throw new AppError(
      500,
      'inventory:consumption_write_failed',
      'Service consumption was not created'
    );
  }

  const firstLineStatementIndex =
    ensureStatementCount + 1;

  for (let i = 0; i < prepared.length; i += 1) {
    const baseIndex =
      firstLineStatementIndex + i * 3;

    if (
      changes(results?.[baseIndex]) !== 1 ||
      changes(results?.[baseIndex + 1]) !== 1 ||
      changes(results?.[baseIndex + 2]) !== 1
    ) {
      throw new AppError(
        500,
        'inventory:consumption_write_incomplete',
        'Service consumption transaction returned an incomplete write result'
      );
    }
  }

  return {
    consumptionId,
    operationId,
    totalMaterialCostHalalas: totalCost,
    movementIds: prepared.map(
      (line) => line.movementId
    ),
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

/**
 * Pending / same-day consumption worklist (booking-item grain).
 * Lifecycle is a computed read-model from booking date/time + consumption row.
 * Online + internal/walk-in share booking_items — same confirm path.
 *
 * Query:
 *  - date: optional exact-day filter (legacy) OR as-of day when scope=worklist
 *  - scope=worklist | includeUpcoming/includeOverdue: mandatory same-day workflow window
 *  - employeeId: employee owns executed item (bi.staff_id OR b.staff_id)
 */
export async function listPendingServiceConsumptions(db, salonId, query = {}) {
  const today = salonTodayISO();
  const asOf =
    optionalText(query.date || query.bookingDate || query.booking_date) || today;
  const employeeId = optionalText(
    preferred(query, 'employeeId', 'employee_id')
  );
  const limit = integer(query.limit ?? 100, 'limit', { min: 1, max: 300 });
  const scope = cleanText(query.scope).toLowerCase();
  const worklist = scope === 'worklist';
  const includeUpcoming =
    worklist || queryFlag(query.includeUpcoming || query.include_upcoming);
  const includeOverdue =
    worklist || queryFlag(query.includeOverdue || query.include_overdue);
  const upcomingExplicit = optionalText(query.includeUpcoming || query.include_upcoming);
  const overdueExplicit = optionalText(query.includeOverdue || query.include_overdue);
  const wantUpcoming = upcomingExplicit !== undefined ? queryFlag(upcomingExplicit) : includeUpcoming;
  const wantOverdue = overdueExplicit !== undefined ? queryFlag(overdueExplicit) : includeOverdue;
  const expanded = worklist || wantUpcoming || wantOverdue;
  const upcomingDays = integer(
    query.upcomingDays ?? query.upcoming_days ?? 7,
    'upcomingDays',
    { min: 0, max: 30 }
  );
  const overdueDays = integer(
    query.overdueDays ?? query.overdue_days ?? 30,
    'overdueDays',
    { min: 1, max: 90 }
  );
  const lifecycleFilter = cleanText(
    preferred(query, 'lifecycle', 'lifecycleStatus')
  ).toUpperCase();

  const where = [
    'bi.salon_id = ?',
    "LOWER(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled', 'rejected')",
    'b.deleted_at IS NULL',
    'r.id IS NOT NULL',
    'sc.id IS NULL',
  ];
  const params = [salonId];

  if (expanded) {
    const dateClauses = ['COALESCE(bi.booking_date, b.booking_date) = ?'];
    params.push(asOf);
    if (wantUpcoming && upcomingDays > 0) {
      const upcomingUntil = shiftISODate(asOf, upcomingDays);
      dateClauses.push(
        `(COALESCE(bi.booking_date, b.booking_date) > ? AND COALESCE(bi.booking_date, b.booking_date) <= ?)`
      );
      params.push(asOf, upcomingUntil);
    }
    if (wantOverdue) {
      const overdueFrom = shiftISODate(asOf, -overdueDays);
      dateClauses.push(
        `(COALESCE(bi.booking_date, b.booking_date) < ? AND COALESCE(bi.booking_date, b.booking_date) >= ?)`
      );
      params.push(asOf, overdueFrom);
    }
    where.push(`(${dateClauses.join(' OR ')})`);
  } else {
    where.push('COALESCE(bi.booking_date, b.booking_date) = ?');
    params.push(asOf);
  }

  if (employeeId) {
    where.push('(bi.staff_id = ? OR b.staff_id = ?)');
    params.push(employeeId, employeeId);
  }

  const rows = await dbAll(
    db,
    `SELECT
       bi.id AS booking_item_id,
       bi.booking_id,
       bi.service_id,
       bi.service_name_snapshot,
       bi.staff_id AS item_staff_id,
       bi.duration_minutes,
       b.staff_id AS booking_staff_id,
       b.client_id,
       b.status AS booking_status,
       b.source AS booking_source,
       COALESCE(bi.booking_date, b.booking_date) AS booking_date,
       COALESCE(bi.start_time, b.start_time) AS start_time,
       COALESCE(bi.end_time, b.end_time) AS end_time,
       COALESCE(c.name, '') AS client_name,
       r.id AS recipe_id
     FROM booking_items bi
     JOIN bookings b
       ON b.id = bi.booking_id
      AND b.salon_id = bi.salon_id
     LEFT JOIN clients c
       ON c.id = b.client_id
      AND c.salon_id = b.salon_id
     JOIN service_consumption_recipes r
       ON r.salon_id = bi.salon_id
      AND r.service_id = bi.service_id
      AND r.is_active = 1
     LEFT JOIN service_consumptions sc
       ON sc.salon_id = bi.salon_id
      AND sc.booking_item_id = bi.id
      AND sc.status = 'confirmed'
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(bi.booking_date, b.booking_date),
              COALESCE(bi.start_time, b.start_time),
              bi.created_at,
              bi.id
     LIMIT ${limit}`,
    params
  );

  const nowHHMM = salonNowHHMM();
  const enriched = (rows || []).map((row) => {
    const lifecycle = deriveServiceConsumptionLifecycle(row, {
      today: asOf,
      nowHHMM,
    });
    const end = effectiveEndTime(row);
    let delayMinutes = null;
    if (lifecycle === 'OVERDUE' && row.booking_date && end) {
      // Approximate delay from scheduled end on booking date (same-day clock compare).
      if (row.booking_date < asOf) {
        delayMinutes = null; // multi-day overdue — UI shows booking_date
      } else if (nowHHMM > end) {
        const [nh, nm] = nowHHMM.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        delayMinutes = nh * 60 + nm - (eh * 60 + em);
      }
    }
    return {
      ...row,
      lifecycle,
      can_confirm: lifecycle !== 'UPCOMING' && lifecycle !== 'CONFIRMED',
      effective_end_time: end || null,
      delay_minutes: delayMinutes,
    };
  });

  if (lifecycleFilter && CONSUMPTION_LIFECYCLES.has(lifecycleFilter)) {
    return enriched.filter((row) => row.lifecycle === lifecycleFilter);
  }
  return enriched;
}


export async function issueToEmployee(db, salonId, data, actor = {}) {
  const itemId = requiredId(preferred(data, 'itemId', 'item_id'), 'itemId');
  const employeeId = requiredId(preferred(data, 'employeeId', 'employee_id'), 'employeeId');
  const quantity = Number(preferred(data, 'quantity', 'qty'));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', 'Issue quantity must be greater than zero');
  }
  const item = await getItem(db, salonId, itemId);
  if (!item || Number(item.is_active) !== 1) {
    throw new AppError(404, 'inventory:item_not_found', 'Inventory item was not found');
  }
  if (cleanText(item.consumption_policy) !== 'EMPLOYEE_ISSUED') {
    throw new AppError(409, 'inventory:item_policy_mismatch', 'Only EMPLOYEE_ISSUED items can be issued to staff');
  }
  const employee = await dbFirst(
    db,
    'SELECT id, status FROM employee_profiles WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, employeeId]
  );
  if (!employee) {
    throw new AppError(404, 'inventory:employee_not_found', 'Employee was not found');
  }
  if (cleanText(employee.status).toLowerCase() !== 'active') {
    throw new AppError(409, 'inventory:employee_inactive', 'Cannot issue stock to an inactive employee');
  }
  const location = await ensureDefaultLocation(db, salonId);
  const operationId = optionalText(preferred(data, 'operationId', 'operation_id')) || generatedId('invop');
  return appendMovement(db, salonId, {
    itemId,
    locationId: location.id,
    movementType: 'EMPLOYEE_ISSUE_OUT',
    quantityDelta: -quantity,
    unit: item.unit,
    sourceType: 'EMPLOYEE_ISSUE',
    sourceId: operationId,
    lineKey: itemId,
    operationId,
    employeeId,
    note: optionalText(data.note) || 'Issued to employee',
  }, actor);
}

export async function returnFromEmployee(db, salonId, data, actor = {}) {
  const itemId = requiredId(preferred(data, 'itemId', 'item_id'), 'itemId');
  const employeeId = requiredId(preferred(data, 'employeeId', 'employee_id'), 'employeeId');
  const quantity = Number(preferred(data, 'quantity', 'qty'));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', 'Return quantity must be greater than zero');
  }
  const item = await getItem(db, salonId, itemId);
  if (!item || Number(item.is_active) !== 1) {
    throw new AppError(404, 'inventory:item_not_found', 'Inventory item was not found');
  }
  const employee = await dbFirst(
    db,
    'SELECT id, status FROM employee_profiles WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, employeeId]
  );
  if (!employee) {
    throw new AppError(404, 'inventory:employee_not_found', 'Employee was not found');
  }
  const location = await ensureDefaultLocation(db, salonId);
  const operationId = optionalText(preferred(data, 'operationId', 'operation_id')) || generatedId('invop');
  return appendMovement(db, salonId, {
    itemId,
    locationId: location.id,
    movementType: 'EMPLOYEE_RETURN_IN',
    quantityDelta: quantity,
    unit: item.unit,
    sourceType: 'EMPLOYEE_RETURN',
    sourceId: operationId,
    lineKey: itemId,
    operationId,
    employeeId,
    note: optionalText(data.note) || 'Returned from employee',
  }, actor);
}


export async function recordWaste(db, salonId, data, actor = {}) { // FIFO cost on waste/sale
  const itemId = requiredId(preferred(data, 'itemId', 'item_id'), 'itemId');
  const quantity = Number(preferred(data, 'quantity', 'qty'));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', 'Waste quantity must be greater than zero');
  }
  const item = await getItem(db, salonId, itemId);
  if (!item || Number(item.is_active) !== 1) {
    throw new AppError(404, 'inventory:item_not_found', 'Inventory item was not found');
  }
  const location = await ensureDefaultLocation(db, salonId);
  const fifo = await getFifoCostForQuantity(db, salonId, itemId, quantity);
  const operationId = optionalText(preferred(data, 'operationId', 'operation_id')) || generatedId('invop');
  return appendMovement(db, salonId, {
    itemId,
    locationId: location.id,
    movementType: 'WASTE_OUT',
    quantityDelta: -quantity,
    unitCostHalalas: fifo.unitCostHalalas,
    unit: item.unit,
    sourceType: 'WASTE',
    sourceId: operationId,
    lineKey: itemId,
    operationId,
    note: optionalText(data.note) || 'Waste recorded',
  }, actor);
}

export async function adjustAfterStocktake(db, salonId, data, actor = {}) {
  const itemId = requiredId(preferred(data, 'itemId', 'item_id'), 'itemId');
  const counted = Number(preferred(data, 'countedQty', 'counted_qty'));
  if (!Number.isFinite(counted) || counted < 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', 'Counted quantity must be zero or more');
  }
  const item = await getItem(db, salonId, itemId);
  if (!item || Number(item.is_active) !== 1) {
    throw new AppError(404, 'inventory:item_not_found', 'Inventory item was not found');
  }
  const location = await ensureDefaultLocation(db, salonId);
  const level = await getStockLevelRow(db, salonId, itemId, location.id);
  const current = Number(level?.qty_on_hand || 0);
  const delta = counted - current;
  if (delta === 0) {
    throw new AppError(409, 'inventory:stocktake_no_variance', 'Counted quantity matches on-hand stock');
  }
  const operationId = optionalText(preferred(data, 'operationId', 'operation_id')) || generatedId('invop');
  return appendMovement(db, salonId, {
    itemId,
    locationId: location.id,
    movementType: 'STOCKTAKE_VARIANCE',
    quantityDelta: delta,
    unit: item.unit,
    sourceType: 'STOCKTAKE',
    sourceId: operationId,
    lineKey: itemId,
    operationId,
    note: optionalText(data.note) || 'Stocktake variance',
  }, actor);
}


export async function receivePurchase(db, salonId, data, actor = {}) {
  const itemId = requiredId(preferred(data, 'itemId', 'item_id'), 'itemId');
  const quantity = Number(preferred(data, 'quantity', 'qty'));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', 'Purchase quantity must be greater than zero');
  }
  const item = await getItem(db, salonId, itemId);
  if (!item || Number(item.is_active) !== 1) {
    throw new AppError(404, 'inventory:item_not_found', 'Inventory item was not found');
  }
  const unitCostHalalas = data.unitCostHalalas != null || data.unit_cost_halalas != null
    ? integer(preferred(data, 'unitCostHalalas', 'unit_cost_halalas'), 'unitCostHalalas', { min: 0 })
    : null;
  const supplierId = optionalText(preferred(data, 'supplierId', 'supplier_id')) || null;
  if (supplierId) {
    const supplier = await dbFirst(
      db,
      `SELECT id FROM inventory_suppliers WHERE salon_id = ? AND id = ? LIMIT 1`,
      [salonId, supplierId]
    );
    if (!supplier) {
      throw new AppError(404, 'inventory:supplier_not_found', 'Supplier was not found');
    }
  }
  const location = await ensureDefaultLocation(db, salonId);
  const operationId = optionalText(preferred(data, 'operationId', 'operation_id')) || generatedId('invop');
  const baseNote = optionalText(data.note) || 'Purchase receipt';
  const note = supplierId
    ? (baseNote.includes('supplierId=') ? baseNote : (baseNote + ' | supplierId=' + supplierId))
    : baseNote;
  return appendMovement(db, salonId, {
    itemId,
    locationId: location.id,
    movementType: 'PURCHASE_RECEIPT_IN',
    quantityDelta: quantity,
    unit: item.unit,
    unitCostHalalas,
    sourceType: 'PURCHASE',
    sourceId: operationId,
    lineKey: itemId,
    operationId,
    supplierId,
    note,
  }, actor);
}

export async function sellProduct(db, salonId, data, actor = {}) {
  const itemId = requiredId(preferred(data, 'itemId', 'item_id'), 'itemId');
  const quantity = Number(preferred(data, 'quantity', 'qty'));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', 'Sale quantity must be greater than zero');
  }
  const item = await getItem(db, salonId, itemId);
  if (!item || Number(item.is_active) !== 1) {
    throw new AppError(404, 'inventory:item_not_found', 'Inventory item was not found');
  }
  if (cleanText(item.consumption_policy) !== 'DIRECT_SALE') {
    throw new AppError(409, 'inventory:item_policy_mismatch', 'Only DIRECT_SALE items can be sold from inventory');
  }
  const location = await ensureDefaultLocation(db, salonId);
  const fifo = await getFifoCostForQuantity(db, salonId, itemId, quantity);
  const operationId = optionalText(preferred(data, 'operationId', 'operation_id')) || generatedId('invop');
  return appendMovement(db, salonId, {
    itemId,
    locationId: location.id,
    movementType: 'DIRECT_SALE_OUT',
    quantityDelta: -quantity,
    unitCostHalalas: fifo.unitCostHalalas,
    unit: item.unit,
    sourceType: 'DIRECT_SALE',
    sourceId: operationId,
    lineKey: itemId,
    operationId,
    note: optionalText(data.note) || 'Direct sale',
  }, actor);
}

export async function returnProduct(db, salonId, data, actor = {}) {
  const itemId = requiredId(preferred(data, 'itemId', 'item_id'), 'itemId');
  const quantity = Number(preferred(data, 'quantity', 'qty'));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', 'Return quantity must be greater than zero');
  }
  const item = await getItem(db, salonId, itemId);
  if (!item || Number(item.is_active) !== 1) {
    throw new AppError(404, 'inventory:item_not_found', 'Inventory item was not found');
  }
  const location = await ensureDefaultLocation(db, salonId);
  const operationId = optionalText(preferred(data, 'operationId', 'operation_id')) || generatedId('invop');
  return appendMovement(db, salonId, {
    itemId,
    locationId: location.id,
    movementType: 'DIRECT_SALE_RETURN_IN',
    quantityDelta: quantity,
    unit: item.unit,
    sourceType: 'DIRECT_SALE_RETURN',
    sourceId: operationId,
    lineKey: itemId,
    operationId,
    note: optionalText(data.note) || 'Direct sale return',
  }, actor);
}


export async function listSuppliers(db, salonId) {
  return dbAll(
    db,
    `SELECT * FROM inventory_suppliers
      WHERE salon_id = ?
      ORDER BY name ASC
      LIMIT 200`,
    [salonId]
  );
}

export async function createSupplier(db, salonId, data, actor = {}) {
  const now = nowIso();
  const id = generatedId("invsup");
  await dbRun(
    db,
    `INSERT INTO inventory_suppliers
      (id, salon_id, name, phone, notes, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      salonId,
      requiredText(data.name, "name", 200),
      optionalText(data.phone) || null,
      optionalText(data.notes) || null,
      now,
      now,
    ]
  );
  return { id, name: data.name };
}


export async function listPurchaseOrders(db, salonId) {
  return dbAll(
    db,
    `SELECT * FROM inventory_purchase_orders
      WHERE salon_id = ?
      ORDER BY created_at DESC
      LIMIT 200`,
    [salonId]
  );
}

export async function createPurchaseOrder(db, salonId, data, actor = {}) {
  const now = nowIso();
  const id = generatedId('invpo');
  const supplierId = optionalText(preferred(data, 'supplierId', 'supplier_id'));
  await dbRun(
    db,
    `INSERT INTO inventory_purchase_orders
      (id, salon_id, supplier_id, status, note, created_at, updated_at)
     VALUES (?, ?, ?, 'DRAFT', ?, ?, ?)`,
    [id, salonId, supplierId || null, optionalText(data.note) || null, now, now]
  );
  return dbFirst(db, `SELECT * FROM inventory_purchase_orders WHERE id = ? AND salon_id = ?`, [id, salonId]);
}

export async function addPurchaseOrderLine(db, salonId, data, actor = {}) {
  const poId = requiredId(preferred(data, 'purchaseOrderId', 'purchase_order_id'), 'purchaseOrderId');
  const itemId = requiredId(preferred(data, 'itemId', 'item_id'), 'itemId');
  const qty = Number(preferred(data, 'qtyOrdered', 'qty_ordered'));
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', 'Ordered quantity must be greater than zero');
  }
  const po = await dbFirst(db, `SELECT * FROM inventory_purchase_orders WHERE salon_id = ? AND id = ?`, [salonId, poId]);
  if (!po) throw new AppError(404, 'inventory:po_not_found', 'Purchase order was not found');
  if (String(po.status) === 'CANCELLED') {
    throw new AppError(409, 'inventory:po_cancelled', 'Cannot add lines to a cancelled purchase order');
  }
  const item = await getItem(db, salonId, itemId);
  if (!item) throw new AppError(404, 'inventory:item_not_found', 'Inventory item was not found');
  const now = nowIso();
  const id = generatedId('invpol');
  const unitCost = data.unitCostHalalas != null || data.unit_cost_halalas != null
    ? integer(preferred(data, 'unitCostHalalas', 'unit_cost_halalas'), 'unitCostHalalas', { min: 0 })
    : null;
  await dbRun(
    db,
    `INSERT INTO inventory_purchase_order_lines
      (id, salon_id, purchase_order_id, item_id, qty_ordered, qty_received, unit_cost_halalas, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [id, salonId, poId, itemId, qty, unitCost, now, now]
  );
  await dbRun(db, `UPDATE inventory_purchase_orders SET status = CASE WHEN status = 'DRAFT' THEN 'ORDERED' ELSE status END, updated_at = ? WHERE id = ? AND salon_id = ?`, [now, poId, salonId]);
  return dbFirst(db, `SELECT * FROM inventory_purchase_order_lines WHERE id = ?`, [id]);
}

export async function receivePurchaseOrderLine(db, salonId, data, actor = {}) {
  const lineId = requiredId(preferred(data, 'lineId', 'line_id'), 'lineId');
  const qty = Number(preferred(data, 'quantity', 'qty'));
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', 'Receive quantity must be greater than zero');
  }
  const line = await dbFirst(db, `SELECT * FROM inventory_purchase_order_lines WHERE salon_id = ? AND id = ?`, [salonId, lineId]);
  if (!line) throw new AppError(404, 'inventory:po_line_not_found', 'Purchase order line was not found');
  const remaining = Number(line.qty_ordered) - Number(line.qty_received || 0);
  if (qty > remaining + 1e-9) {
    throw new AppError(409, 'inventory:po_over_receive', 'Cannot receive more than ordered quantity');
  }
  const po = await dbFirst(
    db,
    'SELECT supplier_id FROM inventory_purchase_orders WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, line.purchase_order_id]
  );
  const movement = await receivePurchase(db, salonId, {
    itemId: line.item_id,
    quantity: qty,
    unitCostHalalas: line.unit_cost_halalas,
    supplierId: po?.supplier_id || null,
    operationId: preferred(data, 'operationId', 'operation_id') || generatedId('invop'),
    note: `PO ${line.purchase_order_id}`,
  }, actor);
  const now = nowIso();
  const received = Number(line.qty_received || 0) + qty;
  await dbRun(
    db,
    `UPDATE inventory_purchase_order_lines SET qty_received = ?, updated_at = ? WHERE id = ? AND salon_id = ?`,
    [received, now, lineId, salonId]
  );
  const open = await dbFirst(
    db,
    `SELECT COUNT(*) AS open_lines FROM inventory_purchase_order_lines
      WHERE salon_id = ? AND purchase_order_id = ? AND qty_received < qty_ordered`,
    [salonId, line.purchase_order_id]
  );
  await dbRun(
    db,
    `UPDATE inventory_purchase_orders SET status = ?, updated_at = ? WHERE id = ? AND salon_id = ?`,
    [Number(open?.open_lines || 0) > 0 ? 'PARTIAL' : 'RECEIVED', now, line.purchase_order_id, salonId]
  );
  return { lineId, received, movement };
}
