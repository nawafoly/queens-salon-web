import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { buildClientCanonicalization } from "../scripts/migration-client-canonicalization.mjs";
import {
  buildSqlArtifact,
  prepareLocalD1PersistDirectory,
  validateLocalImportReport,
} from "../scripts/migrate-core-firestore-to-d1.mjs";
import worker from "./core/index.js";

class FakeD1 {
  constructor() {
    this.__fakeD1 = true;
    this.failBatchOnSqlIncludes = "";
    this.allQueryCount = 0;
    this.tables = Object.fromEntries([
      "clients",
      "client_aliases",
      "services",
      "service_categories",
      "staff",
      "staff_services",
      "staff_schedules",
      "bookings",
      "booking_items",
      "booking_slot_locks",
      "invoices",
      "payments",
      "income_entries",
      "expense_entries",
      "discounts",
      "service_sections",
      "refunds",
      "audit_logs",
    ].map((table) => [table, new Map()]));
  }

  key(table, row) {
    if (table === "client_aliases") return `${row.salon_id}\u0000${row.alias_id}`;
    if (table === "staff_services") return `${row.salon_id}\u0000${row.staff_id}\u0000${row.service_id}`;
    if (table === "booking_slot_locks") return `${row.salon_id}\u0000${row.staff_id}\u0000${row.booking_date}\u0000${row.slot_time}`;
    return row.id;
  }

  seed(table, row) {
    this.tables[table].set(this.key(table, row), { ...row });
  }

  rows(table) {
    return [...this.tables[table].values()].map((row) => ({ ...row }));
  }

  find(table, salonId, id) {
    return this.rows(table).find((row) => row.salon_id === salonId && row.id === id) || null;
  }

