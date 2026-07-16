// CORE D1 ONLY — discount verification for booking creation.

import { AppError } from '../errors.js';
import { cleanText, dbFirst, integer, nowIso, optionalText, requiredId } from '../d1.js';

function normalizeCode(value) {
  return cleanText(value).toUpperCase();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(cleanText(value) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseSnapshot(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(cleanText(value));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function dateOnly(value) {
  const raw = cleanText(value);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match?.[1] || '';
}

function assertDiscountActive(row, now = new Date()) {
  if (!row) throw new AppError(404, 'core_discount:not_found');
  if (row.deleted_at) throw new AppError(409, 'core_discount:deleted');
  if (Number(row.active) !== 1) throw new AppError(409, 'core_discount:inactive');
  const today = dateOnly(now.toISOString());
  const startsAt = dateOnly(row.starts_at);
  const endsAt = dateOnly(row.ends_at);
  if (startsAt && today < startsAt) throw new AppError(409, 'core_discount:not_started');
  if (endsAt && today > endsAt) throw new AppError(409, 'core_discount:expired');
  if (row.usage_limit !== null && row.usage_limit !== undefined && Number(row.used_count || 0) >= Number(row.usage_limit)) {
    throw new AppError(409, 'core_discount:usage_limit_reached');
  }
}

async function findDiscountForRequest(db, salonId, request) {
  const sourceId = optionalText(request.sourceId || request.source_id);
  const code = normalizeCode(request.code);
  if (sourceId) {
    const byId = await dbFirst(db, 'SELECT * FROM discounts WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, requiredId(sourceId)]);
    if (byId) return byId;
  }
  if (code) {
    return dbFirst(db, 'SELECT * FROM discounts WHERE salon_id = ? AND code_key = ? AND deleted_at IS NULL LIMIT 1', [salonId, code]);
  }
  return null;
}

function itemIsEligible(row, discountRow) {
  if (!discountRow) return true;
  const appliesTo = cleanText(discountRow.applies_to || 'all').toLowerCase();
  const serviceIds = parseJsonArray(discountRow.service_ids_json).map(cleanText).filter(Boolean);
  const categoryIds = parseJsonArray(discountRow.category_ids_json).map(cleanText).filter(Boolean);
  if (appliesTo === 'services' || serviceIds.length) return serviceIds.includes(cleanText(row.service_id));
  if (appliesTo === 'categories' || categoryIds.length) return categoryIds.includes(cleanText(row.category_id));
  return true;
}

function allocateDiscount(rows, discountHalalas) {
  const eligibleSubtotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.total_halalas || 0)), 0);
  let allocated = 0;
  return rows.map((row, index) => {
    const original = Math.max(0, Number(row.total_halalas || 0));
    const isLast = index === rows.length - 1;
    const discount = isLast
      ? Math.max(0, discountHalalas - allocated)
      : Math.floor((discountHalalas * original) / Math.max(1, eligibleSubtotal));
    if (!isLast) allocated += discount;
    return {
      serviceId: cleanText(row.service_id),
      bookingItemId: cleanText(row.cart_item_id || row.id) || `item_${index}`,
      originalAmountHalalas: original,
      discountAmountHalalas: Math.min(original, discount),
      finalAmountHalalas: Math.max(0, original - Math.min(original, discount)),
    };
  });
}

async function assertPerClientLimit(db, salonId, clientId, row, request) {
  const limit = Number(row?.per_client_limit || 0);
  if (!limit || limit < 1) return;
  const sourceId = cleanText(row.id || request.sourceId || '');
  const code = normalizeCode(row.code_key || row.code || request.code);
  const needle = sourceId || code;
  if (!needle) return;
  const result = await dbFirst(
    db,
    "SELECT COUNT(*) AS count FROM bookings WHERE salon_id = ? AND client_id = ? AND COALESCE(discount_snapshot_json, '') LIKE ?",
    [salonId, clientId, `%${needle}%`]
  ).catch(() => ({ count: 0 }));
  if (Number(result?.count || 0) >= limit) {
    throw new AppError(409, 'core_discount:per_client_limit_reached');
  }
}

export async function resolveBookingDiscount(db, salonId, clientId, bookingSource, rows, data, actor = {}) {
  const request = parseSnapshot(data.discountSnapshot || data.discount_snapshot || data.discount_snapshot_json);
  const subtotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.total_halalas || 0)), 0);
  if (!request || cleanText(request.source || 'none') === 'none') {
    return {
      subtotalHalalas: subtotal,
      discountHalalas: 0,
      totalHalalas: subtotal,
      discountSnapshotJson: null,
      allocationsByCartItem: new Map(),
      auditActions: [],
    };
  }

  const source = cleanText(request.source).toLowerCase();
  let discountRow = null;
  let type = cleanText(request.type).toLowerCase();
  let rawValue = Number(request.value ?? request.percentage ?? 0);
  let title = optionalText(request.title) || null;
  let code = normalizeCode(request.code) || null;
  let sourceId = optionalText(request.sourceId || request.source_id) || null;

  if (source === 'offer' || source === 'coupon') {
    discountRow = await findDiscountForRequest(db, salonId, request);
    assertDiscountActive(discountRow);
    await assertPerClientLimit(db, salonId, clientId, discountRow, request);
    type = cleanText(discountRow.type).toLowerCase();
    rawValue = Number(discountRow.value || 0);
    title = discountRow.name || title;
    code = normalizeCode(discountRow.code_key || discountRow.code || code) || null;
    sourceId = discountRow.id;
  } else if (source === 'manual') {
    if (!['internal', 'dashboard'].includes(cleanText(bookingSource).toLowerCase())) {
      throw new AppError(403, 'core_discount:manual_not_allowed');
    }
  } else {
    throw new AppError(400, 'core_discount:invalid_source');
  }

  if (!['fixed', 'percent'].includes(type)) throw new AppError(400, 'core_discount:invalid_type');
  if (!Number.isFinite(rawValue) || rawValue <= 0) throw new AppError(400, 'core_discount:invalid_value');
  if (type === 'percent' && rawValue > 100) throw new AppError(400, 'core_discount:percent_over_100');

  const eligibleRows = rows.filter((row) => itemIsEligible(row, discountRow));
  const eligibleSubtotal = eligibleRows.reduce((sum, row) => sum + Math.max(0, Number(row.total_halalas || 0)), 0);
  if (eligibleSubtotal <= 0) throw new AppError(409, 'core_discount:no_eligible_services');

  const minOrder = integer(
    discountRow?.min_order_halalas,
    'minOrderHalalas',
    { min: 0, max: 100_000_000, fallback: 0 }
  );
  if (minOrder > 0 && eligibleSubtotal < minOrder) {
    throw new AppError(409, 'core_discount:minimum_not_met');
  }

  const requestedDiscount =
    type === 'percent'
      ? Math.floor((eligibleSubtotal * rawValue) / 100)
      : integer(Math.round(rawValue * 100), 'discountValue', { min: 0, max: 100_000_000 });
  const maxDiscountSource =
    source === 'manual'
      ? request.maxDiscountHalalas
      : discountRow?.max_discount_halalas;
  const maxDiscount = integer(
    maxDiscountSource,
    'maxDiscountHalalas',
    { min: 0, max: 100_000_000, fallback: 0 }
  );
  const discountHalalas = Math.max(
    0,
    Math.min(eligibleSubtotal, maxDiscount > 0 ? Math.min(requestedDiscount, maxDiscount) : requestedDiscount)
  );
  if (discountHalalas <= 0) throw new AppError(409, 'core_discount:zero');

  const eligibleAllocations = allocateDiscount(eligibleRows, discountHalalas);
  const allocationByCartItem = new Map(
    eligibleAllocations.map((row) => [cleanText(row.bookingItemId), row])
  );
  const fullAllocations = rows.map((row, index) => {
    const key = cleanText(row.cart_item_id || row.id) || `item_${index}`;
    const match = allocationByCartItem.get(key);
    if (match) return match;
    const original = Math.max(0, Number(row.total_halalas || 0));
    return {
      serviceId: cleanText(row.service_id),
      bookingItemId: key,
      originalAmountHalalas: original,
      discountAmountHalalas: 0,
      finalAmountHalalas: original,
    };
  });

  const appliedAt = nowIso();
  const snapshot = {
    type,
    source,
    sourceId,
    code,
    title,
    value: type === 'fixed' ? rawValue : undefined,
    percentage: type === 'percent' ? rawValue : undefined,
    amountHalalas: discountHalalas,
    eligibleSubtotalHalalas: eligibleSubtotal,
    maxDiscountHalalas: maxDiscount || null,
    appliedAt,
    appliedBy: cleanText(actor?.uid || actor || '') || null,
    allocations: fullAllocations,
  };

  const auditActions = [];
  if (source === 'manual') auditActions.push('discount_applied');
  if (source === 'offer') auditActions.push('offer_applied');
  if (source === 'coupon') auditActions.push('coupon_applied');

  return {
    subtotalHalalas: subtotal,
    discountHalalas,
    totalHalalas: Math.max(0, subtotal - discountHalalas),
    discountSnapshotJson: JSON.stringify(snapshot),
    allocationsByCartItem: new Map(fullAllocations.map((row) => [cleanText(row.bookingItemId), row])),
    auditActions,
    discountId: sourceId,
  };
}
