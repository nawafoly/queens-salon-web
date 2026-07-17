// CORE D1 ONLY — do not add Firestore fallback.

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
  updateById,
} from '../d1.js';
import { AppError } from '../errors.js';
import { recordAudit } from './audit.js';

function normalizeCode(value) {
  return cleanText(value).toUpperCase();
}

function jsonArray(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(Array.isArray(parsed) ? parsed : []);
    } catch {
      return '[]';
    }
  }
  return '[]';
}

export async function listDiscounts(db, salonId, query = {}) {
  const where = ['salon_id = ?'];
  const params = [salonId];
  if (String(query.includeDeleted || '').toLowerCase() !== 'true') {
    where.push('deleted_at IS NULL');
  }
  if (query.active !== undefined && query.active !== '') {
    where.push('active = ?');
    params.push(activeFlag(query.active));
  }
  if (optionalText(query.code)) {
    where.push('code_key = ?');
    params.push(normalizeCode(query.code));
  }
  if (optionalText(query.search)) {
    where.push('(LOWER(name) LIKE ? OR LOWER(COALESCE(code, \'\')) LIKE ?)');
    const search = `%${cleanText(query.search).toLowerCase()}%`;
    params.push(search, search);
  }
  return dbAll(
    db,
    `SELECT * FROM discounts WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 500`,
    params
  );
}

export async function getDiscount(db, salonId, id) {
  const row = await dbFirst(
    db,
    'SELECT * FROM discounts WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, requiredId(id)]
  );
  if (!row) rowNotFound('discount');
  return row;
}