  async first(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0] || null;
  }

  async all(sql, params = []) {
    this.allQueryCount += 1;
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("clients", salonId, id) ? [this.find("clients", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("clients").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM services WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("services", salonId, id) ? [this.find("services", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM services WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("services").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM staff WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("staff", salonId, id) ? [this.find("staff", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM staff WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("staff").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT id FROM bookings")) {
      const [salonId, staffId, bookingDate, startTime, excludeId] = params;
      return this.rows("bookings").filter((row) =>
        row.salon_id === salonId &&
        row.staff_id === staffId &&
        row.booking_date === bookingDate &&
        row.start_time === startTime &&
        row.status !== "cancelled" &&
        row.id !== excludeId
      ).slice(0, 1).map((row) => ({ id: row.id }));
    }
    if (normalized.startsWith("SELECT * FROM bookings WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      const row = this.find("bookings", salonId, id);
      if (!row) return [];
      if (normalized.includes("deleted_at IS NULL") && row.deleted_at) return [];
      return [row];
    }
    if (normalized.startsWith("SELECT * FROM bookings WHERE salon_id = ? AND booking_date = ?")) {
      const [salonId, date] = params;
      return this.rows("bookings").filter((row) =>
        row.salon_id === salonId &&
        row.booking_date === date &&
        (!normalized.includes("deleted_at IS NULL") || !row.deleted_at)
      );
    }
    if (normalized.startsWith("SELECT COUNT(*) AS count FROM bookings WHERE salon_id = ? AND client_id = ?")) {
      const [salonId, clientId, needle] = params;
      const normalizedNeedle = String(needle || "").replace(/^%|%$/g, "");
      return [{
        count: this.rows("bookings").filter((row) =>
          row.salon_id === salonId &&
          row.client_id === clientId &&
          String(row.discount_snapshot_json || "").includes(normalizedNeedle)
        ).length,
      }];
    }
    if (normalized.startsWith("SELECT * FROM bookings WHERE salon_id = ?")) {
      const [salonId] = params;
      return this.rows("bookings").filter((row) =>
        row.salon_id === salonId &&
        (!normalized.includes("deleted_at IS NULL") || !row.deleted_at)
      );
    }
    if (normalized.startsWith("SELECT * FROM booking_items WHERE booking_id IN (")) {
      const bookingIds = new Set(params.map(String));
      return this.rows("booking_items").filter((row) => bookingIds.has(String(row.booking_id)));
    }
    if (normalized.startsWith("SELECT * FROM booking_items WHERE booking_id = ?")) {
      const [bookingId] = params;
      return this.rows("booking_items").filter((row) => row.booking_id === bookingId);
    }
    if (normalized.startsWith("SELECT * FROM invoices WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("invoices", salonId, id) ? [this.find("invoices", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM invoices WHERE salon_id = ? AND booking_id = ?")) {
      const [salonId, bookingId] = params;
      return this.rows("invoices").filter((row) => row.salon_id === salonId && row.booking_id === bookingId).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM invoices WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("invoices").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM payments WHERE salon_id = ? AND idempotency_key = ?")) {
      const [salonId, key] = params;
      return this.rows("payments").filter((row) => row.salon_id === salonId && row.idempotency_key === key).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM payments WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("payments").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM income_entries WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("income_entries").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM expense_entries WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("expense_entries").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM expense_entries WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("expense_entries", salonId, id) ? [this.find("expense_entries", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM income_entries WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("income_entries", salonId, id) ? [this.find("income_entries", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT canonical_client_id FROM client_aliases")) {
      const [salonId, aliasId] = params;
      return this.rows("client_aliases").filter((row) => row.salon_id === salonId && row.alias_id === aliasId).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM discounts WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("discounts", salonId, id) ? [this.find("discounts", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM discounts WHERE")) {
      const salonId = params[0];
      let rows = this.rows("discounts").filter((row) => row.salon_id === salonId);
      if (normalized.includes("deleted_at IS NULL")) rows = rows.filter((row) => !row.deleted_at);
      if (normalized.includes("active = ?")) {
        const activeIndex = normalized.slice(0, normalized.indexOf("active = ?")).split("?").length - 1;
        rows = rows.filter((row) => Number(row.active) === Number(params[activeIndex]));
      }
      if (normalized.includes("code_key = ?")) {
        const codeIndex = normalized.slice(0, normalized.indexOf("code_key = ?")).split("?").length - 1;
        rows = rows.filter((row) => row.code_key === params[codeIndex]);
      }
      return rows;
    }
    for (const table of ["service_sections", "service_categories"]) {
      if (normalized.startsWith(`SELECT * FROM ${table} WHERE salon_id = ?`)) {
        const [salonId] = params;
        let rows = this.rows(table).filter((row) => row.salon_id === salonId);
        if (normalized.includes("active = ?")) rows = rows.filter((row) => Number(row.active) === Number(params[1]));
        return rows;
      }
    }
    if (normalized.startsWith("SELECT * FROM refunds WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("refunds", salonId, id) ? [this.find("refunds", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM refunds WHERE salon_id = ? AND idempotency_key = ?")) {
      const [salonId, key] = params;
      return this.rows("refunds").filter((row) => row.salon_id === salonId && row.idempotency_key === key).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM refunds WHERE")) {
      const salonId = params[0];
      let rows = this.rows("refunds").filter((row) => row.salon_id === salonId);
      let index = 1;
      if (normalized.includes("booking_id = ?")) rows = rows.filter((row) => row.booking_id === params[index++]);
      if (normalized.includes("payment_id = ?")) rows = rows.filter((row) => row.payment_id === params[index++]);
      return rows;
    }
    if (normalized.startsWith("SELECT COALESCE(SUM(amount_halalas), 0) AS total FROM refunds")) {
      const [salonId, paymentId, excludeId] = params;
      const total = this.rows("refunds")
        .filter((row) => row.salon_id === salonId && row.payment_id === paymentId && row.status === "completed" && (!excludeId || row.id !== excludeId))
        .reduce((sum, row) => sum + Number(row.amount_halalas || 0), 0);
      return [{ total }];
    }
    if (normalized.startsWith("SELECT * FROM payments WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("payments", salonId, id) ? [this.find("payments", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT id FROM payments WHERE salon_id = ? AND booking_id = ?")) {
      const [salonId, bookingId] = params;
      return this.rows("payments").filter((row) => row.salon_id === salonId && row.booking_id === bookingId).slice(0, 1).map((row) => ({ id: row.id }));
    }
    if (normalized.startsWith("SELECT id FROM refunds WHERE salon_id = ? AND booking_id = ?")) {
      const [salonId, bookingId] = params;
      return this.rows("refunds").filter((row) => row.salon_id === salonId && row.booking_id === bookingId).slice(0, 1).map((row) => ({ id: row.id }));
    }
    if (normalized.startsWith("SELECT * FROM audit_logs WHERE")) {
      const salonId = params[0];
      let rows = this.rows("audit_logs").filter((row) => row.salon_id === salonId);
      let index = 1;
      if (normalized.includes("entity_type = ?")) rows = rows.filter((row) => row.entity_type === params[index++]);
      if (normalized.includes("entity_id = ?")) rows = rows.filter((row) => row.entity_id === params[index++]);
      if (normalized.includes("action = ?")) rows = rows.filter((row) => row.action === params[index++]);
      return rows.slice(0, Number(params[params.length - 1] || 200));
    }
    throw new Error(`unhandled fake D1 all: ${normalized}`);
  }

  insert(table, row) {
    this.seed(table, row);
    return { meta: { changes: 1 } };
  }

  update(table, salonId, id, fields) {
    const row = this.find(table, salonId, id);
    if (!row) return { meta: { changes: 0 } };
    this.seed(table, { ...row, ...fields });
    return { meta: { changes: 1 } };
  }

  async run(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    const insertMatch = normalized.match(/^INSERT(?: OR REPLACE)? INTO ([a-z_]+) \((.+?)\) VALUES/i);
    if (insertMatch && this.tables[insertMatch[1]]) {
      const table = insertMatch[1];
      const columns = insertMatch[2].split(",").map((value) => value.trim());
      const row = {};
      let paramIndex = 0;
      const valuesSection = normalized.match(/VALUES \((.+)\)$/i)?.[1]?.split(",").map((value) => value.trim()) || [];
      columns.forEach((column, index) => {
        const token = valuesSection[index] || "?";
        if (token === "?") row[column] = params[paramIndex++];
        else if (/^'.*'$/.test(token)) row[column] = token.slice(1, -1);
        else if (/^NULL$/i.test(token)) row[column] = null;
        else row[column] = token;
      });
      if (table === "bookings") {
        row.payment_status ??= "unpaid";
        row.cancelled_at ??= null;
        row.completed_at ??= null;
        row.deleted_at ??= null;
        row.deleted_by_uid ??= null;
        row.delete_reason ??= null;
      }
      return this.insert(table, row);
    }
    if (normalized.startsWith("INSERT INTO clients")) {
      const [id, salon_id, name, phone_normalized, email, firebase_uid, status, notes, created_at, updated_at] = params;
      return this.insert("clients", { id, salon_id, name, phone_normalized, email, firebase_uid, status, notes, created_at, updated_at });
    }
    if (normalized.startsWith("INSERT INTO services")) {
      const [id, salon_id, name, section_id, category_id, description, duration_minutes, price_halalas, active, image_url, sort_order, created_at, updated_at] = params;
      return this.insert("services", { id, salon_id, name, section_id, category_id, description, duration_minutes, price_halalas, active, image_url, sort_order, created_at, updated_at });
    }
    if (normalized.startsWith("UPDATE clients SET")) return this.dynamicUpdate("clients", normalized, params);
    if (normalized.startsWith("UPDATE services SET")) return this.dynamicUpdate("services", normalized, params);
    if (normalized.startsWith("UPDATE staff SET")) return this.dynamicUpdate("staff", normalized, params);
    if (normalized.startsWith("UPDATE bookings SET status = 'completed'")) {
      const [completed_at, updated_at, salonId, id] = params;
      return this.update("bookings", salonId, id, { status: "completed", completed_at, updated_at });
    }
    if (normalized.startsWith("UPDATE bookings SET status = 'cancelled'")) {
      const [cancelled_at, notes, updated_at, salonId, id] = params;
      return this.update("bookings", salonId, id, { status: "cancelled", cancelled_at, notes, updated_at });
    }
    if (normalized.startsWith("UPDATE bookings SET")) return this.dynamicUpdate("bookings", normalized, params);
    if (normalized.startsWith("INSERT INTO invoices")) {
      const [id, salon_id, booking_id, client_id, invoice_number, subtotal_halalas, discount_halalas, total_halalas, paid_halalas, status, issued_at, created_at, updated_at] = params;
      return this.insert("invoices", { id, salon_id, booking_id, client_id, invoice_number, subtotal_halalas, discount_halalas, total_halalas, paid_halalas, status, issued_at, created_at, updated_at });
    }
    if (normalized.startsWith("INSERT INTO income_entries")) {
      if (normalized.includes("METHOD, PAYMENT_BREAKDOWN_JSON, SOURCE, NOTE")) {
        const [id, salon_id, booking_id, invoice_id, payment_id, amount_halalas, description, method, payment_breakdown_json, note, occurred_at, created_at] = params;
        return this.insert("income_entries", { id, salon_id, booking_id, invoice_id, payment_id, amount_halalas, category: "payment", description, method, payment_breakdown_json, source: "booking", note, occurred_at, created_at });
      }
      const [id, salon_id, booking_id, invoice_id, payment_id, amount_halalas, category, description, occurred_at, created_at] = params;
      return this.insert("income_entries", { id, salon_id, booking_id, invoice_id, payment_id, amount_halalas, category, description, occurred_at, created_at });
    }
    if (normalized.startsWith("INSERT INTO expense_entries")) {
      const [id, salon_id, amount_halalas, category, description, payment_method, occurred_at, created_by_uid, created_at, updated_at] = params;
      return this.insert("expense_entries", { id, salon_id, amount_halalas, category, description, payment_method, occurred_at, created_by_uid, created_at, updated_at });
    }
    if (normalized.startsWith("UPDATE income_entries SET")) return this.dynamicUpdate("income_entries", normalized, params);
    if (normalized.startsWith("UPDATE expense_entries SET")) return this.dynamicUpdate("expense_entries", normalized, params);
    if (normalized.startsWith("UPDATE discounts SET used_count = used_count + 1")) {
      const [updatedAt, salonId, id] = params;
      const row = this.find("discounts", salonId, id);
      return this.update("discounts", salonId, id, { used_count: Number(row?.used_count || 0) + 1, updated_at: updatedAt });
    }
    if (normalized.startsWith("UPDATE discounts SET")) return this.dynamicUpdate("discounts", normalized, params);
    if (normalized.startsWith("UPDATE service_sections SET")) return this.dynamicUpdate("service_sections", normalized, params);
    if (normalized.startsWith("UPDATE service_categories SET")) return this.dynamicUpdate("service_categories", normalized, params);
    const deleteMatch = normalized.match(/^DELETE FROM ([a-z_]+) WHERE salon_id = \? AND id = \?/i);
    if (deleteMatch && this.tables[deleteMatch[1]]) {
      const [salonId, id] = params;
      const table = deleteMatch[1];
      const row = this.find(table, salonId, id);
      if (!row) return { meta: { changes: 0 } };
      this.tables[table].delete(this.key(table, row));
      return { meta: { changes: 1 } };
    }
    throw new Error(`unhandled fake D1 run: ${normalized}`);
  }

  dynamicUpdate(table, normalizedSql, params) {
    const assignments = normalizedSql.match(/SET (.+) WHERE salon_id/)?.[1]?.split(",").map((part) => part.trim().split(" = ")[0]) || [];
    const salonId = params[params.length - 2];
    const id = params[params.length - 1];
    const fields = {};
    assignments.forEach((field, index) => {
      fields[field] = params[index];
    });
    return this.update(table, salonId, id, fields);
  }

  async batch(statements) {
    const snapshot = Object.fromEntries(
      Object.entries(this.tables).map(([table, rows]) => [
        table,
        new Map([...rows.entries()].map(([key, row]) => [key, { ...row }])),
      ])
    );
    const results = [];
    try {
      for (const statement of statements) {
      const sql = statement.sql.replace(/\s+/g, " ").trim();
      const params = statement.params || [];
      if (this.failBatchOnSqlIncludes && sql.includes(this.failBatchOnSqlIncludes)) {
        this.failBatchOnSqlIncludes = "";
    this.allQueryCount = 0;
        throw new Error("simulated fake D1 batch failure");
      }
      if (sql.startsWith("INSERT INTO bookings")) {
        const [id, public_id, salon_id, client_id, staff_id, booking_date, start_time, end_time, status, source, notes, subtotal_halalas, discount_halalas, total_halalas, package_sessions_used, created_by_uid, created_at, updated_at, slot_step_min, buffer_min, discount_snapshot_json] = params;
        results.push(this.insert("bookings", {
          id, public_id, salon_id, client_id, staff_id, booking_date, start_time, end_time, status, source, notes,
          subtotal_halalas, discount_halalas, total_halalas, payment_status: "unpaid", package_sessions_used,
          created_by_uid, created_at, updated_at, cancelled_at: null, completed_at: null, slot_step_min, buffer_min, discount_snapshot_json,
        }));
      } else if (sql.startsWith("INSERT INTO booking_items")) {
        const [id, booking_id, salon_id, service_id, service_name_snapshot, staff_id, quantity, unit_price_halalas, total_halalas, package_covered, client_package_id, duration_minutes, created_at, booking_date, start_time, end_time, cart_item_id, package_reservation_id, discount_halalas = 0, final_total_halalas = total_halalas] = params;
        results.push(this.insert("booking_items", { id, booking_id, salon_id, service_id, service_name_snapshot, staff_id, quantity, unit_price_halalas, total_halalas, package_covered, client_package_id, duration_minutes, created_at, booking_date, start_time, end_time, cart_item_id, package_reservation_id, discount_halalas, final_total_halalas }));
      } else if (sql.startsWith("INSERT INTO booking_slot_locks")) {
        const [salon_id, staff_id, booking_date, slot_time, booking_id, booking_item_id, created_at] = params;
        const key = `${salon_id}\u0000${staff_id}\u0000${booking_date}\u0000${slot_time}`;
        if (this.tables.booking_slot_locks.has(key)) throw new Error("UNIQUE constraint failed: booking_slot_locks");
        results.push(this.insert("booking_slot_locks", { salon_id, staff_id, booking_date, slot_time, booking_id, booking_item_id, created_at }));
      } else if (sql.startsWith("UPDATE clients SET")) {
        results.push(this.dynamicUpdate("clients", sql, params));
      } else if (sql.startsWith("UPDATE booking_items SET")) {
        const [
          service_id,
          service_name_snapshot,
          staff_id,
          duration_minutes,
          booking_date,
          start_time,
          end_time,
          unit_price_halalas,
          total_halalas,
          final_total_halalas,
          salonId,
          bookingId,
          id,
        ] = params;
        const row = this.rows("booking_items").find(
          (item) => item.salon_id === salonId && item.booking_id === bookingId && item.id === id
        );
        results.push(
          row
            ? this.update("booking_items", salonId, id, {
                service_id,
                service_name_snapshot,
                staff_id,
                duration_minutes,
                booking_date,
                start_time,
                end_time,
                unit_price_halalas,
                total_halalas,
                final_total_halalas,
              })
            : { meta: { changes: 0 } }
        );
      } else if (sql.startsWith("UPDATE bookings SET status = 'cancelled'") && sql.includes("deleted_at = ?")) {
        const [cancelled_at, deleted_at, deleted_by_uid, delete_reason, updated_at, salonId, id] = params;
        const current = this.find("bookings", salonId, id);
        if (!current || current.deleted_at) {
          results.push({ meta: { changes: 0 } });
        } else {
          results.push(this.update("bookings", salonId, id, {
            status: "cancelled",
            cancelled_at: current.cancelled_at || cancelled_at,
            deleted_at,
            deleted_by_uid,
            delete_reason,
            updated_at,
          }));
        }
      } else if (sql.startsWith("UPDATE bookings SET status = 'cancelled'")) {
        const [cancelled_at, notes, updated_at, salonId, id] = params;
        results.push(this.update("bookings", salonId, id, { status: "cancelled", cancelled_at, notes, updated_at }));
      } else if (sql.startsWith("UPDATE bookings SET")) {
        results.push(this.dynamicUpdate("bookings", sql, params));
      } else if (sql.startsWith("DELETE FROM booking_slot_locks")) {
        const [salonId, bookingId] = params;
        let removed = 0;
        for (const [key, row] of this.tables.booking_slot_locks.entries()) {
          if (row.salon_id === salonId && row.booking_id === bookingId) {
            this.tables.booking_slot_locks.delete(key);
            removed += 1;
          }
        }
        results.push({ meta: { changes: removed } });
      } else if (sql.startsWith("UPDATE refunds SET status = 'voided'")) {
        const [voidedAt, voidedByUid, salonId, id] = params;
        results.push(this.update("refunds", salonId, id, { status: "voided", voided_at: voidedAt, voided_by_uid: voidedByUid }));
      } else if (sql.startsWith("DELETE FROM expense_entries WHERE salon_id = ? AND source_kind = 'refund'")) {
        const [salonId, sourceRefId] = params;
        let removed = 0;
        for (const [key, row] of this.tables.expense_entries.entries()) {
          if (row.salon_id === salonId && row.source_kind === "refund" && row.source_ref_id === sourceRefId) {
            this.tables.expense_entries.delete(key);
            removed += 1;
          }
        }
        results.push({ meta: { changes: removed } });
      } else if (sql.startsWith("DELETE FROM income_entries WHERE salon_id = ? AND booking_id = ? AND payment_id IS NOT NULL")) {
        const [salonId, bookingId] = params;
        let removed = 0;
        for (const [key, row] of this.tables.income_entries.entries()) {
          if (row.salon_id === salonId && row.booking_id === bookingId && row.payment_id) {
            this.tables.income_entries.delete(key);
            removed += 1;
          }
        }
        results.push({ meta: { changes: removed } });
      } else if (sql.startsWith("DELETE FROM payments WHERE salon_id = ? AND booking_id = ?")) {
        const [salonId, bookingId] = params;
        let removed = 0;
        for (const [key, row] of this.tables.payments.entries()) {
          if (row.salon_id === salonId && row.booking_id === bookingId) {
            this.tables.payments.delete(key);
            removed += 1;
          }
        }
        results.push({ meta: { changes: removed } });
      } else if (/^DELETE FROM (booking_items|income_entries|invoices) WHERE salon_id = \? AND booking_id = \?/.test(sql)) {
        const table = sql.match(/^DELETE FROM ([a-z_]+)/)[1];
        const [salonId, bookingId] = params;
        let removed = 0;
        for (const [key, row] of this.tables[table].entries()) {
          if (row.salon_id === salonId && row.booking_id === bookingId) {
            this.tables[table].delete(key);
            removed += 1;
          }
        }
        results.push({ meta: { changes: removed } });
      } else if (sql.startsWith("INSERT INTO invoices")) {
        results.push(await this.run(statement.sql, params));
      } else if (sql.startsWith("INSERT INTO payments")) {
        const [id, salon_id, invoice_id, booking_id, client_id, method, amount_halalas, status, provider, provider_reference, idempotency_key, paid_at, created_at] = params;
        results.push(this.insert("payments", { id, salon_id, invoice_id, booking_id, client_id, method, amount_halalas, status, provider, provider_reference, idempotency_key, paid_at, created_at }));
      } else if (sql.startsWith("INSERT INTO income_entries")) {
        results.push(await this.run(statement.sql, params));
      } else if (sql.startsWith("INSERT INTO audit_logs")) {
        results.push(await this.run(statement.sql, params));
      } else if (sql.startsWith("UPDATE discounts SET used_count = used_count + 1")) {
        results.push(await this.run(statement.sql, params));
      } else if (sql.startsWith("UPDATE refunds SET amount_halalas")) {
        const [amountHalalas, method, reason, refundedAt, salonId, id] = params;
        results.push(this.update("refunds", salonId, id, { amount_halalas: amountHalalas, method, reason, refunded_at: refundedAt }));
      } else if (sql.startsWith("UPDATE expense_entries SET amount_halalas")) {
        const [amountHalalas, description, paymentMethod, occurredAt, note, salonId, sourceRefId] = params;
        const row = this.rows("expense_entries").find((item) => item.salon_id === salonId && item.source_kind === "refund" && item.source_ref_id === sourceRefId);
        results.push(row ? this.update("expense_entries", salonId, row.id, { amount_halalas: amountHalalas, description, payment_method: paymentMethod, occurred_at: occurredAt, title: "استرجاع", note }) : { meta: { changes: 0 } });
      } else if (sql.startsWith("UPDATE invoices SET")) {
        results.push(this.dynamicUpdate("invoices", sql, params));
      } else if (sql.startsWith("DELETE FROM ")) {
        results.push(await this.run(statement.sql, params));
      } else if (sql.startsWith("INSERT INTO refunds") || sql.startsWith("INSERT INTO expense_entries")) {
        results.push(await this.run(statement.sql, params));
      } else {
        throw new Error(`unhandled fake D1 batch: ${sql}`);
      }
      }
      return results;
    } catch (error) {
      this.tables = snapshot;
      throw error;
    }
  }
}

function env(fake) {
  return {
    FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
    PACKAGES_AUTH_TEST_MODE: "true",
    SALON_ID: "main",
    CORE_DB: fake,
  };
}

function request(path, { method = "GET", token = "test:owner1:owner", body } = {}) {
  return new Request(`http://worker.test${path}`, {
    method,
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
}

async function json(response) {
  return response.json();
}

function splitSqlValues(text) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") {
      if (quoted && text[index + 1] === "'") {
        current += "''";
        index += 1;
        continue;
      }
      quoted = !quoted;
    }
    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function splitSqlTuples(text) {
  const tuples = [];
  let current = "";
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") {
      if (quoted && text[index + 1] === "'") {
        current += "''";
        index += 1;
        continue;
      }
      quoted = !quoted;
    }
    if (!quoted && char === "(") {
      if (depth === 0) {
        current = "";
        depth = 1;
        continue;
      }
      depth += 1;
    } else if (!quoted && char === ")") {
      depth -= 1;
      if (depth === 0) {
        tuples.push(current);
        current = "";
        continue;
      }
    }
    if (depth > 0) current += char;
  }
  return tuples;
}

function unquoteSqlValue(value) {
  return value === "NULL" ? "" : value.replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
}

function parseInsertRows(line) {
  const match = /^INSERT OR REPLACE INTO (\w+) \((.+)\) VALUES (.*);$/.exec(line.trim());
  if (!match) return [];
  const columns = match[2].split(",").map((column) => column.trim());
  return splitSqlTuples(match[3]).map((tuple) => {
    const values = splitSqlValues(tuple).map(unquoteSqlValue);
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
}

function fakeLocalValidationQueryRows({ counts = {}, danglingBookingClients = 0 } = {}) {
  return (sql) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized === "PRAGMA foreign_key_check;") return [];
    if (normalized === "PRAGMA integrity_check;") return [{ integrity_check: "ok" }];
    if (normalized.includes("LEFT JOIN clients c ON c.id = b.client_id")) {
      return [{ count: danglingBookingClients }];
    }
    if (normalized.includes("bookings WHERE client_id IS NULL")) return [{ count: 0 }];
    if (normalized.includes("LEFT JOIN bookings b ON b.id = bi.booking_id")) return [{ count: 0 }];
    if (normalized.includes("LEFT JOIN services s ON s.id = bi.service_id")) return [{ count: 0 }];
    if (normalized.includes("LEFT JOIN bookings b ON b.id = l.booking_id")) return [{ count: 0 }];
    if (normalized.includes("LEFT JOIN clients c ON c.id = a.canonical_client_id")) return [{ count: 0 }];
    if (normalized.includes("FROM (SELECT salon_id, UPPER(TRIM(COALESCE(code_key, code)))")) return [{ count: 0 }];
    if (normalized.includes("FROM clients WHERE id =")) return [{ count: 1 }];
    const countMatch = /^SELECT COUNT\(\*\) AS count FROM ([a-z_]+);?$/.exec(normalized);
    if (countMatch) return [{ count: counts[countMatch[1]] ?? 0 }];
    throw new Error(`unexpected validation query: ${normalized}`);
  };
}

function seedCore(fake) {
  const now = "2027-01-01T00:00:00.000Z";
  fake.seed("clients", { id: "client-a", salon_id: "main", name: "Client A", phone_normalized: "0500000001", email: null, firebase_uid: "client1", status: "active", notes: null, created_at: now, updated_at: now });
  fake.seed("services", { id: "svc-a", salon_id: "main", name: "Service A", category_id: null, description: null, duration_minutes: 30, price_halalas: 7500, active: 1, image_url: null, sort_order: 0, created_at: now, updated_at: now });
  fake.seed("staff", { id: "staff-a", salon_id: "main", firebase_uid: "staff1", name: "Staff A", phone_normalized: null, active: 1, employment_status: "active", created_at: now, updated_at: now });
}

function seedDiscount(fake, overrides = {}) {
  const now = "2027-01-01T00:00:00.000Z";
  const code = String(overrides.code || overrides.code_key || "SAVE10").toUpperCase();
  const row = {
    id: overrides.id || "discount-a",
    salon_id: "main",
    code,
    code_key: code,
    name: overrides.name || "Discount A",
    type: overrides.type || "fixed",
    value: overrides.value ?? 10,
    active: overrides.active ?? 1,
    starts_at: overrides.starts_at ?? null,
    ends_at: overrides.ends_at ?? null,
    usage_limit: overrides.usage_limit ?? null,
    used_count: overrides.used_count ?? 0,
    min_order_halalas: overrides.min_order_halalas ?? null,
    max_discount_halalas: overrides.max_discount_halalas ?? null,
    per_client_limit: overrides.per_client_limit ?? null,
    applies_to: overrides.applies_to || "all",
    service_ids_json: overrides.service_ids_json || "[]",
    category_ids_json: overrides.category_ids_json || "[]",
    sequence_steps_json: overrides.sequence_steps_json || "[]",
    image_url: overrides.image_url || null,
    deleted_at: overrides.deleted_at || null,
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now,
  };
  fake.seed("discounts", row);
  return row;
}

async function createCoreBooking(fake, overrides = {}) {
  const id = overrides.id || "booking-a";
  const response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id,
      invoiceId: overrides.invoiceId || `invoice-${id}`,
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: overrides.bookingDate || "2027-01-10",
      startTime: overrides.startTime || "10:00",
      items: [{ id: overrides.itemId || `item-${id}`, serviceId: "svc-a" }],
      ...overrides.body,
    },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
  return fake.find("bookings", "main", id);
}

test("core operational path passes D1-only guard", () => {
  const result = spawnSync(process.execPath, ["scripts/check-core-d1-only.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("core endpoint fails clearly when D1 binding is missing", async () => {
  const response = await worker.fetch(request("/api/core/clients", { method: "GET" }), {
    FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
    PACKAGES_AUTH_TEST_MODE: "true",
    SALON_ID: "main",
  });
  const body = await json(response);
  assert.equal(response.status, 503, JSON.stringify(body));
  assert.equal(body.error, "core_d1:not_configured");
});

test("client CRUD uses D1", async () => {
  const fake = new FakeD1();
  let response = await worker.fetch(request("/api/core/clients", {
    method: "POST",
    body: { salonId: "main", id: "client-a", name: "Client A", phone: "+966500000001" },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.phone_normalized, "0500000001");

  response = await worker.fetch(request("/api/core/clients/client-a", {
    method: "PATCH",
    body: { salonId: "main", notes: "VIP" },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.notes, "VIP");

  response = await worker.fetch(request("/api/core/clients/client-a"), env(fake));
  body = await json(response);
  assert.equal(body.data.name, "Client A");
});

test("service CRUD uses D1", async () => {
  const fake = new FakeD1();
  let response = await worker.fetch(request("/api/core/services", {
    method: "POST",
    body: { salonId: "main", id: "svc-a", name: "Service A", durationMinutes: 30, priceHalalas: 7500 },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.price_halalas, 7500);

  response = await worker.fetch(request("/api/core/services/svc-a", {
    method: "PATCH",
    body: { salonId: "main", active: false },
  }), env(fake));
  body = await json(response);
  assert.equal(body.data.active, 0);
});

test("booking creation creates booking items and invoice", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-a",
      invoiceId: "invoice-a",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:00",
      items: [{ id: "item-a", serviceId: "svc-a" }],
    },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.total_halalas, 7500);
  assert.equal(body.data.end_time, "10:30");
  assert.equal(body.data.items.length, 1);
  assert.equal(body.data.public_id || body.data.publicId, "MK-10423");
  assert.equal(fake.rows("invoices")[0].booking_id, "booking-a");
  assert.equal(fake.rows("payments").length, 0);
  assert.equal(fake.rows("income_entries").length, 0);
  assert.ok(fake.rows("audit_logs").some((row) => row.action === "booking_created" && row.entity_id === "booking-a"));

  const retryResponse = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-a",
      invoiceId: "invoice-a",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:00",
      items: [{ id: "item-a", serviceId: "svc-a" }],
    },
  }), env(fake));
  const retryBody = await json(retryResponse);
  assert.equal(retryResponse.status, 200, JSON.stringify(retryBody));
  assert.equal(retryBody.data.public_id, "MK-10423");

  const secondResponse = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-b",
      invoiceId: "invoice-b",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:30",
      items: [{ id: "item-b", serviceId: "svc-a" }],
    },
  }), env(fake));
  const secondBody = await json(secondResponse);
  assert.equal(secondResponse.status, 200, JSON.stringify(secondBody));
  assert.equal(secondBody.data.public_id, "MK-10424");
});

test("booking list hydrates large dashboard results with bounded D1 reads", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const now = "2027-01-01T00:00:00.000Z";
  for (let index = 0; index < 150; index += 1) {
    const id = `booking-list-${String(index).padStart(3, "0")}`;
    fake.seed("bookings", {
      id,
      salon_id: "main",
      client_id: "client-a",
      staff_id: "staff-a",
      booking_date: "2027-02-01",
      start_time: "10:00",
      end_time: "10:30",
      status: "confirmed",
      source: "internal_v2",
      subtotal_halalas: 7500,
      discount_halalas: 0,
      total_halalas: 7500,
      payment_status: "unpaid",
      package_sessions_used: 0,
      created_at: now,
      updated_at: now,
    });
    fake.seed("booking_items", {
      id: `item-${id}`,
      booking_id: id,
      salon_id: "main",
      service_id: "svc-a",
      service_name_snapshot: "Service A",
      staff_id: "staff-a",
      quantity: 1,
      unit_price_halalas: 7500,
      total_halalas: 7500,
      package_covered: 0,
      duration_minutes: 30,
      booking_date: "2027-02-01",
      start_time: "10:00",
      end_time: "10:30",
      created_at: now,
    });
  }

  const before = fake.allQueryCount;
  const response = await worker.fetch(request("/api/core/bookings"), env(fake));
  const body = await json(response);
  const reads = fake.allQueryCount - before;

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.length, 150);
  assert.equal(body.data[0].client_name, "Client A");
  assert.equal(body.data[0].staff_name, "Staff A");
  assert.equal(body.data[0].items.length, 1);
  assert.ok(reads <= 12, `expected bounded reads, received ${reads}`);
});



test("dashboard booking edit updates schedule service client totals and payment atomically", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const now = "2027-01-01T00:00:00.000Z";
  fake.seed("services", {
    id: "svc-b",
    salon_id: "main",
    name: "Service B",
    section_id: "hair",
    category_id: "cat-b",
    description: null,
    duration_minutes: 45,
    price_halalas: 9000,
    active: 1,
    image_url: null,
    sort_order: 2,
    created_at: now,
    updated_at: now,
  });

  let response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      id: "booking-edit-a",
      invoiceId: "invoice-edit-a",
      clientId: "client-a",
      staffId: "staff-a",
      source: "internal",
      bookingDate: "2027-01-10",
      startTime: "10:00",
      items: [{ id: "item-edit-a", serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: {
      id: "payment-edit-old",
      bookingId: "booking-edit-a",
      method: "card",
      amountHalalas: 7500,
      idempotencyKey: "payment-edit-old",
    },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/bookings/booking-edit-a", {
    method: "PATCH",
    body: {
      clientName: "Client Updated",
      clientPhone: "0561234567",
      bookingDate: "2027-01-11",
      startTime: "11:00",
      staffId: "staff-a",
      serviceId: "svc-b",
      durationMinutes: 45,
      notes: "ملاحظة نظيفة",
      totalHalalas: 9000,
      paidHalalas: 3000,
      paymentMethod: "cash",
      reconcilePayment: true,
    },
  }), env(fake));
  const body = await json(response);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.client_name, "Client Updated");
  assert.equal(body.data.client_phone, "0561234567");
  assert.equal(body.data.booking_date, "2027-01-11");
  assert.equal(body.data.start_time, "11:00");
  assert.equal(body.data.end_time, "11:45");
  assert.equal(body.data.total_halalas, 9000);
  assert.equal(body.data.payment_status, "partial");
  assert.equal(body.data.paid_halalas, 3000);
  assert.equal(body.data.items[0].service_id, "svc-b");
  assert.equal(body.data.items[0].service_name_snapshot, "Service B");
  assert.equal(body.data.items[0].final_total_halalas, 9000);
  assert.equal(fake.find("clients", "main", "client-a").name, "Client Updated");
  assert.equal(fake.find("invoices", "main", "invoice-edit-a").total_halalas, 9000);
  assert.equal(fake.find("invoices", "main", "invoice-edit-a").paid_halalas, 3000);
  assert.equal(fake.rows("payments").length, 1);
  assert.equal(fake.rows("payments")[0].method, "cash");
  assert.equal(fake.rows("payments")[0].amount_halalas, 3000);
  assert.equal(fake.rows("income_entries").length, 1);
  assert.ok(fake.rows("audit_logs").some((row) => row.action === "details_updated"));
  assert.ok(fake.rows("booking_slot_locks").every((row) => row.booking_date === "2027-01-11"));
});

test("booking manual fixed discount is verified, capped and snapshotted by Core", async () => {
  const fake = new FakeD1();
  seedCore(fake);

  let response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-fixed-discount",
      invoiceId: "invoice-fixed-discount",
      clientId: "client-a",
      staffId: "staff-a",
      source: "internal",
      bookingDate: "2027-01-10",
      startTime: "10:00",
      discountSnapshot: { source: "manual", type: "fixed", value: 10, title: "Manual 10" },
      items: [{ id: "item-fixed-discount", cartItemId: "cart-fixed", serviceId: "svc-a" }],
    },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.subtotal_halalas, 7500);
  assert.equal(body.data.discount_halalas, 1000);
  assert.equal(body.data.total_halalas, 6500);
  assert.equal(body.data.items[0].discount_halalas, 1000);
  assert.equal(body.data.items[0].final_total_halalas, 6500);
  assert.equal(fake.find("invoices", "main", "invoice-fixed-discount").discount_halalas, 1000);
  assert.equal(JSON.parse(fake.find("bookings", "main", "booking-fixed-discount").discount_snapshot_json).source, "manual");
  assert.ok(fake.rows("audit_logs").some((row) => row.action === "discount_applied"));

  response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-fixed-cap",
      invoiceId: "invoice-fixed-cap",
      clientId: "client-a",
      staffId: "staff-a",
      source: "internal",
      bookingDate: "2027-01-10",
      startTime: "11:00",
      discountSnapshot: { source: "manual", type: "fixed", value: 9999, title: "Too large" },
      items: [{ id: "item-fixed-cap", serviceId: "svc-a" }],
    },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.discount_halalas, 7500);
  assert.equal(body.data.total_halalas, 0);
});

