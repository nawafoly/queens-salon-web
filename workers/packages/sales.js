import { generatedId } from '../core/d1.js';
import { normalizeError as normalizeCoreError } from '../core/errors.js';
import { invoiceInsertStatement } from '../core/repositories/invoices.js';
import { settledPaymentStatements } from '../core/repositories/payments.js';
import { getSetting } from '../core/repositories/settings.js';
import { AppError } from './errors.js';
import {
  boundedInteger,
  cleanText,
  normalizePaymentMethod,
  requiredExternalId,
  timestampFromMs,
} from './validation.js';

const MAX_HALALAS = 100_000_000;
const SALE_FIELDS = new Set([
  'salonId', 'saleReference', 'invoiceId', 'clientId', 'requestedClientId', 'clientLookup',
  'clientName', 'packageCatalogId', 'paymentMethod', 'expectedTotalHalalas', 'expectedTaxHalalas',
  'purchasedAt', 'expiresAt',
]);

export function parsePackageSale(data) {
  if (Object.keys(data).some((field) => !SALE_FIELDS.has(field))) {
    throw new AppError(400, 'packages_purchase:unsupported_fields');
  }
  const saleReference = requiredExternalId(data.saleReference ?? data.invoiceId, 'saleReference');
  if (data.saleReference != null && data.invoiceId != null && cleanText(data.invoiceId) !== saleReference) {
    throw new AppError(400, 'packages_purchase:conflicting_reference');
  }
  const quote = {};
  for (const [input, output] of [['expectedTotalHalalas', 'total'], ['expectedTaxHalalas', 'tax']]) {
    if (data[input] !== undefined) {
      quote[output] = boundedInteger(data[input], input, { min: 0, max: MAX_HALALAS, allowZero: true });
    }
  }
  return {
    saleReference,
    paymentMethod: cleanText(data.paymentMethod) ? normalizePaymentMethod(data.paymentMethod) : null,
    purchasedAt: data.purchasedAt,
    expiresAt: data.expiresAt,
    quote,
  };
}

export function packageSaleResult(sale, idempotent) {
  return {
    ok: true,
    idempotent,
    settlementStatus: 'paid',
    saleReference: sale.sale_reference,
    clientPackageId: sale.client_package_id,
    invoiceId: sale.invoice_id,
    invoiceDocumentId: sale.invoice_id,
    invoiceNumber: sale.invoice_number,
    paymentId: sale.payment_id,
    incomeId: sale.income_id,
    clientId: sale.canonical_client_id,
    canonicalClientId: sale.canonical_client_id,
    packageName: sale.package_name,
    totalSessions: sale.total_sessions,
    totalHalalas: sale.total_halalas,
    taxHalalas: sale.tax_halalas,
    taxRate: sale.tax_rate,
    paymentMethod: sale.payment_method,
    expiresAt: sale.expires_at,
  };
}

export function checkPackageSaleReplay(sale, input, clientId, packageCatalogId) {
  if (
    sale.canonical_client_id !== clientId || sale.package_catalog_id !== packageCatalogId ||
    sale.payment_method !== input.paymentMethod ||
    (input.quote.total !== undefined && input.quote.total !== sale.total_halalas) ||
    (input.quote.tax !== undefined && input.quote.tax !== sale.tax_halalas) ||
    input.purchasedAt !== undefined || input.expiresAt !== undefined
  ) {
    throw new AppError(409, 'packages_idempotency:purchase_conflict');
  }
  return packageSaleResult(sale, true);
}