export async function createDiscount(db, salonId, data, actor = {}) {
  const now = nowIso();
  const code = normalizeCode(data.code);
  const type = cleanText(data.type || data.discountType || 'fixed');
  if (!['fixed', 'percent'].includes(type)) {
    throw new AppError(400, 'core_discount:invalid_type');
  }
  const row = {
    id: requiredId(data.id || generatedId('discount')),
    salon_id: salonId,
    code: code || null,
    code_key: code || null,
    name: requiredText(data.name || data.title, 'name', 300),
    type,
    value: integer(data.value, 'value', { min: 0, max: type === 'percent' ? 100 : 100_000_000 }),
    active: activeFlag(data.active, 1),
    starts_at: optionalText(data.startsAt || data.starts_at || data.startDate) || null,
    ends_at: optionalText(data.endsAt || data.ends_at || data.endDate) || null,
    usage_limit: data.usageLimit === undefined && data.usage_limit === undefined
      ? null
      : integer(data.usageLimit ?? data.usage_limit, 'usageLimit', { min: 0, max: 10_000_000 }),
    used_count: integer(data.usedCount ?? data.used_count, 'usedCount', { min: 0, max: 10_000_000, fallback: 0 }),
    min_order_halalas: data.minOrderHalalas === undefined && data.min_order_halalas === undefined
      ? null
      : integer(data.minOrderHalalas ?? data.min_order_halalas, 'minOrderHalalas', { min: 0, max: 100_000_000 }),
    max_discount_halalas: data.maxDiscountHalalas === undefined && data.max_discount_halalas === undefined
      ? null
      : integer(data.maxDiscountHalalas ?? data.max_discount_halalas, 'maxDiscountHalalas', { min: 0, max: 100_000_000 }),
    per_client_limit: data.perClientLimit === undefined && data.per_client_limit === undefined
      ? null
      : integer(data.perClientLimit ?? data.per_client_limit, 'perClientLimit', { min: 0, max: 10_000_000 }),
    applies_to: cleanText(data.appliesTo || data.applies_to || 'all'),
    service_ids_json: jsonArray(data.serviceIds || data.service_ids_json),
    category_ids_json: jsonArray(data.categoryIds || data.category_ids_json),
    sequence_steps_json: jsonArray(data.sequenceSteps || data.sequence_steps_json),
    image_url: optionalText(data.imageUrl || data.image_url) || null,
    description: optionalText(data.description) || null,
    price_before_halalas: data.priceBeforeHalalas === undefined && data.price_before_halalas === undefined
      ? null
      : integer(data.priceBeforeHalalas ?? data.price_before_halalas, 'priceBeforeHalalas', { min: 0, max: 100_000_000 }),
    price_after_halalas: data.priceAfterHalalas === undefined && data.price_after_halalas === undefined
      ? null
      : integer(data.priceAfterHalalas ?? data.price_after_halalas, 'priceAfterHalalas', { min: 0, max: 100_000_000 }),
    published: activeFlag(data.published, 1),
    status: cleanText(data.status || (activeFlag(data.active, 1) ? 'active' : 'disabled')),
    sort_order: integer(data.sortOrder ?? data.sort_order, 'sortOrder', { min: 0, max: 1_000_000, fallback: 0 }),
    cta_label: optionalText(data.ctaLabel || data.cta_label) || null,
    cta_url: optionalText(data.ctaUrl || data.cta_url) || null,
    target_scope: cleanText(data.targetScope || data.target_scope || 'all'),
    target_client_ids_json: jsonArray(data.targetClientIds || data.target_client_ids_json),
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };

  await dbRun(
    db,
    `INSERT INTO discounts
      (id, salon_id, code, code_key, name, type, value, active, starts_at, ends_at,
       usage_limit, used_count, min_order_halalas, max_discount_halalas, per_client_limit,
       applies_to, service_ids_json, category_ids_json, sequence_steps_json,
       image_url, description, price_before_halalas, price_after_halalas, published, status,
       sort_order, cta_label, cta_url, target_scope, target_client_ids_json,
       deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.salon_id, row.code, row.code_key, row.name, row.type, row.value,
      row.active, row.starts_at, row.ends_at, row.usage_limit, row.used_count,
      row.min_order_halalas, row.max_discount_halalas, row.per_client_limit,
      row.applies_to, row.service_ids_json, row.category_ids_json, row.sequence_steps_json, row.image_url,
      row.description, row.price_before_halalas, row.price_after_halalas, row.published, row.status,
      row.sort_order, row.cta_label, row.cta_url, row.target_scope, row.target_client_ids_json,
      row.deleted_at, row.created_at, row.updated_at,
    ]
  );
  await recordAudit(db, salonId, {
    action: 'offer_created', entityType: 'offer', entityId: row.id,
    description: 'Offer created in Core D1', after: row, source: 'dashboard',
  }, actor);
  return row;
}

export async function patchDiscount(db, salonId, id, data, actor = {}) {
  const before = await getDiscount(db, salonId, id);
  const type = data.type === undefined && data.discountType === undefined
    ? undefined
    : cleanText(data.type || data.discountType);
  if (type !== undefined && !['fixed', 'percent'].includes(type)) {
    throw new AppError(400, 'core_discount:invalid_type');
  }
  const codeInput = data.code === undefined ? undefined : normalizeCode(data.code);
  const row = await updateById(db, 'discounts', salonId, requiredId(id), {
    code: codeInput === undefined ? undefined : (codeInput || null),
    code_key: codeInput === undefined ? undefined : (codeInput || null),
    name: data.name === undefined && data.title === undefined
      ? undefined
      : requiredText(data.name || data.title, 'name', 300),
    type,
    value: data.value === undefined
      ? undefined
      : integer(data.value, 'value', { min: 0, max: (type || before.type) === 'percent' ? 100 : 100_000_000 }),
    active: data.active === undefined ? undefined : activeFlag(data.active),
    starts_at: data.startsAt === undefined && data.starts_at === undefined && data.startDate === undefined
      ? undefined
      : optionalText(data.startsAt || data.starts_at || data.startDate) || null,
    ends_at: data.endsAt === undefined && data.ends_at === undefined && data.endDate === undefined
      ? undefined
      : optionalText(data.endsAt || data.ends_at || data.endDate) || null,
    usage_limit: data.usageLimit === undefined && data.usage_limit === undefined
      ? undefined
      : integer(data.usageLimit ?? data.usage_limit, 'usageLimit', { min: 0, max: 10_000_000 }),
    used_count: data.usedCount === undefined && data.used_count === undefined
      ? undefined
      : integer(data.usedCount ?? data.used_count, 'usedCount', { min: 0, max: 10_000_000 }),
    min_order_halalas: data.minOrderHalalas === undefined && data.min_order_halalas === undefined
      ? undefined
      : integer(data.minOrderHalalas ?? data.min_order_halalas, 'minOrderHalalas', { min: 0, max: 100_000_000 }),
    max_discount_halalas: data.maxDiscountHalalas === undefined && data.max_discount_halalas === undefined
      ? undefined
      : integer(data.maxDiscountHalalas ?? data.max_discount_halalas, 'maxDiscountHalalas', { min: 0, max: 100_000_000 }),
    per_client_limit: data.perClientLimit === undefined && data.per_client_limit === undefined
      ? undefined
      : integer(data.perClientLimit ?? data.per_client_limit, 'perClientLimit', { min: 0, max: 10_000_000 }),
    applies_to: data.appliesTo === undefined && data.applies_to === undefined
      ? undefined
      : cleanText(data.appliesTo || data.applies_to || 'all'),
    service_ids_json: data.serviceIds === undefined && data.service_ids_json === undefined
      ? undefined
      : jsonArray(data.serviceIds || data.service_ids_json),
    category_ids_json: data.categoryIds === undefined && data.category_ids_json === undefined
      ? undefined
      : jsonArray(data.categoryIds || data.category_ids_json),
    sequence_steps_json: data.sequenceSteps === undefined && data.sequence_steps_json === undefined
      ? undefined
      : jsonArray(data.sequenceSteps || data.sequence_steps_json),
    image_url: data.imageUrl === undefined && data.image_url === undefined
      ? undefined
      : optionalText(data.imageUrl || data.image_url) || null,
    description: data.description === undefined ? undefined : optionalText(data.description) || null,
    price_before_halalas: data.priceBeforeHalalas === undefined && data.price_before_halalas === undefined
      ? undefined
      : integer(data.priceBeforeHalalas ?? data.price_before_halalas, 'priceBeforeHalalas', { min: 0, max: 100_000_000 }),
    price_after_halalas: data.priceAfterHalalas === undefined && data.price_after_halalas === undefined
      ? undefined
      : integer(data.priceAfterHalalas ?? data.price_after_halalas, 'priceAfterHalalas', { min: 0, max: 100_000_000 }),
    published: data.published === undefined ? undefined : activeFlag(data.published),
    status: data.status === undefined ? undefined : cleanText(data.status || 'active'),
    sort_order: data.sortOrder === undefined && data.sort_order === undefined
      ? undefined
      : integer(data.sortOrder ?? data.sort_order, 'sortOrder', { min: 0, max: 1_000_000 }),
    cta_label: data.ctaLabel === undefined && data.cta_label === undefined
      ? undefined
      : optionalText(data.ctaLabel || data.cta_label) || null,
    cta_url: data.ctaUrl === undefined && data.cta_url === undefined
      ? undefined
      : optionalText(data.ctaUrl || data.cta_url) || null,
    target_scope: data.targetScope === undefined && data.target_scope === undefined
      ? undefined
      : cleanText(data.targetScope || data.target_scope || 'all'),
    target_client_ids_json: data.targetClientIds === undefined && data.target_client_ids_json === undefined
      ? undefined
      : jsonArray(data.targetClientIds || data.target_client_ids_json),
    deleted_at: data.deletedAt === undefined && data.deleted_at === undefined
      ? undefined
      : optionalText(data.deletedAt || data.deleted_at) || null,
  });
  await recordAudit(db, salonId, {
    action: row.deleted_at && !before.deleted_at ? 'offer_deleted' : 'offer_updated',
    entityType: 'offer', entityId: row.id, description: 'Offer updated in Core D1',
    before, after: row, source: 'dashboard',
  }, actor);
  return row;
}

export async function deleteDiscount(db, salonId, id, actor = {}) {
  const before = await getDiscount(db, salonId, id);
  if (Number(before.used_count || 0) > 0) {
    throw new AppError(409, 'core_discount:already_used', 'Used offers cannot be deleted');
  }
  await dbRun(db, 'DELETE FROM discounts WHERE salon_id = ? AND id = ?', [salonId, requiredId(id)]);
  await recordAudit(db, salonId, {
    action: 'offer_deleted', entityType: 'offer', entityId: id,
    description: 'Offer deleted from Core D1', before, after: null, source: 'dashboard',
  }, actor);
  return { id, deleted: true };
}

export async function incrementDiscountUsage(db, salonId, id, actor = {}) {
  const before = await getDiscount(db, salonId, id);
  if (before.usage_limit !== null && Number(before.used_count || 0) >= Number(before.usage_limit)) {
    throw new AppError(409, 'core_discount:usage_limit_reached');
  }
  await dbRun(
    db,
    'UPDATE discounts SET used_count = used_count + 1, updated_at = ? WHERE salon_id = ? AND id = ?',
    [nowIso(), salonId, requiredId(id)]
  );
  const row = await getDiscount(db, salonId, id);
  await recordAudit(db, salonId, {
    action: 'offer_used', entityType: 'offer', entityId: id,
    description: 'Offer usage incremented', before, after: row, source: 'checkout',
  }, actor);
  return row;
}