test("booking manual percent discount supports 100 percent and rejects values over 100", async () => {
  const fake = new FakeD1();
  seedCore(fake);

  let response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-percent-100",
      invoiceId: "invoice-percent-100",
      clientId: "client-a",
      staffId: "staff-a",
      source: "internal",
      bookingDate: "2027-01-10",
      startTime: "10:00",
      discountSnapshot: { source: "manual", type: "percent", percentage: 100 },
      items: [{ id: "item-percent-100", serviceId: "svc-a" }],
    },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.discount_halalas, 7500);
  assert.equal(body.data.total_halalas, 0);

  response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-percent-over",
      clientId: "client-a",
      staffId: "staff-a",
      source: "internal",
      bookingDate: "2027-01-10",
      startTime: "11:00",
      discountSnapshot: { source: "manual", type: "percent", percentage: 101 },
      items: [{ id: "item-percent-over", serviceId: "svc-a" }],
    },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(body.error, "core_discount:percent_over_100");
});

test("booking offer discount applies only to eligible services and rounds allocations", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const now = "2027-01-01T00:00:00.000Z";
  fake.seed("services", { id: "svc-b", salon_id: "main", name: "Service B", category_id: "cat-b", description: null, duration_minutes: 30, price_halalas: 2500, active: 1, image_url: null, sort_order: 1, created_at: now, updated_at: now });
  seedDiscount(fake, {
    id: "offer-service-a",
    code: "SVC50",
    name: "Service A 50%",
    type: "percent",
    value: 50,
    applies_to: "services",
    service_ids_json: JSON.stringify(["svc-a"]),
  });

  const response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-offer-service",
      invoiceId: "invoice-offer-service",
      clientId: "client-a",
      staffId: "staff-a",
      source: "internal",
      bookingDate: "2027-01-10",
      startTime: "10:00",
      discountSnapshot: { source: "offer", sourceId: "offer-service-a", code: "SVC50" },
      items: [
        { id: "offer-item-a", cartItemId: "cart-a", serviceId: "svc-a" },
        { id: "offer-item-b", cartItemId: "cart-b", serviceId: "svc-b" },
      ],
    },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.subtotal_halalas, 10000);
  assert.equal(body.data.discount_halalas, 3750);
  assert.equal(body.data.total_halalas, 6250);
  assert.equal(body.data.items.find((row) => row.id === "offer-item-a").discount_halalas, 3750);
  assert.equal(body.data.items.find((row) => row.id === "offer-item-b").discount_halalas, 0);
  assert.equal(fake.find("discounts", "main", "offer-service-a").used_count, 1);
  assert.ok(fake.rows("audit_logs").some((row) => row.action === "offer_applied"));
});