export async function buildPackageSettlement(ctx, { catalog, identity, input, clientPackageId, purchaseTxId, now }) {
  if (!input.paymentMethod) throw new AppError(400, 'packages_purchase:payment_method_required');
  if (input.purchasedAt !== undefined || input.expiresAt !== undefined) {
    throw new AppError(400, 'packages_purchase:server_dates_required');
  }

  // The cashier catalog price includes tax. Core invoices store gross totals,
  // while the sale snapshot retains the tax component of those totals.
  const totalHalalas = Math.round(Number(catalog.price) * 100);
  if (!Number.isSafeInteger(totalHalalas) || totalHalalas < 1 || totalHalalas > MAX_HALALAS) {
    throw new AppError(409, 'packages_purchase:invalid_catalog_price');
  }
  const finance = await getSetting(ctx.coreDb, ctx.salonId, 'finance');
  const rate = Number(finance?.value?.taxRate ?? finance?.value?.vatRate ?? 0);
  const taxRate = Number.isFinite(rate) ? Math.max(0, Math.min(100, rate)) : 0;
  const taxHalalas = Math.round(totalHalalas * taxRate / (100 + taxRate));
  if (
    (input.quote.total !== undefined && input.quote.total !== totalHalalas) ||
    (input.quote.tax !== undefined && input.quote.tax !== taxHalalas)
  ) {
    throw new AppError(409, 'packages_purchase:quote_changed');
  }

  const invoiceId = generatedId('invoice');
  const paymentId = generatedId('payment');
  const incomeId = generatedId('income');
  const clientId = identity.documentId || identity.canonicalClientId;
  const invoice = {
    id: invoiceId, salon_id: ctx.salonId, booking_id: null, client_id: clientId,
    invoice_number: invoiceId, subtotal_halalas: totalHalalas, discount_halalas: 0,
    total_halalas: totalHalalas, paid_halalas: 0, status: 'unpaid', issued_at: now,
    created_at: now, updated_at: now,
  };
  const payment = {
    id: paymentId, salon_id: ctx.salonId, invoice_id: invoiceId, booking_id: null,
    client_id: clientId, method: input.paymentMethod, amount_halalas: totalHalalas,
    status: 'paid', provider: null, provider_reference: null, idempotency_key: purchaseTxId,
    paid_at: now, created_at: now,
  };
  const sale = {
    salon_id: ctx.salonId, sale_reference: input.saleReference, canonical_client_id: identity.canonicalClientId,
    package_catalog_id: catalog.id, client_package_id: clientPackageId, purchase_transaction_id: purchaseTxId,
    invoice_id: invoiceId, invoice_number: invoice.invoice_number, payment_id: paymentId, income_id: incomeId,
    package_name: catalog.name, total_sessions: catalog.total_sessions, total_halalas: totalHalalas,
    tax_halalas: taxHalalas, tax_rate: taxRate, payment_method: input.paymentMethod, purchased_at: now,
    expires_at: catalog.validity_days
      ? timestampFromMs(Date.parse(now) + Number(catalog.validity_days) * 86_400_000)
      : null,
  };
  const actor = { uid: ctx.identity?.uid, email: ctx.identity?.email, userId: ctx.user?.id };
  const saleStatement = {
    sql: `INSERT INTO package_sales
      (salon_id, sale_reference, canonical_client_id, package_catalog_id, client_package_id,
       purchase_transaction_id, invoice_id, invoice_number, payment_id, income_id, package_name,
       total_sessions, total_halalas, tax_halalas, tax_rate, payment_method, purchased_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        CASE WHEN EXISTS (
          SELECT 1 FROM package_catalog
          WHERE salon_id = ? AND id = ? AND active = 1
            AND sale_enabled IS ? AND updated_at IS ? AND price IS ? AND total_sessions IS ?
            AND allowed_service_ids_json IS ? AND validity_days IS ? AND name IS ?
            AND starts_at IS ? AND ends_at IS ?
        ) AND (SELECT value_json FROM salon_settings WHERE salon_id = ? AND setting_key = 'finance') IS ?
        THEN ? ELSE 0 END,
        ?, ?, ?, ?, ?)`,
    params: [
      sale.salon_id, sale.sale_reference, sale.canonical_client_id, sale.package_catalog_id, sale.client_package_id,
      sale.purchase_transaction_id, sale.invoice_id, sale.invoice_number, sale.payment_id, sale.income_id,
      sale.package_name, sale.total_sessions,
      ctx.salonId, catalog.id, catalog.sale_enabled, catalog.updated_at, catalog.price, catalog.total_sessions,
      catalog.allowed_service_ids_json, catalog.validity_days, catalog.name, catalog.starts_at, catalog.ends_at,
      ctx.salonId, finance?.value_json ?? null, sale.total_halalas,
      sale.tax_halalas, sale.tax_rate, sale.payment_method, sale.purchased_at, sale.expires_at,
    ],
  };
  return {
    sale,
    statements: [
      invoiceInsertStatement(invoice),
      ...settledPaymentStatements(payment, invoice, actor, { incomeId, packageName: catalog.name }),
      saleStatement,
    ],
  };
}

export function normalizePackageSettlementError(error) {
  if (/\bpackage_sale_quote_current\b/.test(error?.message || '')) {
    return new AppError(409, 'packages_purchase:quote_changed');
  }
  const normalized = normalizeCoreError(error);
  return normalized.status < 500
    ? new AppError(normalized.status, normalized.code, normalized.message)
    : error;
}