test("coupon validation rejects expired inactive minimum and usage-limit violations", async () => {
  const cases = [
    ["coupon-expired", { id: "coupon-expired", code: "EXPIRED", ends_at: "2000-01-01" }, "core_discount:expired"],
    ["coupon-inactive", { id: "coupon-inactive", code: "INACTIVE", active: 0 }, "core_discount:inactive"],
    ["coupon-minimum", { id: "coupon-minimum", code: "MINIMUM", min_order_halalas: 10000 }, "core_discount:minimum_not_met"],
    ["coupon-usage", { id: "coupon-usage", code: "USAGE", usage_limit: 1, used_count: 1 }, "core_discount:usage_limit_reached"],
  ];

  for (const [id, discount, expectedError] of cases) {
    const fake = new FakeD1();
    seedCore(fake);
    seedDiscount(fake, { type: "fixed", value: 10, ...discount });
    const response = await worker.fetch(request("/api/core/bookings", {
      method: "POST",
      body: {
        salonId: "main",
        id: `booking-${id}`,
        clientId: "client-a",
        staffId: "staff-a",
        source: "client",
        bookingDate: "2027-01-10",
        startTime: "10:00",
        discountSnapshot: { source: "coupon", code: discount.code },
        items: [{ id: `item-${id}`, serviceId: "svc-a" }],
      },
    }), env(fake));
    const body = await json(response);
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(body.error, expectedError);
  }
});

test("valid coupon is idempotent for same booking id and does not double count usage", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  seedDiscount(fake, { id: "coupon-valid", code: "VALID10", type: "fixed", value: 10 });
  const payload = {
    salonId: "main",
    id: "booking-coupon-idempotent",
    invoiceId: "invoice-coupon-idempotent",
    clientId: "client-a",
    staffId: "staff-a",
    source: "client",
    bookingDate: "2027-01-10",
    startTime: "10:00",
    discountSnapshot: { source: "coupon", code: "VALID10" },
    items: [{ id: "item-coupon-idempotent", serviceId: "svc-a" }],
  };

  const first = await worker.fetch(request("/api/core/bookings", { method: "POST", body: payload }), env(fake));
  const second = await worker.fetch(request("/api/core/bookings", { method: "POST", body: payload }), env(fake));
  assert.equal(first.status, 200, JSON.stringify(await json(first)));
  assert.equal(second.status, 200, JSON.stringify(await json(second)));
  assert.equal(fake.find("discounts", "main", "coupon-valid").used_count, 1);
  assert.equal(fake.rows("bookings").length, 1);
  assert.ok(fake.rows("audit_logs").some((row) => row.action === "coupon_applied"));
});

test("discounted booking payments use the final amount for full partial and mixed payments", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const createDiscounted = async (id, startTime) => {
    await createCoreBooking(fake, {
      id,
      invoiceId: `invoice-${id}`,
      body: {
        source: "internal",
        startTime,
        discountSnapshot: { source: "manual", type: "fixed", value: 10 },
        items: [{ id: `item-${id}`, serviceId: "svc-a" }],
      },
    });
    assert.equal(fake.find("bookings", "main", id).total_halalas, 6500);
  };

  await createDiscounted("booking-discount-none", "10:00");
  assert.equal(fake.rows("payments").length, 0);
  assert.equal(fake.rows("income_entries").length, 0);

  await createDiscounted("booking-discount-full", "11:00");
  let response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: { salonId: "main", bookingId: "booking-discount-full", method: "cash", amountHalalas: 6500, idempotencyKey: "discount-full" },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
  assert.equal(fake.find("invoices", "main", "invoice-booking-discount-full").paid_halalas, 6500);
  assert.equal(fake.find("bookings", "main", "booking-discount-full").payment_status, "paid");

  await createDiscounted("booking-discount-partial", "12:00");
  response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: { salonId: "main", bookingId: "booking-discount-partial", method: "card", amountHalalas: 2000, idempotencyKey: "discount-partial" },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
  assert.equal(fake.find("invoices", "main", "invoice-booking-discount-partial").paid_halalas, 2000);
  assert.equal(fake.find("bookings", "main", "booking-discount-partial").payment_status, "partial");

  await createDiscounted("booking-discount-mixed", "13:00");
  for (const [method, amount] of [["cash", 2500], ["card", 4000]]) {
    response = await worker.fetch(request("/api/core/payments", {
      method: "POST",
      body: { salonId: "main", bookingId: "booking-discount-mixed", method, amountHalalas: amount, idempotencyKey: `discount-mixed-${method}` },
    }), env(fake));
    assert.equal(response.status, 200, JSON.stringify(await json(response)));
  }
  assert.equal(fake.find("invoices", "main", "invoice-booking-discount-mixed").paid_halalas, 6500);
  assert.equal(fake.find("bookings", "main", "booking-discount-mixed").payment_status, "paid");
  assert.equal(fake.rows("income_entries").reduce((sum, row) => sum + Number(row.amount_halalas || 0), 0), 15000);
});

test("invoice lookup by booking id returns the Core invoice", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  await createCoreBooking(fake, {
    id: "booking-invoice-lookup",
    invoiceId: "invoice-lookup",
  });

  const response = await worker.fetch(
    request("/api/core/invoices?bookingId=booking-invoice-lookup"),
    env(fake)
  );
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.id, "invoice-lookup");
  assert.equal(body.data.booking_id, "booking-invoice-lookup");
});

test("booking conflict rejects same staff slot", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const payload = {
    salonId: "main",
    clientId: "client-a",
    staffId: "staff-a",
    bookingDate: "2027-01-10",
    startTime: "10:00",
    items: [{ serviceId: "svc-a" }],
  };
  const first = await worker.fetch(request("/api/core/bookings", { method: "POST", body: { ...payload, id: "booking-a" } }), env(fake));
  const second = await worker.fetch(request("/api/core/bookings", { method: "POST", body: { ...payload, id: "booking-b" } }), env(fake));
  assert.equal(first.status, 200);
  const body = await json(second);
  assert.equal(second.status, 409, JSON.stringify(body));
  assert.equal(body.error, "core_booking:staff_slot_conflict");
});

test("booking completion and cancellation update status", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  fake.seed("bookings", { id: "booking-a", salon_id: "main", client_id: "client-a", staff_id: "staff-a", booking_date: "2027-01-10", start_time: "10:00", end_time: "10:30", status: "booked", source: "test", notes: null, subtotal_halalas: 7500, discount_halalas: 0, total_halalas: 7500, payment_status: "unpaid", package_sessions_used: 0, created_by_uid: "owner1", created_at: "2027-01-01T00:00:00.000Z", updated_at: "2027-01-01T00:00:00.000Z", cancelled_at: null, completed_at: null });
  let response = await worker.fetch(request("/api/core/bookings/booking-a/complete", { method: "POST", body: { salonId: "main" } }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "completed");
  response = await worker.fetch(request("/api/core/bookings/booking-a/cancel", { method: "POST", body: { salonId: "main", reason: "client request" } }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "cancelled");
});

test("invoice creation and split payment are idempotent", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  let response = await worker.fetch(request("/api/core/invoices", {
    method: "POST",
    body: { salonId: "main", id: "invoice-a", clientId: "client-a", subtotalHalalas: 10000, totalHalalas: 10000 },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: { salonId: "main", id: "payment-cash", invoiceId: "invoice-a", method: "cash", amountHalalas: 4000, idempotencyKey: "cash-1" },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: { salonId: "main", id: "payment-card", invoiceId: "invoice-a", method: "card", amountHalalas: 6000, idempotencyKey: "card-1" },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: { salonId: "main", id: "payment-card-repeat", invoiceId: "invoice-a", method: "card", amountHalalas: 6000, idempotencyKey: "card-1" },
  }), env(fake));
  const repeat = await json(response);
  assert.equal(repeat.data.idempotent, true);
  assert.equal(fake.find("invoices", "main", "invoice-a").status, "paid");
  assert.equal(fake.rows("payments").length, 2);
});

test("full cash booking payment updates invoice booking income reports and audit", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  await createCoreBooking(fake, { id: "booking-cash", invoiceId: "invoice-cash" });

  const response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: {
      salonId: "main",
      id: "payment-cash",
      bookingId: "booking-cash",
      method: "cash",
      amountHalalas: 7500,
      idempotencyKey: "booking-cash:cash:7500",
    },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  assert.equal(fake.find("invoices", "main", "invoice-cash").paid_halalas, 7500);
  assert.equal(fake.find("invoices", "main", "invoice-cash").status, "paid");
  assert.equal(fake.find("bookings", "main", "booking-cash").payment_status, "paid");
  assert.equal(fake.rows("payments").length, 1);
  assert.equal(fake.rows("income_entries").length, 1);
  assert.equal(fake.rows("income_entries")[0].booking_id, "booking-cash");

  const incomeResponse = await worker.fetch(request("/api/core/income"), env(fake));
  const incomeBody = await json(incomeResponse);
  assert.equal(incomeBody.data.length, 1);
  assert.equal(incomeBody.data[0].amount_halalas, 7500);
  assert.equal(incomeBody.data[0].method, "cash");
  assert.equal(incomeBody.data[0].source, "booking");
  assert.equal(incomeBody.data[0].note, "booking_payment:cash");
  assert.deepEqual(JSON.parse(incomeBody.data[0].payment_breakdown_json), { cash: 75 });

  const bookingResponse = await worker.fetch(request("/api/core/bookings/booking-cash"), env(fake));
  const bookingBody = await json(bookingResponse);
  assert.equal(bookingResponse.status, 200, JSON.stringify(bookingBody));
  assert.equal(bookingBody.data.paid_halalas, 7500);
  assert.equal(bookingBody.data.invoice_id, "invoice-cash");

  const actions = fake.rows("audit_logs").map((row) => row.action);
  assert.ok(actions.includes("booking_created"));
  assert.ok(actions.includes("payment_recorded"));
  assert.ok(actions.includes("income_created"));
  assert.ok(actions.includes("invoice_payment_updated"));
  assert.ok(actions.includes("booking_payment_status_updated"));
});

test("deposit booking payment stays partial and is safe to retry", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  await createCoreBooking(fake, { id: "booking-deposit", invoiceId: "invoice-deposit" });

  let response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: {
      salonId: "main",
      id: "payment-deposit",
      bookingId: "booking-deposit",
      method: "cash",
      amountHalalas: 2500,
      idempotencyKey: "booking-deposit:deposit",
    },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: {
      salonId: "main",
      id: "payment-deposit-repeat",
      bookingId: "booking-deposit",
      method: "cash",
      amountHalalas: 2500,
      idempotencyKey: "booking-deposit:deposit",
    },
  }), env(fake));
  const repeat = await json(response);
  assert.equal(response.status, 200, JSON.stringify(repeat));
  assert.equal(repeat.data.idempotent, true);
  assert.equal(fake.find("invoices", "main", "invoice-deposit").paid_halalas, 2500);
  assert.equal(fake.find("invoices", "main", "invoice-deposit").status, "partial");
  assert.equal(fake.find("bookings", "main", "booking-deposit").payment_status, "partial");
  assert.equal(fake.rows("payments").length, 1);
  assert.equal(fake.rows("income_entries").length, 1);
});

test("mixed booking payments create independent payment and income rows", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  await createCoreBooking(fake, { id: "booking-mixed", invoiceId: "invoice-mixed" });

  for (const [id, method, amount] of [
    ["payment-mixed-cash", "cash", 3000],
    ["payment-mixed-card", "card", 4500],
  ]) {
    const response = await worker.fetch(request("/api/core/payments", {
      method: "POST",
      body: {
        salonId: "main",
        id,
        bookingId: "booking-mixed",
        method,
        amountHalalas: amount,
        idempotencyKey: `booking-mixed:${method}:${amount}`,
      },
    }), env(fake));
    assert.equal(response.status, 200, JSON.stringify(await json(response)));
  }

  const repeat = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: {
      salonId: "main",
      id: "payment-mixed-card-repeat",
      bookingId: "booking-mixed",
      method: "card",
      amountHalalas: 4500,
      idempotencyKey: "booking-mixed:card:4500",
    },
  }), env(fake));
  assert.equal(repeat.status, 200, JSON.stringify(await json(repeat)));

  assert.equal(fake.rows("payments").length, 2);
  assert.equal(fake.rows("income_entries").length, 2);
  assert.deepEqual(
    fake.rows("income_entries").map((row) => [row.method, row.amount_halalas, row.source]).sort(),
    [["card", 4500, "booking"], ["cash", 3000, "booking"]]
  );
  assert.deepEqual(
    fake.rows("payments").map((row) => [row.method, row.amount_halalas]).sort(),
    [["card", 4500], ["cash", 3000]]
  );
  assert.equal(fake.find("invoices", "main", "invoice-mixed").paid_halalas, 7500);
  assert.equal(fake.find("invoices", "main", "invoice-mixed").status, "paid");
  assert.equal(fake.find("bookings", "main", "booking-mixed").payment_status, "paid");
});

test("payment batch failure rolls back and retry succeeds without duplicate rows", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  await createCoreBooking(fake, { id: "booking-retry", invoiceId: "invoice-retry" });

  fake.failBatchOnSqlIncludes = "INSERT INTO income_entries";
  const originalConsoleError = console.error;
  console.error = (...args) => {
    if (String(args[0] || "").includes("core-worker unhandled error")) return;
    originalConsoleError(...args);
  };
  const failed = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: {
      salonId: "main",
      id: "payment-retry",
      bookingId: "booking-retry",
      method: "cash",
      amountHalalas: 7500,
      idempotencyKey: "booking-retry:cash",
    },
  }), env(fake)).finally(() => {
    console.error = originalConsoleError;
  });
  assert.notEqual(failed.status, 200);
  assert.equal(fake.rows("payments").length, 0);
  assert.equal(fake.rows("income_entries").length, 0);
  assert.equal(Number(fake.find("invoices", "main", "invoice-retry").paid_halalas), 0);
  assert.equal(fake.find("bookings", "main", "booking-retry").payment_status, "unpaid");

  const retried = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: {
      salonId: "main",
      id: "payment-retry",
      bookingId: "booking-retry",
      method: "cash",
      amountHalalas: 7500,
      idempotencyKey: "booking-retry:cash",
    },
  }), env(fake));
  assert.equal(retried.status, 200, JSON.stringify(await json(retried)));
  assert.equal(fake.rows("payments").length, 1);
  assert.equal(fake.rows("income_entries").length, 1);
  assert.equal(fake.find("invoices", "main", "invoice-retry").status, "paid");
  assert.equal(fake.find("bookings", "main", "booking-retry").payment_status, "paid");
});

test("expense creation and patch use D1", async () => {
  const fake = new FakeD1();
  let response = await worker.fetch(request("/api/core/expenses", {
    method: "POST",
    body: { salonId: "main", id: "expense-a", amountHalalas: 1200, category: "supplies" },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  response = await worker.fetch(request("/api/core/expenses/expense-a", {
    method: "PATCH",
    body: { salonId: "main", description: "Towels" },
  }), env(fake));
  body = await json(response);
  assert.equal(body.data.description, "Towels");
});

test("offer CRUD, usage and audit use Core D1", async () => {
  const fake = new FakeD1();
  let response = await worker.fetch(request("/api/core/discounts", {
    method: "POST",
    body: { salonId: "main", id: "offer-a", name: "Summer", code: "save10", type: "percent", value: 10 },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.code_key, "SAVE10");

  response = await worker.fetch(request("/api/core/discounts/offer-a", {
    method: "PATCH",
    body: { salonId: "main", active: false },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.active, 0);

  response = await worker.fetch(request("/api/core/discounts/offer-a/use", {
    method: "POST",
    token: "",
    body: { salonId: "main" },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.used_count, 1);
  assert.ok(fake.rows("audit_logs").some((row) => row.action === "offer_used"));
});

test("catalog sections and categories use Core D1", async () => {
  const fake = new FakeD1();
  let response = await worker.fetch(request("/api/core/sections", {
    method: "POST",
    body: { salonId: "main", id: "section-a", name: "Hair", sortOrder: 1 },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.name, "Hair");

  response = await worker.fetch(request("/api/core/categories", {
    method: "POST",
    body: { salonId: "main", id: "category-a", name: "Color" },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));

  response = await worker.fetch(request("/api/core/sections", { token: "" }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.length, 1);
});

test("income supports patch and delete with D1 audit", async () => {
  const fake = new FakeD1();
  let response = await worker.fetch(request("/api/core/income", {
    method: "POST",
    body: { salonId: "main", id: "income-a", amountHalalas: 5000, method: "cash", clientName: "Client A" },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/income/income-a", {
    method: "PATCH",
    body: { salonId: "main", note: "updated" },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.note, "updated");

  response = await worker.fetch(request("/api/core/income/income-a", { method: "DELETE" }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.deleted, true);
  assert.equal(fake.rows("income_entries").length, 0);
});

test("refund is idempotent and adjusts invoice paid total", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  fake.seed("invoices", { id: "invoice-r", salon_id: "main", booking_id: "booking-r", client_id: "client-a", total_halalas: 10000, paid_halalas: 10000, status: "paid", updated_at: "2027-01-01T00:00:00.000Z" });
  fake.seed("payments", { id: "payment-r", salon_id: "main", invoice_id: "invoice-r", booking_id: "booking-r", client_id: "client-a", method: "card", amount_halalas: 10000, status: "completed" });

  const payload = { salonId: "main", id: "refund-a", paymentId: "payment-r", amountHalalas: 2500, idempotencyKey: "refund-key" };
  let response = await worker.fetch(request("/api/core/refunds", { method: "POST", body: payload }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(fake.find("invoices", "main", "invoice-r").paid_halalas, 7500);
  assert.equal(fake.find("invoices", "main", "invoice-r").status, "partial");

  response = await worker.fetch(request("/api/core/refunds", { method: "POST", body: { ...payload, id: "refund-b" } }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.idempotent, true);
  assert.equal(fake.rows("refunds").length, 1);

  response = await worker.fetch(request("/api/core/refunds/refund-a", { method: "PATCH", body: { amountHalalas: 3000, reason: "updated" } }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.amount_halalas, 3000);
  assert.equal(fake.find("invoices", "main", "invoice-r").paid_halalas, 7000);

  response = await worker.fetch(request("/api/core/refunds/refund-a", { method: "DELETE" }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "voided");
  assert.equal(fake.find("invoices", "main", "invoice-r").paid_halalas, 10000);
  assert.equal(fake.rows("expense_entries").filter((row) => row.source_ref_id === "refund-a").length, 0);
});

test("booking delete hides paid bookings while preserving financial records", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const booking = {
    id: "booking-delete",
    public_id: "QS-270110-DELETE01",
    salon_id: "main",
    client_id: "client-a",
    staff_id: "staff-a",
    booking_date: "2027-01-10",
    start_time: "10:00",
    end_time: "10:30",
    status: "booked",
    source: "test",
    notes: null,
    subtotal_halalas: 7500,
    discount_halalas: 0,
    total_halalas: 7500,
    payment_status: "paid",
    package_sessions_used: 0,
    created_by_uid: "owner1",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
    deleted_at: null,
  };
  fake.seed("bookings", booking);
  fake.seed("booking_items", {
    id: "item-delete",
    salon_id: "main",
    booking_id: booking.id,
    service_id: "svc-a",
    service_name_snapshot: "Service A",
    created_at: booking.created_at,
  });
  fake.seed("invoices", {
    id: "invoice-delete",
    salon_id: "main",
    booking_id: booking.id,
    client_id: "client-a",
    total_halalas: 7500,
    paid_halalas: 7500,
    status: "paid",
  });
  fake.seed("payments", {
    id: "payment-delete",
    salon_id: "main",
    booking_id: booking.id,
    invoice_id: "invoice-delete",
    amount_halalas: 7500,
    status: "paid",
  });
  fake.seed("income_entries", {
    id: "income-delete",
    salon_id: "main",
    booking_id: booking.id,
    invoice_id: "invoice-delete",
    payment_id: "payment-delete",
    amount_halalas: 7500,
  });

  const response = await worker.fetch(
    request(`/api/core/bookings/${booking.id}`, { method: "DELETE" }),
    env(fake)
  );
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.deleted, true);
  assert.equal(body.data.mode, "soft");
  assert.equal(body.data.financialRecordsPreserved, true);

  const stored = fake.find("bookings", "main", booking.id);
  assert.ok(stored?.deleted_at);
  assert.equal(stored.status, "cancelled");
  assert.equal(fake.rows("payments").length, 1);
  assert.equal(fake.rows("income_entries").length, 1);
  assert.equal(fake.rows("invoices").length, 1);
  assert.equal(fake.rows("booking_items").length, 1);

  const listResponse = await worker.fetch(request("/api/core/bookings"), env(fake));
  const listBody = await json(listResponse);
  assert.equal(listResponse.status, 200, JSON.stringify(listBody));
  assert.equal(listBody.data.some((row) => row.id === booking.id), false);
  assert.ok(fake.rows("audit_logs").some((row) => row.action === "booking_deleted"));
});

test("audit endpoint lists Core D1 audit rows", async () => {
  const fake = new FakeD1();
  fake.seed("audit_logs", { id: "audit-a", salon_id: "main", action: "test_action", entity_type: "booking", entity_id: "booking-a", created_at: "2027-01-01T00:00:00.000Z" });
  const response = await worker.fetch(request("/api/core/audit?entityType=booking"), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].action, "test_action");
});

test("core migration dry-run parses fixture and prints counts", () => {
  const result = spawnSync(process.execPath, [
    "scripts/migrate-core-firestore-to-d1.mjs",
    "--input=scripts/fixtures/core-migration-fixture.json",
    "--today=2026-07-16",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /dry-run only/);
  assert.match(result.stdout, /clients/);
  assert.match(result.stdout, /payments/);
});

test("core migration dry-run resolves client, slot lock, and QS953 conflicts without blocking", () => {
  const result = spawnSync(process.execPath, [
    "scripts/migrate-core-firestore-to-d1.mjs",
    "--input=scripts/fixtures/core-migration-conflicts-fixture.json",
    "--today=2026-07-16",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /blockingConflicts = 0/);
  assert.match(result.stdout, /warningConflicts = \d+/);
  assert.match(stripVTControlCharacters(result.stdout), /booking_slot_locks\s+│ 6/);
  assert.match(result.stdout, /slotLocksSkippedPast = 6/);
  assert.match(result.stdout, /mergedClients = 1/);
  assert.match(result.stdout, /client-legacy/);
  assert.match(result.stdout, /client-canonical/);
  assert.match(result.stdout, /QS953/);
  assert.match(result.stdout, /discount-qs953-active/);
  assert.match(result.stdout, /QS953_LEGACY_/);
});

test("shared client canonicalization keeps active package client ids canonical", () => {
  const fixture = JSON.parse(readFileSync("scripts/fixtures/client-canonicalization-regression-fixture.json", "utf8"));
  const policy = buildClientCanonicalization({
    salonId: "main",
    now: "2026-07-16T00:00:00.000Z",
    asOfDate: "2026-07-16",
    clients: fixture.clients,
    bookings: fixture.bookings,
    clientPackages: fixture.client_packages,
  });

  assert.equal(policy.blockingConflicts.length, 0, JSON.stringify(policy.blockingConflicts));
  assert.equal(policy.resolveClientId("0556209042"), "3be178a6-dacb-5407-aca0-1215f403631e");
  assert.equal(policy.resolveClientId("rodina-old-doc"), "3be178a6-dacb-5407-aca0-1215f403631e");
  assert.equal(policy.resolveClientId("0546640401"), "78967b2b-d2d1-4260-adac-95fac142ee9d");
  assert.equal(policy.resolveClientId("3be178a6-dacb-5407-aca0-1215f403631e"), "3be178a6-dacb-5407-aca0-1215f403631e");
  assert.equal(policy.resolveClientId("78967b2b-d2d1-4260-adac-95fac142ee9d"), "78967b2b-d2d1-4260-adac-95fac142ee9d");
  assert.ok(policy.aliases.some((row) => row.alias_id === "0556209042" && row.canonical_client_id === "3be178a6-dacb-5407-aca0-1215f403631e"));
  assert.ok(policy.aliases.some((row) => row.alias_id === "0546640401" && row.canonical_client_id === "78967b2b-d2d1-4260-adac-95fac142ee9d"));
  assert.equal(policy.resolveClientId("tia8CSOIfZfD60LTuPa90cdnI0L2"), "");
  assert.equal(policy.resolveClientId("EkAxHGHMMBfD11OCDP1XavS9KA43"), "");
});

test("shared client canonicalization treats verified alias conflicts as blocking", () => {
  const fixture = JSON.parse(readFileSync("scripts/fixtures/client-alias-blocking-fixture.json", "utf8"));
  const policy = buildClientCanonicalization({
    salonId: "main",
    now: "2026-07-16T00:00:00.000Z",
    asOfDate: "2026-07-16",
    clients: fixture.clients,
  });

  assert.equal(policy.blockingConflicts.length, 1);
  assert.equal(policy.blockingConflicts[0].type, "client_alias_conflict");
  assert.equal(policy.blockingConflicts[0].alias, "shared-verified-uid");
});

test("core migration dry-run preserves package-backed canonical clients and reports slot lock buckets", () => {
  const result = spawnSync(process.execPath, [
    "scripts/migrate-core-firestore-to-d1.mjs",
    "--input=scripts/fixtures/client-canonicalization-regression-fixture.json",
    "--today=2026-07-16",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /blockingConflicts = 0/);
  assert.doesNotMatch(result.stdout, /client_alias_conflict/);
  assert.match(result.stdout, /3be178a6-dacb-5407-aca0-1215f403631e/);
  assert.match(result.stdout, /78967b2b-d2d1-4260-adac-95fac142ee9d/);
  assert.match(result.stdout, /asOfDate = 2026-07-16/);
  assert.match(result.stdout, /slotLocksGeneratedActiveFuture = 18/);
  assert.match(result.stdout, /slotLocksSkippedPast = 36/);
  assert.match(result.stdout, /slotLocksSkippedTerminalStatus = 6/);
  assert.match(result.stdout, /slotLocksSkippedInvalid = 1/);
  assert.match(result.stdout, /bookingClientsResolvedCanonical = 1/);
  assert.match(result.stdout, /bookingClientsResolvedByPhone = 4/);
  assert.match(result.stdout, /bookingLegacyClientsCreated = 6/);
  assert.match(result.stdout, /bookingClientsUnresolved = 0/);
  assert.match(result.stdout, /legacy_booking_client_booking-no-client-no-known-phone/);
});

test("core migration SQL never emits NULL or dangling booking client ids", () => {
  const result = spawnSync(process.execPath, [
    "scripts/migrate-core-firestore-to-d1.mjs",
    "--input=scripts/fixtures/client-canonicalization-regression-fixture.json",
    "--today=2026-07-16",
    "--dump-sql",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const sqlLines = result.stdout.split(/\r?\n/).filter((line) => line.startsWith("INSERT OR REPLACE INTO "));
  const clientIds = new Set(
    sqlLines
      .filter((line) => line.startsWith("INSERT OR REPLACE INTO clients "))
      .flatMap(parseInsertRows)
      .map((row) => row.id)
      .filter(Boolean)
  );
  const bookings = sqlLines
    .filter((line) => line.startsWith("INSERT OR REPLACE INTO bookings "))
    .flatMap(parseInsertRows);

  assert.ok(bookings.length > 0);
  for (const booking of bookings) {
    assert.ok(booking.client_id, `missing client_id for ${booking.id}`);
    assert.notEqual(booking.client_id, "NULL");
    assert.ok(clientIds.has(booking.client_id), `dangling client_id ${booking.client_id} for ${booking.id}`);
  }
});

test("core migration snapshot-out then snapshot-in produces stable SQL and SHA-256", () => {
  const directory = mkdtempSync(join(tmpdir(), "core-migration-snapshot-"));
  const snapshotPath = join(directory, "core-source.json");
  const firstSqlPath = join(directory, "first.sql");
  const secondSqlPath = join(directory, "second.sql");
  try {
    const first = spawnSync(process.execPath, [
      "scripts/migrate-core-firestore-to-d1.mjs",
      "--input=scripts/fixtures/client-canonicalization-regression-fixture.json",
      "--today=2026-07-16",
      `--snapshot-out=${snapshotPath}`,
      `--sql-out=${firstSqlPath}`,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.match(first.stdout, /snapshotOut = /);
    assert.match(first.stdout, /sqlSha256 = [a-f0-9]{64}/);
    assert.match(first.stdout, /blockingConflicts = 0/);

    const second = spawnSync(process.execPath, [
      "scripts/migrate-core-firestore-to-d1.mjs",
      `--snapshot-in=${snapshotPath}`,
      `--sql-out=${secondSqlPath}`,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(second.stdout, /core migration source snapshot-in/);
    assert.match(second.stdout, /blockingConflicts = 0/);

    const firstSha = /sqlSha256 = ([a-f0-9]{64})/.exec(first.stdout)?.[1];
    const secondSha = /sqlSha256 = ([a-f0-9]{64})/.exec(second.stdout)?.[1];
    assert.equal(firstSha, secondSha);
    assert.equal(readFileSync(firstSqlPath, "utf8"), readFileSync(secondSqlPath, "utf8"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("core migration local validation detects orphan booking clients", () => {
  const validation = validateLocalImportReport({
    expectedCounts: { clients: 1, bookings: 1 },
    queryRows: fakeLocalValidationQueryRows({
      counts: { clients: 1, bookings: 1 },
      danglingBookingClients: 1,
    }),
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => failure.check === "booking_clients_exist"));
});

test("core migration local validation detects count mismatches", () => {
  const validation = validateLocalImportReport({
    expectedCounts: { clients: 2, bookings: 0 },
    queryRows: fakeLocalValidationQueryRows({
      counts: { clients: 1, bookings: 0 },
    }),
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => failure.check === "count:clients"));
});

test("core migration local validation passes when counts and orphan checks are clean", () => {
  const validation = validateLocalImportReport({
    expectedCounts: { clients: 1, bookings: 0, booking_items: 0 },
    queryRows: fakeLocalValidationQueryRows({
      counts: { clients: 1, bookings: 0, booking_items: 0 },
    }),
    requiredClientIds: [{ id: "client-a", label: "client-a" }],
    packageCanonicalMappings: [{ clientPackageId: "pkg-a", canonicalClientId: "client-a" }],
  });

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
});

test("core migration reports oversized single-row SQL as blocking preflight data", () => {
  const artifact = buildSqlArtifact({
    clients: [{
      id: `huge-client-${"x".repeat(61000)}`,
      salon_id: "main",
      name: "Huge Client",
      phone_normalized: "",
      email: "",
      firebase_uid: "",
      status: "active",
      notes: "",
      vip: 0,
      legacy_client_doc_id: "",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }],
  });

  assert.equal(artifact.report.oversizedRows.length, 1);
  assert.equal(artifact.report.oversizedRows[0].type, "sql_row_too_large");
  assert.equal(artifact.report.oversizedRows[0].table, "clients");
  assert.match(artifact.report.oversizedRows[0].rowId, /^huge-client-/);
  assert.ok(artifact.report.oversizedRows[0].statementBytes > 60000);
});

test("core migration preserves large text fields with bounded row-local updates", () => {
  const artifact = buildSqlArtifact({
    discounts: [{
      id: "discount-large-image",
      salon_id: "main",
      code: "BIGIMG",
      name: "Big image",
      type: "fixed",
      value: 10,
      active: 1,
      starts_at: "2026-01-01",
      ends_at: "2026-12-31",
      usage_limit: null,
      used_count: 0,
      code_key: "BIGIMG",
      applies_to: "all",
      service_ids_json: "[]",
      sequence_steps_json: "[]",
      image_url: `data:image/png;base64,${"a".repeat(180000)}`,
      deleted_at: "",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }],
  });

  assert.equal(artifact.report.oversizedRows.length, 0, JSON.stringify(artifact.report.oversizedRows));
  assert.ok(artifact.sql.includes("INSERT OR REPLACE INTO discounts"));
  assert.ok(artifact.sql.includes("UPDATE discounts SET image_url = COALESCE(image_url, '') ||"));
  for (const statement of artifact.sql.split(/\n/).filter(Boolean)) {
    assert.ok(Buffer.byteLength(statement, "utf8") <= 60000, "statement exceeded 60KB");
  }
});

test("core apply-local persistence directory is cleaned before reuse", () => {
  const persistDir = join(process.cwd(), ".migration-work", "d1-local");
  const staleFile = join(persistDir, "stale.txt");
  mkdirSync(persistDir, { recursive: true });
  writeFileSync(staleFile, "stale", "utf8");

  const prepared = prepareLocalD1PersistDirectory();

  assert.equal(prepared, persistDir);
  assert.equal(existsSync(staleFile), false);
  assert.equal(existsSync(prepared), true);
});

test("core migration emits one bounded INSERT statement per row", () => {
  const directory = mkdtempSync(join(tmpdir(), "core-migration-large-"));
  const inputPath = join(directory, "large-fixture.json");
  try {
    const clients = Array.from({ length: 1205 }, (_, index) => {
      const id = `large-client-${String(index).padStart(4, "0")}`;
      return {
        id,
        name: `Large Client ${index}`,
        phone: `05${String(10000000 + index).slice(0, 8)}`,
        firebaseUid: `large-alias-${String(index).padStart(4, "0")}`,
        notes: JSON.stringify({
          source: "sql-single-row-regression",
          index,
          metadata: "x".repeat(1800),
        }),
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    });
    writeFileSync(inputPath, JSON.stringify({ clients, bookings: [] }), "utf8");

    const result = spawnSync(process.execPath, [
      "scripts/migrate-core-firestore-to-d1.mjs",
      `--input=${inputPath}`,
      "--today=2026-07-16",
      "--dump-sql",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /blockingConflicts = 0/);
    assert.match(stripVTControlCharacters(result.stdout), /clients\s+[^0-9]+1205/);
    assert.doesNotMatch(result.stdout, /BEGIN TRANSACTION|COMMIT;/);
    assert.match(result.stdout, /statementsPerTable/);
    const largest = Number(/largestStatementBytes = (\d+)/.exec(result.stdout)?.[1] || 0);
    assert.ok(largest > 0, "missing largestStatementBytes");
    assert.ok(largest <= 60000, `largest statement was ${largest}`);
    const statements = result.stdout
      .split(/\r?\n/)
      .filter((line) => /^INSERT OR REPLACE /.test(line));
    assert.ok(statements.length > 1);
    for (const statement of statements) {
      assert.ok(Buffer.byteLength(statement, "utf8") <= 60000, "statement exceeded 60KB");
      assert.equal(parseInsertRows(statement).length, 1, "statement contained multiple rows");
    }
    const clientStatements = statements.filter((line) => line.startsWith("INSERT OR REPLACE INTO clients "));
    const aliasStatements = statements.filter((line) => line.startsWith("INSERT OR REPLACE INTO client_aliases "));
    assert.equal(clientStatements.length, 1205);
    assert.ok(aliasStatements.length >= 1205);
    for (let index = 0; index < clients.length; index += 1) {
      const id = `large-client-${String(index).padStart(4, "0")}`;
      const alias = `large-alias-${String(index).padStart(4, "0")}`;
      assert.match(result.stdout, new RegExp(id));
      assert.match(result.stdout, new RegExp(alias));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("core migration dry-run reports verified alias conflicts as blocking", () => {
  const result = spawnSync(process.execPath, [
    "scripts/migrate-core-firestore-to-d1.mjs",
    "--input=scripts/fixtures/client-alias-blocking-fixture.json",
    "--today=2026-07-16",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /blockingConflicts = 1/);
  assert.match(result.stdout, /client_alias_conflict/);
  assert.match(result.stdout, /shared-verified-uid/);
});

test("availability endpoint returns D1 slot locks and booking metadata", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  fake.seed("staff_schedules", {
    id: "schedule-a",
    salon_id: "main",
    staff_id: "staff-a",
    weekday: 0,
    start_time: "09:00",
    end_time: "18:00",
    active: 1,
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });

  const created = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-availability",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:00",
      slotStepMin: 10,
      items: [{ id: "item-availability", serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(created.status, 200, JSON.stringify(await json(created)));

  const response = await worker.fetch(request(
    "/api/core/availability?staffId=staff-a&date=2027-01-10&slotStepMin=10"
  ), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.data.lockedTimes, ["10:00", "10:05", "10:10", "10:15", "10:20", "10:25"]);
  assert.deepEqual(body.data.takenTimes, ["10:00", "10:10", "10:20"]);
  assert.equal(body.data.bookedSlots["10:00"].bookingId, "booking-availability");
  assert.equal(body.data.scheduleWindows[0].startTime, "09:00");
  assert.equal(body.data.availableForDate, true);
});


test("availability projects five-minute locks onto the requested UI slot grid", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const created = await worker.fetch(
    request("/api/core/bookings", {
      method: "POST",
      body: {
        salonId: "main",
        id: "booking-five-minute-grid",
        clientId: "client-a",
        staffId: "staff-a",
        bookingDate: "2027-01-10",
        startTime: "10:05",
        slotStepMin: 5,
        items: [{ serviceId: "svc-a" }],
      },
    }),
    env(fake)
  );
  assert.equal(created.status, 200, JSON.stringify(await json(created)));
  assert.equal(fake.rows("booking_slot_locks").length, 6);

  const availability = await worker.fetch(
    request("/api/core/availability?staffId=staff-a&date=2027-01-10&slotStepMin=10"),
    env(fake)
  );
  const body = await json(availability);
  assert.equal(availability.status, 200, JSON.stringify(body));
  assert.deepEqual(body.data.lockedTimes, ["10:05", "10:10", "10:15", "10:20", "10:25", "10:30"]);
  assert.deepEqual(body.data.takenTimes, ["10:10", "10:20", "10:30"]);
});

test("overlapping ranges are rejected while adjacent ranges are allowed", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const first = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-range-a",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:00",
      items: [{ serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(first.status, 200, JSON.stringify(await json(first)));

  const overlap = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-range-overlap",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:20",
      items: [{ serviceId: "svc-a" }],
    },
  }), env(fake));
  const overlapBody = await json(overlap);
  assert.equal(overlap.status, 409, JSON.stringify(overlapBody));
  assert.equal(overlapBody.error, "core_booking:staff_slot_conflict");

  const adjacent = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-range-adjacent",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:30",
      items: [{ serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(adjacent.status, 200, JSON.stringify(await json(adjacent)));
});

test("cancelling a booking releases D1 slot locks", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  let response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-release-a",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "11:00",
      items: [{ serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
  assert.equal(fake.rows("booking_slot_locks").length, 6);

  response = await worker.fetch(request("/api/core/bookings/booking-release-a/cancel", {
    method: "POST",
    body: { salonId: "main", reason: "client request" },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
  assert.equal(fake.rows("booking_slot_locks").length, 0);

  response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-release-b",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "11:00",
      items: [{ serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
});

test("multi-item booking preserves each item date and time", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-group-a",
      clientId: "client-a",
      bookingDate: "2027-01-10",
      startTime: "12:00",
      slotStepMin: 10,
      items: [
        {
          id: "group-item-a",
          cartItemId: "cart-a",
          serviceId: "svc-a",
          staffId: "staff-a",
          bookingDate: "2027-01-10",
          startTime: "12:00",
        },
        {
          id: "group-item-b",
          cartItemId: "cart-b",
          serviceId: "svc-a",
          staffId: "staff-a",
          bookingDate: "2027-01-11",
          startTime: "14:00",
        },
      ],
    },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.items[0].booking_date, "2027-01-10");
  assert.equal(body.data.items[0].start_time, "12:00");
  assert.equal(body.data.items[1].booking_date, "2027-01-11");
  assert.equal(body.data.items[1].start_time, "14:00");
  assert.equal(body.data.items[1].cart_item_id, "cart-b");
});

test("booking creation is idempotent when the same booking id is retried", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const payload = {
    salonId: "main",
    id: "booking-idempotent",
    clientId: "client-a",
    staffId: "staff-a",
    bookingDate: "2027-01-10",
    startTime: "15:00",
    items: [{ id: "item-idempotent", serviceId: "svc-a" }],
  };
  const first = await worker.fetch(
    request("/api/core/bookings", { method: "POST", body: payload }),
    env(fake)
  );
  const second = await worker.fetch(
    request("/api/core/bookings", { method: "POST", body: payload }),
    env(fake)
  );
  assert.equal(first.status, 200, JSON.stringify(await json(first)));
  assert.equal(second.status, 200, JSON.stringify(await json(second)));
  assert.equal(fake.rows("bookings").length, 1);
  assert.equal(fake.rows("booking_slot_locks").length, 6);
});

test("booking creation rejects starts that are not aligned to the configured slot step", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const response = await worker.fetch(
    request("/api/core/bookings", {
      method: "POST",
      body: {
        salonId: "main",
        id: "booking-misaligned",
        clientId: "client-a",
        staffId: "staff-a",
        bookingDate: "2027-01-10",
        startTime: "10:05",
        slotStepMin: 10,
        items: [{ serviceId: "svc-a" }],
      },
    }),
    env(fake)
  );
  const body = await json(response);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(body.error, "core_booking:invalid_slot_alignment");
});

test("staff leave blocks booking and is exposed by availability", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  fake.seed("staff", {
    ...fake.find("staff", "main", "staff-a"),
    leave_start_date: "2027-01-09",
    leave_end_date: "2027-01-11",
    leave_note: "annual leave",
    show_on_booking: 1,
  });

  const availability = await worker.fetch(
    request("/api/core/availability?staffId=staff-a&date=2027-01-10"),
    env(fake)
  );
  const availabilityBody = await json(availability);
  assert.equal(availability.status, 200, JSON.stringify(availabilityBody));
  assert.equal(availabilityBody.data.onLeave, true);
  assert.equal(availabilityBody.data.availableForDate, false);

  const response = await worker.fetch(
    request("/api/core/bookings", {
      method: "POST",
      body: {
        salonId: "main",
        id: "booking-leave",
        clientId: "client-a",
        staffId: "staff-a",
        bookingDate: "2027-01-10",
        startTime: "16:00",
        items: [{ serviceId: "svc-a" }],
      },
    }),
    env(fake)
  );
  const body = await json(response);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(body.error, "core_booking:staff_unavailable");
});
