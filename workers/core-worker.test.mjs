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
import { resolveStaffBookingDay } from "./core/repositories/booking-staff-policy.js";

class FakeD1 {
  constructor() {
    this.__fakeD1 = true;
    this.failBatchOnSqlIncludes = "";
    this.allQueryCount = 0;
    this.allQueries = [];
    this.tables = Object.fromEntries([
      "clients",
      "client_aliases",
      "services",
      "service_categories",
      "staff",
      "staff_services",
      "staff_schedules",
      "hr_work_schedules",
      "hr_schedule_exceptions",
      "hr_shift_assignments",
      "hr_shift_templates",
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
      "roles",
      "permissions",
      "role_permissions",
      "app_users",
      "user_permissions",
      "user_employee_links",
      "employee_profiles",
      "employee_employment",
      "attendance_records",
      "employee_leaves",
      "employee_absences",
      "payroll_periods",
      "payroll_entries",
      "salary_advances",
      "salary_advance_installments",
      "employee_recurring_deductions",
      "employee_payroll_obligations",
      "employee_payroll_obligation_installments",
      "employee_overtime_records",
      "employee_target_plans",
      "employee_target_tiers",
      "employee_target_assignments",
      "employee_target_ledger",
    ].map((table) => [table, new Map()]));
    this.seedIdentity();
  }

  key(table, row) {
    if (table === "client_aliases") return `${row.salon_id}\u0000${row.alias_id}`;
    if (table === "staff_services") return `${row.salon_id}\u0000${row.staff_id}\u0000${row.service_id}`;
    if (table === "booking_slot_locks") return `${row.salon_id}\u0000${row.staff_id}\u0000${row.booking_date}\u0000${row.slot_time}`;
    if (table === "roles") return `${row.salon_id}\u0000${row.role_key}`;
    if (table === "role_permissions") return `${row.salon_id}\u0000${row.role_key}\u0000${row.permission_key}`;
    if (table === "user_employee_links") return `${row.salon_id}\u0000${row.id}`;
    if (table === "employee_profiles") return `${row.salon_id}\u0000${row.id}`;
    if (table === "employee_employment") return `${row.salon_id}\u0000${row.employee_id}`;
    return row.id;
  }

  seedIdentity() {
    const now = "2027-01-01T00:00:00.000Z";
    const roleRows = [
      ["owner", 100],
      ["admin", 80],
      ["hr", 60],
      ["accountant", 55],
      ["reception", 40],
      ["staff", 30],
      ["pending", 10],
      ["client", 5],
      ["guest", 0],
    ];
    for (const [role_key, rank] of roleRows) {
      this.seed("roles", { id: role_key, salon_id: "main", role_key, label: role_key, rank, protected: role_key === "owner" ? 1 : 0, assignable: role_key !== "guest" ? 1 : 0, created_at: now, updated_at: now });
    }
    const permissionKeys = [
      "accounts.read",
      "accounts.create",
      "accounts.update",
      "accounts.disable",
      "accounts.restore",
      "accounts.delete",
      "accounts.reset_password",
      "roles.read",
      "roles.assign",
      "roles.manage",
      "permissions.read",
      "permissions.manage",
      "employee_links.read",
      "employee_links.manage",
      "audit.read",
      "admin_accounts.view",
      "admin_accounts.manage",
      "bookings.view",
      "bookings.create",
      "bookings.update",
      "bookings.cancel",
      "bookings.payment.manage",
      "bookings.delete",
      "income.view",
      "income.manage",
      "finance.view",
      "finance.manage",
      "reports.view",
      "payroll.view",
      "payroll.manage",
      "targets.view",
      "targets.view_all",
      "targets.view_own",
      "targets.manage",
    ];
    for (const permission_key of permissionKeys) {
      this.seed("permissions", { permission_key, group_key: permission_key.split(".")[0], label: permission_key, description: "", sensitive: permission_key.includes("delete") ? 1 : 0, created_at: now, updated_at: now });
    }
    const grantRole = (role_key, permissions) => {
      for (const permission_key of permissions) {
        this.seed("role_permissions", { salon_id: "main", role_key, permission_key, created_at: now });
      }
    };
    grantRole("admin", permissionKeys.filter((key) => !["accounts.delete", "permissions.manage", "roles.manage"].includes(key)));
    grantRole("hr", ["accounts.read", "accounts.update", "roles.read", "permissions.read", "employee_links.read", "employee_links.manage", "admin_accounts.view"]);
    grantRole("accountant", ["finance.view", "finance.manage", "income.view", "income.manage", "reports.view", "audit.read"]);
    grantRole("reception", ["admin_accounts.view", "bookings.view", "bookings.create", "bookings.update", "bookings.cancel", "bookings.payment.manage"]);
    grantRole("staff", ["bookings.view", "targets.view_own"]);

    const accounts = [
      ["user-owner1", "owner1", "owner@example.com", "Owner", "owner", "active"],
      ["user-admin1", "admin1", "admin@example.com", "Admin", "admin", "active"],
      ["user-hr1", "hr1", "hr@example.com", "HR", "hr", "active"],
      ["user-accountant1", "accountant1", "accountant@example.com", "Accountant", "accountant", "active"],
      ["user-reception1", "reception1", "reception@example.com", "Reception", "reception", "active"],
      ["user-staff1", "staff1", "staff@example.com", "Staff", "staff", "active"],
      ["user-client1", "client1", "client@example.com", "Client", "client", "active"],
      ["user-client-user", "client-user", "client-user@example.com", "Client User", "client", "active"],
    ];
    for (const [id, firebase_uid, email, display_name, primary_role, status] of accounts) {
      this.seed("app_users", {
        id,
        firebase_uid,
        salon_id: "main",
        email,
        phone: null,
        display_name,
        primary_role,
        status,
        email_verified: 1,
        last_login_at: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        legacy_source: "test",
        legacy_id: null,
      });
    }
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

  activeRecurringDeductions(salonId, employeeId, payrollMonth) {
    return this.rows("employee_recurring_deductions")
      .filter((row) =>
        row.salon_id === salonId &&
        (!employeeId || row.employee_id === employeeId) &&
        row.status === "active" &&
        row.start_payroll_month <= payrollMonth &&
        (!row.end_payroll_month || row.end_payroll_month >= payrollMonth)
      );
  }

  joinedPayrollObligationInstallments(salonId) {
    return this.rows("employee_payroll_obligation_installments")
      .map((installment) => {
        const obligation = this.find("employee_payroll_obligations", salonId, installment.obligation_id);
        if (!obligation || installment.salon_id !== salonId) return null;
        const recurring = obligation.recurring_deduction_id
          ? this.find("employee_recurring_deductions", salonId, obligation.recurring_deduction_id)
          : null;
        return {
          ...installment,
          employee_id: obligation.employee_id,
          recurring_deduction_id: obligation.recurring_deduction_id || null,
          obligation_kind: obligation.obligation_kind,
          obligation_source_type: obligation.source_type,
          obligation_source_ref: obligation.source_ref,
          original_payroll_month: obligation.original_payroll_month,
          obligation_reason: obligation.reason,
          obligation_note: obligation.note,
          obligation_status: obligation.status,
          recurring_title: recurring?.title || null,
        };
      })
      .filter(Boolean);
  }

  async first(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0] || null;
  }

  async all(sql, params = []) {
    this.allQueryCount += 1;
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.allQueries.push({ sql: normalized, params: [...params] });

    if (normalized.includes("FROM hr_schedule_exceptions e LEFT JOIN hr_shift_templates t")) {
      const [salonId, employeeId, dateFrom, dateTo] = params;
      return this.rows("hr_schedule_exceptions")
        .filter((row) =>
          row.salon_id === salonId &&
          row.employee_id === employeeId &&
          row.status === "approved" &&
          Number(row.enabled) === 1 &&
          row.date_from <= dateFrom &&
          row.date_to >= dateTo
        )
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
        .slice(0, 1)
        .map((row) => {
          const template = row.shift_template_id
            ? this.rows("hr_shift_templates").find((item) => item.id === row.shift_template_id)
            : null;
          return {
            ...row,
            shift_name: template?.name || null,
            template_start_time: template?.start_time || null,
            template_end_time: template?.end_time || null,
            crosses_midnight: template?.crosses_midnight || 0,
            break_minutes: template?.break_minutes || 0,
            late_grace_minutes: template?.late_grace_minutes || 0,
            early_leave_grace_minutes: 0,
            attendance_lock_enabled: template?.attendance_lock_enabled || 0,
            attendance_lock_after_minutes: template?.attendance_lock_after_minutes || 30,
            overtime_after_minutes: template?.overtime_after_minutes || 0,
          };
        });
    }

    if (normalized.includes("FROM hr_work_schedules s") && normalized.includes("LEFT JOIN hr_shift_templates t")) {
      const [salonId, employeeId, weekday, dateFrom, dateTo] = params;
      return this.rows("hr_work_schedules")
        .filter((row) =>
          row.salon_id === salonId &&
          row.employee_id === employeeId &&
          Number(row.weekday) === Number(weekday) &&
          (!row.effective_from || row.effective_from <= dateFrom) &&
          (!row.effective_to || row.effective_to >= dateTo)
        )
        .sort((a, b) => {
          const byFrom = String(b.effective_from || "0000-01-01").localeCompare(String(a.effective_from || "0000-01-01"));
          if (byFrom !== 0) return byFrom;
          return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
        })
        .slice(0, 1)
        .map((row) => {
          const template = row.shift_template_id
            ? this.rows("hr_shift_templates").find((item) => item.id === row.shift_template_id)
            : null;
          return {
            ...row,
            shift_name: template?.name || null,
            shift_code: template?.code || null,
            template_start_time: template?.start_time || null,
            template_end_time: template?.end_time || null,
            crosses_midnight: template?.crosses_midnight || 0,
            break_minutes: template?.break_minutes || 0,
            late_grace_minutes: template?.late_grace_minutes || 0,
            early_leave_grace_minutes: 0,
            attendance_lock_enabled: template?.attendance_lock_enabled || 0,
            attendance_lock_after_minutes: template?.attendance_lock_after_minutes || 30,
            overtime_after_minutes: template?.overtime_after_minutes || 0,
          };
        });
    }

    if (normalized.includes("FROM hr_shift_assignments a") && normalized.includes("LEFT JOIN hr_shift_templates t")) {
      const [salonId, employeeId, dateFrom, dateTo] = params;
      return this.rows("hr_shift_assignments")
        .filter((row) =>
          row.salon_id === salonId &&
          row.employee_id === employeeId &&
          row.status === "published" &&
          row.effective_from <= dateFrom &&
          (!row.effective_to || row.effective_to >= dateTo)
        )
        .sort((a, b) => String(b.effective_from || "").localeCompare(String(a.effective_from || "")))
        .slice(0, 1)
        .map((row) => {
          const template = row.shift_template_id
            ? this.rows("hr_shift_templates").find((item) => item.id === row.shift_template_id)
            : null;
          return {
            ...row,
            shift_name: template?.name || null,
            template_start_time: template?.start_time || null,
            template_end_time: template?.end_time || null,
            crosses_midnight: template?.crosses_midnight || 0,
            break_minutes: template?.break_minutes || 0,
            late_grace_minutes: template?.late_grace_minutes || 0,
            early_leave_grace_minutes: 0,
            attendance_lock_enabled: template?.attendance_lock_enabled || 0,
            attendance_lock_after_minutes: template?.attendance_lock_after_minutes || 30,
            overtime_after_minutes: template?.overtime_after_minutes || 0,
          };
        });
    }

    if (normalized.startsWith("SELECT e.*, p.name AS employee_name, p.status AS profile_status FROM employee_employment e")) {
      const [salonId, employeeId] = params;
      const employment = this.rows("employee_employment").find(
        (row) => row.salon_id === salonId && row.employee_id === employeeId
      );
      if (!employment) return [];
      const profile = this.rows("employee_profiles").find(
        (row) => row.salon_id === salonId && row.id === employeeId
      );
      if (!profile) return [];
      return [{
        ...employment,
        employee_name: profile.name,
        profile_status: profile.status,
      }];
    }
    if (normalized.startsWith("SELECT employee_id, MAX(has_profile) AS has_profile")) {
      const profileSalonId = params[0];
      const half = (params.length - 2) / 2;
      const profileIds = params.slice(1, 1 + half);
      const employmentSalonId = params[1 + half];
      const employmentIds = params.slice(2 + half);
      const wanted = new Set([...profileIds, ...employmentIds]);
      return Array.from(wanted)
        .map((employeeId) => {
          const profile = this.rows("employee_profiles").find(
            (row) => row.salon_id === profileSalonId && row.id === employeeId
          );
          const employment = this.rows("employee_employment").find(
            (row) => row.salon_id === employmentSalonId && row.employee_id === employeeId
          );
          if (!profile && !employment) return null;
          return {
            employee_id: employeeId,
            has_profile: profile ? 1 : 0,
            has_employment: employment ? 1 : 0,
            profile_status: profile?.status ?? null,
            employment_status: employment?.employment_status ?? null,
            end_date: employment?.end_date ?? null,
          };
        })
        .filter(Boolean);
    }
    if (normalized.startsWith("SELECT p.status AS profile_status, e.employment_status, e.end_date FROM employee_profiles p")) {
      const [salonId, employeeId] = params;
      const profile = this.rows("employee_profiles").find(
        (row) => row.salon_id === salonId && row.id === employeeId
      );
      if (!profile) return [];
      const employment = this.rows("employee_employment").find(
        (row) => row.salon_id === salonId && row.employee_id === employeeId
      );
      return [{
        profile_status: profile.status,
        employment_status: employment?.employment_status ?? null,
        end_date: employment?.end_date ?? null,
      }];
    }
    if (normalized.startsWith("SELECT p.id AS employee_id, p.status AS profile_status, e.employment_status, e.end_date FROM employee_profiles p")) {
      const salonId = params[0];
      const wanted = new Set(params.slice(1));
      return this.rows("employee_profiles")
        .filter((row) => row.salon_id === salonId && wanted.has(row.id))
        .map((profile) => {
          const employment = this.rows("employee_employment").find(
            (row) => row.salon_id === salonId && row.employee_id === profile.id
          );
          return {
            employee_id: profile.id,
            profile_status: profile.status,
            employment_status: employment?.employment_status ?? null,
            end_date: employment?.end_date ?? null,
          };
        });
    }
    if (normalized.startsWith("SELECT * FROM app_users WHERE salon_id = ? AND firebase_uid = ?")) {
      const [salonId, uid] = params;
      return this.rows("app_users").filter((row) => row.salon_id === salonId && row.firebase_uid === uid).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM app_users WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.rows("app_users").filter((row) => row.salon_id === salonId && row.id === id).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM app_users WHERE salon_id = ? AND email = ?")) {
      const [salonId, email] = params;
      return this.rows("app_users").filter((row) => row.salon_id === salonId && row.email === email).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM app_users WHERE salon_id = ?")) {
      const [salonId] = params;
      let rows = this.rows("app_users").filter((row) => row.salon_id === salonId);
      if (normalized.includes("status <> 'deleted'")) rows = rows.filter((row) => row.status !== "deleted" && !row.deleted_at);
      return rows;
    }
    if (normalized.startsWith("SELECT COUNT(*) AS count FROM app_users")) {
      const [salonId, excludeId] = params;
      return [{
        count: this.rows("app_users").filter((row) =>
          row.salon_id === salonId &&
          row.primary_role === "owner" &&
          row.status === "active" &&
          !row.deleted_at &&
          row.id !== excludeId
        ).length,
      }];
    }
    if (normalized === "SELECT * FROM permissions ORDER BY group_key, permission_key") {
      return this.rows("permissions").sort((a, b) => `${a.group_key}\u0000${a.permission_key}`.localeCompare(`${b.group_key}\u0000${b.permission_key}`));
    }
    if (normalized === "SELECT permission_key FROM permissions") {
      return this.rows("permissions").map((row) => ({ permission_key: row.permission_key }));
    }
    if (normalized === "SELECT COUNT(*) AS count FROM permissions") {
      return [{ count: this.rows("permissions").length }];
    }
    if (normalized.startsWith("SELECT * FROM roles WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("roles").filter((row) => row.salon_id === salonId).sort((a, b) => Number(b.rank || 0) - Number(a.rank || 0));
    }
    if (normalized.startsWith("SELECT role_key FROM roles WHERE salon_id = ? LIMIT 1")) {
      const [salonId] = params;
      return this.rows("roles").filter((row) => row.salon_id === salonId).slice(0, 1).map((row) => ({ role_key: row.role_key }));
    }
    if (normalized.startsWith("SELECT permission_key FROM role_permissions WHERE salon_id = ? AND role_key = ?")) {
      const [salonId, roleKey] = params;
      return this.rows("role_permissions")
        .filter((row) => row.salon_id === salonId && row.role_key === roleKey)
        .map((row) => ({ permission_key: row.permission_key }))
        .sort((a, b) => a.permission_key.localeCompare(b.permission_key));
    }
    if (normalized.startsWith("SELECT permission_key, effect FROM user_permissions WHERE salon_id = ? AND user_id = ?")) {
      const [salonId, userId] = params;
      return this.rows("user_permissions")
        .filter((row) => row.salon_id === salonId && row.user_id === userId)
        .map((row) => ({ permission_key: row.permission_key, effect: row.effect }))
        .sort((a, b) => a.permission_key.localeCompare(b.permission_key));
    }
    if (normalized.startsWith("SELECT l.*, ep.name AS employee_name")) {
      const [salonId, userId] = params;
      return this.rows("user_employee_links")
        .filter((row) => row.salon_id === salonId && row.user_id === userId && row.link_status === "active")
        .slice(0, 1)
        .map((row) => {
          const employee = this.find("employee_profiles", salonId, row.employee_id) || this.find("staff", salonId, row.employee_id) || {};
          return {
            ...row,
            employee_name: employee.name || "",
            employee_email: employee.email || "",
            employee_phone: employee.phone_normalized || "",
          };
        });
    }
    if (normalized.startsWith("SELECT id, name, email, phone_normalized FROM employee_profiles WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("employee_profiles", salonId, id) ? [this.find("employee_profiles", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT id, firebase_uid FROM employee_profiles WHERE salon_id = ? AND (id = ? OR firebase_uid = ? OR firebase_uid = ?)")) {
      const [salonId, id, uidA, uidB] = params;
      return this.rows("employee_profiles")
        .filter((row) =>
          row.salon_id === salonId &&
          (row.id === id || row.firebase_uid === uidA || row.firebase_uid === uidB)
        )
        .slice(0, 1)
        .map((row) => ({ id: row.id, firebase_uid: row.firebase_uid }));
    }
    if (normalized.startsWith("SELECT id, name, NULL AS email, phone_normalized FROM staff WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      const row = this.find("staff", salonId, id);
      return row ? [{ id: row.id, name: row.name, email: null, phone_normalized: row.phone_normalized }] : [];
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("clients", salonId, id) ? [this.find("clients", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? AND firebase_uid = ?")) {
      const [salonId, uid] = params;
      return this.rows("clients")
        .filter((row) => row.salon_id === salonId && row.firebase_uid === uid)
        .slice(0, 2);
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? AND id IN (")) {
      const [salonId, ...ids] = params;
      const requestedIds = new Set(ids.map(String));
      return this.rows("clients").filter(
        (row) => row.salon_id === salonId && requestedIds.has(String(row.id))
      );
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("clients").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM services WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("services", salonId, id) ? [this.find("services", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM services WHERE salon_id = ? AND TRIM(name) = TRIM(?)")) {
      const [salonId, name] = params;
      return this.rows("services")
        .filter((row) => row.salon_id === salonId && String(row.name || "").trim() === String(name || "").trim())
        .slice(0, 2);
    }
    if (normalized.startsWith("SELECT * FROM services WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("services").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM staff WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("staff", salonId, id) ? [this.find("staff", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM staff WHERE salon_id = ? AND id IN (")) {
      const [salonId, ...ids] = params;
      const requestedIds = new Set(ids.map(String));
      return this.rows("staff").filter(
        (row) => row.salon_id === salonId && requestedIds.has(String(row.id))
      );
    }
    if (normalized.startsWith("SELECT * FROM staff WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("staff").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM attendance_records WHERE salon_id = ?")) {
      const [salonId] = params;
      return this.rows("attendance_records")
        .filter((row) => row.salon_id === salonId)
        .sort((a, b) => String(b.recorded_at || "").localeCompare(String(a.recorded_at || "")));
    }
    if (normalized.startsWith("SELECT id, employee_uid, employee_doc_id")) {
      return this.rows("attendance_records")
        .filter((row) => row.result === "allowed" && ["check_in", "check_out"].includes(row.type))
        .sort((a, b) => String(b.server_time || "").localeCompare(String(a.server_time || "")))
        .slice(0, 5000);
    }
    if (normalized.startsWith("SELECT * FROM employee_leaves WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("employee_leaves")
        .filter((row) => row.salon_id === salonId)
        .sort((a, b) => String(b.start_date || "").localeCompare(String(a.start_date || "")))
        .slice(0, 1000);
    }
    if (normalized.startsWith("SELECT * FROM employee_absences WHERE salon_id = ? AND employee_id = ? AND date_key = ?")) {
      const [salonId, employeeId, dateKey] = params;
      return this.rows("employee_absences")
        .filter((row) => row.salon_id === salonId && row.employee_id === employeeId && row.date_key === dateKey)
        .slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM employee_absences WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("employee_absences")
        .filter((row) => row.salon_id === salonId)
        .sort((a, b) => String(b.date_key || "").localeCompare(String(a.date_key || "")))
        .slice(0, 1000);
    }
    if (normalized.startsWith("SELECT * FROM payroll_periods WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("payroll_periods")
        .filter((row) => row.salon_id === salonId)
        .sort((a, b) => String(b.payroll_month || "").localeCompare(String(a.payroll_month || "")))
        .slice(0, 120);
    }
    if (normalized.startsWith("SELECT * FROM payroll_periods WHERE salon_id = ? AND payroll_month = ?")) {
      const [salonId, payrollMonth] = params;
      return this.rows("payroll_periods")
        .filter((row) => row.salon_id === salonId && row.payroll_month === payrollMonth)
        .slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM payroll_periods WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.rows("payroll_periods")
        .filter((row) => row.salon_id === salonId && row.id === id)
        .slice(0, 1);
    }
    if (normalized.startsWith("SELECT id, firebase_uid, name, email, phone_normalized, avatar_file_id, status FROM employee_profiles WHERE salon_id = ?")) {
      const [salonId] = params;
      return this.rows("employee_profiles")
        .filter((row) => row.salon_id === salonId)
        .map((row) => ({
          id: row.id,
          firebase_uid: row.firebase_uid,
          name: row.name,
          email: row.email,
          phone_normalized: row.phone_normalized,
          avatar_file_id: row.avatar_file_id || null,
          status: row.status,
        }));
    }
    if (normalized.startsWith("SELECT id, firebase_uid, name, phone_normalized, active, employment_status FROM staff WHERE salon_id = ?")) {
      const [salonId] = params;
      return this.rows("staff")
        .filter((row) => row.salon_id === salonId)
        .map((row) => ({
          id: row.id,
          firebase_uid: row.firebase_uid,
          name: row.name,
          phone_normalized: row.phone_normalized,
          active: row.active,
          employment_status: row.employment_status,
        }));
    }
    if (normalized.startsWith("SELECT id, firebase_uid, display_name, email, primary_role, status FROM app_users WHERE salon_id = ?")) {
      const [salonId] = params;
      return this.rows("app_users")
        .filter((row) => row.salon_id === salonId)
        .map((row) => ({
          id: row.id,
          firebase_uid: row.firebase_uid,
          display_name: row.display_name,
          email: row.email,
          primary_role: row.primary_role,
          status: row.status,
        }));
    }
    if (normalized.startsWith("SELECT user_id, employee_id, link_status FROM user_employee_links WHERE salon_id = ?")) {
      const [salonId] = params;
      return this.rows("user_employee_links")
        .filter((row) => row.salon_id === salonId && row.link_status === "active")
        .map((row) => ({ user_id: row.user_id, employee_id: row.employee_id, link_status: row.link_status }));
    }
    if (normalized.startsWith("SELECT * FROM employee_target_ledger WHERE salon_id = ?")) {
      const [salonId, start, end] = params;
      const employeeId = normalized.includes("AND employee_id = ?") ? params[3] : "";
      return this.rows("employee_target_ledger")
        .filter((row) =>
          row.salon_id === salonId &&
          String(row.performed_at || "").slice(0, 10) >= start &&
          String(row.performed_at || "").slice(0, 10) <= end &&
          (!employeeId || row.employee_id === employeeId)
        )
        .sort((a, b) => `${String(b.performed_at || "")}\u0000${String(b.created_at || "")}`.localeCompare(`${String(a.performed_at || "")}\u0000${String(a.created_at || "")}`));
    }
    if (normalized.startsWith("SELECT p.*, a.scope_type")) {
      const [salonId, periodEndA, periodStartA, periodEndB, periodStartB, employeeId] = params;
      const rows = this.rows("employee_target_assignments")
        .filter((assignment) => {
          const plan = this.find("employee_target_plans", salonId, assignment.plan_id);
          return assignment.salon_id === salonId &&
            assignment.status === "active" &&
            plan?.status === "active" &&
            assignment.effective_start <= periodEndA &&
            (assignment.effective_end || "9999-12-31") >= periodStartA &&
            plan.effective_start <= periodEndB &&
            (plan.effective_end || "9999-12-31") >= periodStartB &&
            (assignment.scope_type === "default" || (assignment.scope_type === "employee" && assignment.employee_id === employeeId));
        })
        .map((assignment) => ({
          ...this.find("employee_target_plans", salonId, assignment.plan_id),
          scope_type: assignment.scope_type,
          assigned_employee_id: assignment.employee_id,
          assigned_branch_id: assignment.branch_id,
        }))
        .sort((left, right) => {
          const leftRank = left.scope_type === "employee" ? 0 : 1;
          const rightRank = right.scope_type === "employee" ? 0 : 1;
          if (leftRank !== rightRank) return leftRank - rightRank;
          return String(right.effective_start || "").localeCompare(String(left.effective_start || ""));
        });
      return rows.slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM employee_target_tiers WHERE salon_id = ? AND plan_id = ?")) {
      const [salonId, planId] = params;
      return this.rows("employee_target_tiers")
        .filter((row) => row.salon_id === salonId && row.plan_id === planId)
        .sort((a, b) => Number(a.tier_order || 0) - Number(b.tier_order || 0) || Number(a.target_amount || 0) - Number(b.target_amount || 0));
    }
    if (normalized.startsWith("SELECT b.id AS booking_id")) {
      const salonId = params[0];
      const hasBookingFilter = normalized.includes("AND b.id = ?");
      const bookingId = hasBookingFilter ? params[1] : "";
      const start = hasBookingFilter ? params[2] : params[1];
      const end = hasBookingFilter ? params[3] : params[2];
      return this.rows("booking_items")
        .map((item) => {
          const booking = this.find("bookings", item.salon_id, item.booking_id);
          const invoice = this.rows("invoices").find((row) => row.salon_id === item.salon_id && row.booking_id === item.booking_id) || {};
          const service = this.find("services", item.salon_id, item.service_id) || {};
          if (!booking) return null;
          const performedDate = item.booking_date || booking.booking_date;
          return {
            booking_id: booking.id,
            salon_id: booking.salon_id,
            booking_status: booking.status,
            booking_date: booking.booking_date,
            start_time: booking.start_time,
            booking_discount_halalas: booking.discount_halalas || 0,
            booking_total_halalas: booking.total_halalas || 0,
            invoice_id: invoice.id || null,
            invoice_total_halalas: invoice.total_halalas || 0,
            invoice_paid_halalas: invoice.paid_halalas || 0,
            invoice_discount_halalas: invoice.discount_halalas || 0,
            booking_item_id: item.id,
            service_id: item.service_id,
            service_name_snapshot: item.service_name_snapshot,
            booking_item_staff_id: item.staff_id,
            booking_staff_id: booking.staff_id,
            employee_id: item.staff_id || booking.staff_id,
            category_id: service.category_id || null,
            client_package_id: item.client_package_id || null,
            package_reservation_id: item.package_reservation_id || null,
            package_covered: item.package_covered || 0,
            total_halalas: item.total_halalas || 0,
            discount_halalas: item.discount_halalas || 0,
            final_total_halalas: item.final_total_halalas ?? item.total_halalas ?? 0,
            performed_date: performedDate,
            performed_time: item.start_time || booking.start_time || "00:00",
          };
        })
        .filter((row) =>
          row &&
          row.salon_id === salonId &&
          (!bookingId || row.booking_id === bookingId) &&
          !this.find("bookings", row.salon_id, row.booking_id)?.deleted_at &&
          row.performed_date >= start &&
          row.performed_date <= end
        );
    }
    // FAKE_D1_CANONICAL_ADVANCE_DEDUCTIONS
    if (normalized.startsWith("SELECT sa.employee_id, sai.payroll_month,") && normalized.includes("FROM salary_advance_installments sai") && normalized.includes("JOIN salary_advances sa")) {
      const [salonId]=params; const grouped=new Map();
      for (const installment of this.rows("salary_advance_installments")) {
        if(installment.salon_id!==salonId || !["scheduled","deducted"].includes(String(installment.status||""))) continue;
        const advance=this.rows("salary_advances").find((row)=>row.salon_id===salonId && row.id===installment.advance_id);
        if(!advance) continue;
        const key=`${advance.employee_id}\u0000${installment.payroll_month}`;
        const current=grouped.get(key)||{employee_id:advance.employee_id,payroll_month:installment.payroll_month,amount_halalas:0};
        current.amount_halalas+=Number(installment.amount_halalas||0); grouped.set(key,current);
      }
      return [...grouped.values()].sort((x,y)=>`${x.payroll_month}\u0000${x.employee_id}`.localeCompare(`${y.payroll_month}\u0000${y.employee_id}`));
    }
    if (normalized.startsWith("SELECT sai.advance_id, COALESCE(SUM(sai.amount_halalas), 0) AS amount_halalas") && normalized.includes("FROM salary_advance_installments sai") && normalized.includes("JOIN salary_advances sa")) {
      const [salonId,employeeId,payrollMonth]=params; const grouped=new Map();
      for(const installment of this.rows("salary_advance_installments")){
        if(installment.salon_id!==salonId || installment.payroll_month!==payrollMonth || String(installment.status||"")!=="scheduled") continue;
        const advance=this.rows("salary_advances").find((row)=>row.salon_id===salonId && row.id===installment.advance_id && row.employee_id===employeeId);
        if(!advance) continue;
        grouped.set(installment.advance_id,Number(grouped.get(installment.advance_id)||0)+Number(installment.amount_halalas||0));
      }
      return [...grouped.entries()].map(([advance_id,amount_halalas])=>({advance_id,amount_halalas}));
    }

    if (normalized.startsWith("SELECT payroll_month FROM payroll_entries WHERE salon_id = ?") && normalized.includes("status IN ('approved', 'paid')")) {
      const [salonId, employeeId, startPayrollMonth, endPayrollMonth] = params;
      return this.rows("payroll_entries")
        .filter((row) =>
          row.salon_id === salonId &&
          row.employee_id === employeeId &&
          ["approved", "paid"].includes(String(row.status || "")) &&
          row.payroll_month >= startPayrollMonth &&
          (!endPayrollMonth || row.payroll_month <= endPayrollMonth)
        )
        .sort((a, b) => String(a.payroll_month || "").localeCompare(String(b.payroll_month || "")))
        .slice(0, 1)
        .map((row) => ({ payroll_month: row.payroll_month }));
    }
    if (normalized.startsWith("SELECT * FROM employee_recurring_deductions WHERE salon_id = ? AND employee_id = ?") && normalized.includes("status = 'active'")) {
      const [salonId, employeeId, payrollMonth] = params;
      return this.activeRecurringDeductions(salonId, employeeId, payrollMonth)
        .sort((a, b) => `${a.created_at || ""}\u0000${a.id || ""}`.localeCompare(`${b.created_at || ""}\u0000${b.id || ""}`));
    }
    if (normalized.startsWith("SELECT * FROM employee_recurring_deductions WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      const row = this.find("employee_recurring_deductions", salonId, id);
      return row ? [row] : [];
    }
    if (normalized.startsWith("SELECT * FROM employee_recurring_deductions WHERE salon_id = ?") && normalized.includes("status = 'active'")) {
      const [salonId, payrollMonth] = params;
      return this.activeRecurringDeductions(salonId, "", payrollMonth)
        .sort((a, b) => `${a.employee_id || ""}\u0000${a.created_at || ""}\u0000${a.id || ""}`.localeCompare(`${b.employee_id || ""}\u0000${b.created_at || ""}\u0000${b.id || ""}`));
    }
    if (normalized.startsWith("SELECT * FROM employee_recurring_deductions WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("employee_recurring_deductions")
        .filter((row) => row.salon_id === salonId)
        .sort((a, b) => {
          const byEmployee = String(a.employee_id || "").localeCompare(String(b.employee_id || ""));
          if (byEmployee !== 0) return byEmployee;
          const byStart = String(b.start_payroll_month || "").localeCompare(String(a.start_payroll_month || ""));
          if (byStart !== 0) return byStart;
          return String(b.created_at || "").localeCompare(String(a.created_at || ""));
        });
    }
    if (normalized.startsWith("SELECT * FROM employee_payroll_obligations WHERE salon_id = ? AND employee_id = ? AND source_type = 'attendance' AND source_ref = ? AND status <> 'cancelled' ORDER BY created_at, id")) {
      const [salonId, employeeId, sourceRef] = params;
      return this.rows("employee_payroll_obligations")
        .filter((row) =>
          row.salon_id === salonId &&
          row.employee_id === employeeId &&
          row.source_type === "attendance" &&
          row.source_ref === sourceRef &&
          row.status !== "cancelled"
        )
        .sort((a, b) => {
          const byCreatedAt = String(a.created_at || "").localeCompare(String(b.created_at || ""));
          if (byCreatedAt !== 0) return byCreatedAt;
          return String(a.id || "").localeCompare(String(b.id || ""));
        });
    }

    if (normalized.startsWith("SELECT * FROM employee_payroll_obligations WHERE salon_id = ? AND employee_id = ? AND source_type = ? AND source_ref = ?")) {
      const [salonId, employeeId, sourceType, sourceRef] = params;
      return this.rows("employee_payroll_obligations")
        .filter((row) =>
          row.salon_id === salonId &&
          row.employee_id === employeeId &&
          row.source_type === sourceType &&
          row.source_ref === sourceRef
        )
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
        .slice(0, 1);
    }
    if (normalized.startsWith("SELECT id FROM employee_payroll_obligations WHERE salon_id = ? AND employee_id = ? AND recurring_deduction_id = ? AND original_payroll_month = ?")) {
      const [salonId, employeeId, recurringDeductionId, payrollMonth] = params;
      return this.rows("employee_payroll_obligations")
        .filter((row) =>
          row.salon_id === salonId &&
          row.employee_id === employeeId &&
          row.recurring_deduction_id === recurringDeductionId &&
          row.original_payroll_month === payrollMonth
        )
        .slice(0, 1)
        .map((row) => ({ id: row.id }));
    }
    if (normalized.startsWith("SELECT * FROM employee_payroll_obligations WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      const row = this.find("employee_payroll_obligations", salonId, id);
      return row ? [row] : [];
    }
    if (normalized.startsWith("SELECT * FROM employee_payroll_obligations WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("employee_payroll_obligations")
        .filter((row) => row.salon_id === salonId)
        .sort((a, b) => {
          const byMonth = String(b.original_payroll_month || "").localeCompare(String(a.original_payroll_month || ""));
          if (byMonth !== 0) return byMonth;
          return String(b.created_at || "").localeCompare(String(a.created_at || ""));
        });
    }
    if (normalized.startsWith("SELECT i.*, o.employee_id, o.recurring_deduction_id")) {
      const hasEmployeeFilter = normalized.includes("AND o.employee_id = ?");
      const [salonId, second, third] = params;
      const employeeId = hasEmployeeFilter ? second : "";
      const payrollMonth = hasEmployeeFilter ? third : second;
      const openStatuses = new Set(["open", "scheduled", "partially_settled"]);
      return this.joinedPayrollObligationInstallments(salonId)
        .filter((row) =>
          (!employeeId || row.employee_id === employeeId) &&
          row.target_payroll_month === payrollMonth &&
          row.status === "scheduled" &&
          openStatuses.has(String(row.obligation_status || ""))
        )
        .sort((a, b) => `${a.employee_id || ""}\u0000${a.created_at || ""}\u0000${a.id || ""}`.localeCompare(`${b.employee_id || ""}\u0000${b.created_at || ""}\u0000${b.id || ""}`));
    }
    if (normalized.startsWith("SELECT i.*, o.employee_id, o.obligation_kind, o.status AS obligation_status")) {
      const [salonId, installmentId] = params;
      return this.joinedPayrollObligationInstallments(salonId)
        .filter((row) => row.id === installmentId)
        .slice(0, 1);
    }
    if (normalized.startsWith("SELECT i.*, o.employee_id FROM employee_payroll_obligation_installments i")) {
      const [salonId, ...installmentIds] = params;
      const wanted = new Set(installmentIds);
      return this.joinedPayrollObligationInstallments(salonId)
        .filter((row) => wanted.has(row.id));
    }
    if (normalized.startsWith("SELECT id FROM employee_payroll_obligation_installments WHERE salon_id = ? AND obligation_id = ? AND target_payroll_month = ?")) {
      const [salonId, obligationId, targetPayrollMonth] = params;
      return this.rows("employee_payroll_obligation_installments")
        .filter((row) =>
          row.salon_id === salonId &&
          row.obligation_id === obligationId &&
          row.target_payroll_month === targetPayrollMonth &&
          row.status === "scheduled"
        )
        .slice(0, 1)
        .map((row) => ({ id: row.id }));
    }
    if (normalized.startsWith("SELECT COALESCE(MAX(sequence_no), 0) AS max_sequence FROM employee_payroll_obligation_installments")) {
      const [salonId, obligationId] = params;
      const maxSequence = this.rows("employee_payroll_obligation_installments")
        .filter((row) => row.salon_id === salonId && row.obligation_id === obligationId)
        .reduce((max, row) => Math.max(max, Number(row.sequence_no || 0)), 0);
      return [{ max_sequence: maxSequence }];
    }
    if (normalized.startsWith("SELECT * FROM employee_payroll_obligation_installments WHERE salon_id = ? AND obligation_id IN")) {
      const [salonId, ...obligationIds] = params;
      const wanted = new Set(obligationIds);
      return this.rows("employee_payroll_obligation_installments")
        .filter((row) => row.salon_id === salonId && wanted.has(row.obligation_id))
        .sort((a, b) => {
          const byObligation = String(a.obligation_id || "").localeCompare(String(b.obligation_id || ""));
          if (byObligation !== 0) return byObligation;
          return Number(a.sequence_no || 0) - Number(b.sequence_no || 0);
        });
    }
    if (normalized.startsWith("SELECT * FROM employee_payroll_obligation_installments WHERE salon_id = ? AND obligation_id = ? AND status = 'scheduled'")) {
      const [salonId, obligationId] = params;
      return this.rows("employee_payroll_obligation_installments")
        .filter((row) => row.salon_id === salonId && row.obligation_id === obligationId && row.status === "scheduled");
    }

    if (normalized.startsWith("SELECT id, status FROM payroll_entries WHERE salon_id = ? AND employee_id = ? AND payroll_month = ?")) {
      const [salonId, employeeId, payrollMonth] = params;
      return this.rows("payroll_entries")
        .filter((row) => row.salon_id === salonId && row.employee_id === employeeId && row.payroll_month === payrollMonth)
        .slice(0, 1)
        .map((row) => ({ id: row.id, status: row.status }));
    }
    if (normalized.startsWith("SELECT * FROM payroll_entries WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("payroll_entries", salonId, id) ? [this.find("payroll_entries", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM payroll_entries WHERE salon_id = ? AND employee_id = ? AND payroll_month = ?")) {
      const [salonId, employeeId, payrollMonth] = params;
      return this.rows("payroll_entries")
        .filter((row) => row.salon_id === salonId && row.employee_id === employeeId && row.payroll_month === payrollMonth)
        .slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM payroll_entries WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("payroll_entries")
        .filter((row) => row.salon_id === salonId)
        .sort((a, b) => `${b.payroll_month || ""}\u0000${a.employee_id || ""}`.localeCompare(`${a.payroll_month || ""}\u0000${b.employee_id || ""}`))
        .slice(0, 2000);
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
    if (normalized.startsWith("SELECT * FROM bookings WHERE salon_id = ? AND id IN (")) {
      const [salonId, ...ids] = params;
      const requestedIds = new Set(ids.map(String));
      return this.rows("bookings").filter(
        (row) =>
          row.salon_id === salonId &&
          requestedIds.has(String(row.id)) &&
          (!normalized.includes("deleted_at IS NULL") || !row.deleted_at)
      );
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
    if (normalized.startsWith("SELECT * FROM booking_items WHERE salon_id = ? AND booking_id IN (")) {
      const [salonId, ...ids] = params;
      const bookingIds = new Set(ids.map(String));
      return this.rows("booking_items").filter(
        (row) => row.salon_id === salonId && bookingIds.has(String(row.booking_id))
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
    if (normalized.startsWith("SELECT * FROM invoices WHERE salon_id = ? AND booking_id IN (")) {
      const [salonId, ...ids] = params;
      const bookingIds = new Set(ids.map(String));
      return this.rows("invoices").filter(
        (row) => row.salon_id === salonId && bookingIds.has(String(row.booking_id))
      );
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
    if (
      normalized.includes("FROM employee_overtime_records") &&
      normalized.includes("compensation_mode = 'cash_overtime'")
    ) {
      const [salonId, employeeId, payrollMonth] = params;
      return this.rows("employee_overtime_records")
        .filter((row) =>
          row.salon_id === salonId &&
          row.employee_id === employeeId &&
          row.payroll_month === payrollMonth &&
          row.compensation_mode === "cash_overtime" &&
          ["ready_for_payroll", "included"].includes(row.financial_status) &&
          Number(row.actual_worked_minutes || 0) > 0
        )
        .sort((a, b) =>
          String(a.date_key || "").localeCompare(String(b.date_key || "")) ||
          String(a.start_time || "").localeCompare(String(b.start_time || "")) ||
          String(a.id || "").localeCompare(String(b.id || ""))
        );
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

    // FAKE_D1_LINK_SALARY_ADVANCE_INSTALLMENTS
    if (normalized.startsWith("UPDATE salary_advance_installments SET payroll_entry_id = ?, updated_at = ?")) {
      const [payrollEntryId,updatedAt,salonId,payrollMonth,advanceSalonId,employeeId]=params;
      const advanceIds=new Set(this.rows("salary_advances").filter((row)=>row.salon_id===advanceSalonId && row.employee_id===employeeId).map((row)=>row.id));
      let count=0;
      for(const row of this.rows("salary_advance_installments")){
        if(row.salon_id===salonId && row.payroll_month===payrollMonth && String(row.status||"")==="scheduled" && advanceIds.has(row.advance_id)){
          this.seed("salary_advance_installments",{...row,payroll_entry_id:payrollEntryId,updated_at:updatedAt}); count+=1;
        }
      }
      return {meta:{changes:count}};
    }
    if (normalized.startsWith("INSERT INTO employee_recurring_deductions")) {
      const [
        id,
        salon_id,
        employee_id,
        title,
        deduction_kind,
        amount_halalas,
        start_payroll_month,
        end_payroll_month,
        status,
        reason,
        note,
        source_type,
        source_ref,
        created_by_uid,
        created_by_email,
        updated_by_uid,
        updated_by_email,
        created_at,
        updated_at,
      ] = params;
      const existing = this.find("employee_recurring_deductions", salon_id, id);
      return this.insert("employee_recurring_deductions", {
        ...(existing || {}),
        id,
        salon_id,
        employee_id,
        title,
        deduction_kind,
        amount_halalas,
        cadence: "monthly",
        start_payroll_month,
        end_payroll_month,
        status,
        reason,
        note,
        source_type,
        source_ref,
        created_by_uid: existing?.created_by_uid || created_by_uid,
        created_by_email: existing?.created_by_email || created_by_email,
        updated_by_uid,
        updated_by_email,
        created_at: existing?.created_at || created_at,
        updated_at,
      });
    }
    if (normalized.startsWith("INSERT OR IGNORE INTO employee_payroll_obligations")) {
      const [
        id,
        salon_id,
        employee_id,
        recurring_deduction_id,
        obligation_kind,
        source_ref,
        original_payroll_month,
        original_amount_halalas,
        remaining_amount_halalas,
        reason,
        note,
        created_by_uid,
        created_by_email,
        created_at,
        updated_at,
      ] = params;
      if (this.find("employee_payroll_obligations", salon_id, id)) return { meta: { changes: 0 } };
      return this.insert("employee_payroll_obligations", {
        id,
        salon_id,
        employee_id,
        recurring_deduction_id,
        obligation_kind,
        source_type: "recurring_deduction",
        source_ref,
        original_payroll_month,
        original_amount_halalas,
        remaining_amount_halalas,
        status: "scheduled",
        reason,
        note,
        created_by_uid,
        created_by_email,
        cancelled_by_uid: null,
        cancelled_by_email: null,
        cancelled_at: null,
        cancellation_reason: null,
        created_at,
        updated_at,
      });
    }
    if (normalized.startsWith("INSERT INTO employee_payroll_obligations")) {
      const [
        id,
        salon_id,
        employee_id,
        obligation_kind,
        source_type,
        source_ref,
        original_payroll_month,
        original_amount_halalas,
        remaining_amount_halalas,
        reason,
        note,
        created_by_uid,
        created_by_email,
        created_at,
        updated_at,
      ] = params;
      return this.insert("employee_payroll_obligations", {
        id,
        salon_id,
        employee_id,
        recurring_deduction_id: null,
        obligation_kind,
        source_type,
        source_ref,
        original_payroll_month,
        original_amount_halalas,
        remaining_amount_halalas,
        status: "scheduled",
        reason,
        note,
        created_by_uid,
        created_by_email,
        cancelled_by_uid: null,
        cancelled_by_email: null,
        cancelled_at: null,
        cancellation_reason: null,
        created_at,
        updated_at,
      });
    }
    if (normalized.startsWith("INSERT OR IGNORE INTO employee_payroll_obligation_installments")) {
      const [
        id,
        salon_id,
        obligation_id,
        target_payroll_month,
        amount_halalas,
        decision_reason,
        note,
        created_by_uid,
        created_by_email,
        created_at,
        updated_at,
      ] = params;
      if (this.find("employee_payroll_obligation_installments", salon_id, id)) return { meta: { changes: 0 } };
      return this.insert("employee_payroll_obligation_installments", {
        id,
        salon_id,
        obligation_id,
        sequence_no: 1,
        target_payroll_month,
        amount_halalas,
        status: "scheduled",
        applied_payroll_entry_id: null,
        applied_at: null,
        deferred_from_installment_id: null,
        superseded_by_installment_id: null,
        decision_reason,
        note,
        created_by_uid,
        created_by_email,
        created_at,
        updated_at,
      });
    }
    if (normalized.startsWith("INSERT INTO employee_payroll_obligation_installments")) {
      const [
        id,
        salon_id,
        obligation_id,
        sequence_no,
        target_payroll_month,
        amount_halalas,
        maybeDeferredFrom,
        maybeReason,
        maybeNote,
        maybeCreatedByUid,
        maybeCreatedByEmail,
        maybeCreatedAt,
        maybeUpdatedAt,
      ] = params;
      const hasDeferredSource = normalized.includes("deferred_from_installment_id");
      return this.insert("employee_payroll_obligation_installments", {
        id,
        salon_id,
        obligation_id,
        sequence_no,
        target_payroll_month,
        amount_halalas,
        status: "scheduled",
        applied_payroll_entry_id: null,
        applied_at: null,
        deferred_from_installment_id: hasDeferredSource ? maybeDeferredFrom : null,
        superseded_by_installment_id: null,
        decision_reason: hasDeferredSource ? maybeReason : maybeDeferredFrom,
        note: hasDeferredSource ? maybeNote : maybeReason,
        created_by_uid: hasDeferredSource ? maybeCreatedByUid : maybeNote,
        created_by_email: hasDeferredSource ? maybeCreatedByEmail : maybeCreatedByUid,
        created_at: hasDeferredSource ? maybeCreatedAt : maybeCreatedByEmail,
        updated_at: hasDeferredSource ? maybeUpdatedAt : maybeCreatedAt,
      });
    }
    if (normalized.startsWith("UPDATE employee_payroll_obligation_installments SET status = 'cancelled'")) {
      const [updatedAt, salonId, obligationId] = params;
      let changes = 0;
      for (const row of this.rows("employee_payroll_obligation_installments")) {
        if (row.salon_id !== salonId || row.obligation_id !== obligationId || row.status !== "scheduled") continue;
        this.seed("employee_payroll_obligation_installments", { ...row, status: "cancelled", updated_at: updatedAt });
        changes += 1;
      }
      return { meta: { changes } };
    }
    if (normalized.startsWith("UPDATE employee_payroll_obligation_installments SET status = 'deferred'")) {
      const [supersededByInstallmentId, updatedAt, salonId, id] = params;
      const row = this.find("employee_payroll_obligation_installments", salonId, id);
      if (!row || row.status !== "scheduled") return { meta: { changes: 0 } };
      return this.update("employee_payroll_obligation_installments", salonId, id, {
        status: "deferred",
        superseded_by_installment_id: supersededByInstallmentId,
        updated_at: updatedAt,
      });
    }
    if (normalized.startsWith("UPDATE employee_payroll_obligation_installments SET status = 'applied'")) {
      const [payrollEntryId, appliedAt, updatedAt, salonId, id] = params;
      const row = this.find("employee_payroll_obligation_installments", salonId, id);
      if (!row || row.status !== "scheduled") return { meta: { changes: 0 } };
      return this.update("employee_payroll_obligation_installments", salonId, id, {
        status: "applied",
        applied_payroll_entry_id: payrollEntryId,
        applied_at: appliedAt,
        updated_at: updatedAt,
      });
    }
    if (normalized.startsWith("UPDATE employee_payroll_obligations SET status = 'cancelled'")) {
      const [cancelledByUid, cancelledByEmail, cancelledAt, cancellationReason, updatedAt, salonId, id] = params;
      return this.update("employee_payroll_obligations", salonId, id, {
        status: "cancelled",
        cancelled_by_uid: cancelledByUid,
        cancelled_by_email: cancelledByEmail,
        cancelled_at: cancelledAt,
        cancellation_reason: cancellationReason,
        updated_at: updatedAt,
      });
    }
    if (normalized.startsWith("UPDATE employee_payroll_obligations SET remaining_amount_halalas = MAX")) {
      const [amountHalalas, settleThreshold, updatedAt, salonId, id] = params;
      const row = this.find("employee_payroll_obligations", salonId, id);
      if (!row) return { meta: { changes: 0 } };
      const previousRemaining = Number(row.remaining_amount_halalas || 0);
      const remaining = Math.max(0, previousRemaining - Number(amountHalalas || 0));
      return this.update("employee_payroll_obligations", salonId, id, {
        remaining_amount_halalas: remaining,
        status: previousRemaining <= Number(settleThreshold || 0) ? "settled" : "partially_settled",
        updated_at: updatedAt,
      });
    }
    if (normalized.startsWith("UPDATE employee_payroll_obligations SET updated_at = ?")) {
      const [updatedAt, salonId, id] = params;
      return this.update("employee_payroll_obligations", salonId, id, { updated_at: updatedAt });
    }
    if (normalized.startsWith("INSERT INTO user_employee_links")) {
      const [
        id,
        salon_id,
        user_id,
        employee_id,
        linked_by_user_id,
        linked_at,
        updated_at,
        legacy_source,
        legacy_id,
      ] = params;
      const existing = this.rows("user_employee_links").find((row) => row.id === id && row.salon_id === salon_id);
      this.seed("user_employee_links", {
        ...(existing || {}),
        id,
        salon_id,
        user_id,
        employee_id,
        link_status: "active",
        linked_by_user_id,
        linked_at,
        updated_at,
        unlinked_at: null,
        legacy_source,
        legacy_id,
      });
      return { meta: { changes: 1 } };
    }
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
    if (normalized.startsWith("INSERT OR IGNORE INTO client_aliases")) {
      const [salon_id, alias_id, canonical_client_id, created_at] = params;
      const key = `${salon_id}\u0000${alias_id}`;
      if (this.tables.client_aliases.has(key)) return { meta: { changes: 0 } };
      return this.insert("client_aliases", {
        salon_id,
        alias_id,
        canonical_client_id,
        alias_type: "firebase_uid",
        created_at,
      });
    }
    if (normalized.startsWith("INSERT INTO clients")) {
      const [id, salon_id, name, phone_normalized, email, firebase_uid, status, notes, vip, legacy_client_doc_id, created_at, updated_at] = params;
      return this.insert("clients", { id, salon_id, name, phone_normalized, email, firebase_uid, status, notes, vip, legacy_client_doc_id, created_at, updated_at });
    }
    if (normalized.startsWith("INSERT INTO services")) {
      const [id, salon_id, name, section_id, category_id, description, duration_minutes, price_halalas, active, image_url, sort_order, created_at, updated_at] = params;
      return this.insert("services", { id, salon_id, name, section_id, category_id, description, duration_minutes, price_halalas, active, image_url, sort_order, created_at, updated_at });
    }
    if (normalized.startsWith("UPDATE app_users SET last_login_at = ?")) {
      const [last_login_at, updated_at, id] = params;
      const row = this.rows("app_users").find((item) => item.id === id);
      if (!row) return { meta: { changes: 0 } };
      this.seed("app_users", { ...row, last_login_at, updated_at });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("UPDATE app_users SET")) return this.dynamicUpdate("app_users", normalized, params);
    if (normalized.startsWith("DELETE FROM user_permissions WHERE salon_id = ? AND user_id = ?")) {
      const [salonId, userId] = params;
      let removed = 0;
      for (const [key, row] of this.tables.user_permissions.entries()) {
        if (row.salon_id === salonId && row.user_id === userId) {
          this.tables.user_permissions.delete(key);
          removed += 1;
        }
      }
      return { meta: { changes: removed } };
    }
    if (normalized.startsWith("UPDATE user_employee_links SET link_status = 'unlinked'")) {
      const [unlinked_at, updated_at, salonId, lookup] = params;
      const byEmployee = normalized.includes("employee_id = ?");
      let changes = 0;
      for (const row of this.rows("user_employee_links")) {
        if (row.salon_id !== salonId || row.link_status !== "active") continue;
        if (byEmployee ? row.employee_id !== lookup : row.user_id !== lookup && row.id !== lookup) continue;
        this.seed("user_employee_links", { ...row, link_status: "unlinked", unlinked_at, updated_at });
        changes += 1;
      }
      return { meta: { changes } };
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
    if (normalized.startsWith("UPDATE payroll_entries SET status = 'approved'")) {
      const [approved_at, approved_by_uid, audit_log_json, updated_at, salonId, id] = params;
      const current = this.find("payroll_entries", salonId, id);
      return this.update("payroll_entries", salonId, id, {
        status: "approved",
        approved_at: current?.approved_at || approved_at,
        approved_by_uid: current?.approved_by_uid || approved_by_uid,
        audit_log_json,
        updated_at,
      });
    }
    if (normalized.startsWith("UPDATE payroll_entries SET status = ?")) {
      const [status, audit_log_json, updated_at, salonId, id] = params;
      return this.update("payroll_entries", salonId, id, {
        status,
        approved_at: null,
        approved_by_uid: null,
        audit_log_json,
        updated_at,
      });
    }
    if (normalized.startsWith("UPDATE payroll_entries SET status = 'paid'")) {
      const [approved_at, approved_by_uid, paid_at, paid_by_uid, audit_log_json, updated_at, salonId, id] = params;
      const current = this.find("payroll_entries", salonId, id);
      return this.update("payroll_entries", salonId, id, {
        status: "paid",
        approved_at: current?.approved_at || approved_at,
        approved_by_uid: current?.approved_by_uid || approved_by_uid,
        paid_at: current?.paid_at || paid_at,
        paid_by_uid: current?.paid_by_uid || paid_by_uid,
        audit_log_json,
        updated_at,
      });
    }
    if (normalized.startsWith("UPDATE payroll_entries SET")) return this.dynamicUpdate("payroll_entries", normalized, params);
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
      } else if (sql.startsWith("INSERT INTO app_users") || sql.startsWith("INSERT INTO user_permissions") || sql.startsWith("INSERT INTO user_employee_links")) {
        results.push(await this.run(statement.sql, params));
      } else if (sql.startsWith("DELETE FROM user_permissions") || sql.startsWith("UPDATE user_employee_links SET")) {
        results.push(await this.run(statement.sql, params));
      } else if (
        sql.startsWith("INSERT INTO employee_payroll_obligations") ||
        sql.startsWith("INSERT OR IGNORE INTO employee_payroll_obligations") ||
        sql.startsWith("INSERT INTO employee_payroll_obligation_installments") ||
        sql.startsWith("INSERT OR IGNORE INTO employee_payroll_obligation_installments") ||
        sql.startsWith("UPDATE employee_payroll_obligation_installments") ||
        sql.startsWith("UPDATE employee_payroll_obligations")
      ) {
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

function riyadhDateOffset(days) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  const date = new Date(Date.UTC(read("year"), read("month") - 1, read("day") + days, 12));
  return date.toISOString().slice(0, 10);
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

function migrationTableCount(stdout, table) {
  const plainOutput = stripVTControlCharacters(stdout);
  const line = plainOutput.split(/\r?\n/).find((row) => {
    const trimmed = row.trim();
    return trimmed.includes(table) && !/^(INSERT|UPDATE|DELETE)\b/i.test(trimmed);
  });
  assert.ok(line, `missing ${table} count`);
  const tokens = line.replace(/[^\w]+/g, " ").trim().split(/\s+/);
  const tableIndex = tokens.indexOf(table);
  assert.notEqual(tableIndex, -1, `missing ${table} count token`);
  const count = tokens.slice(tableIndex + 1).find((token) => /^\d+$/.test(token));
  assert.ok(count, `missing ${table} numeric count`);
  return Number(count);
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
    if (normalized.includes("FROM app_users u LEFT JOIN roles r")) return [{ count: 0 }];
    if (normalized.includes("FROM user_employee_links l LEFT JOIN app_users u")) return [{ count: 0 }];
    if (normalized.includes("FROM user_employee_links l LEFT JOIN employee_profiles ep")) return [{ count: 0 }];
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
  fake.seed("staff", { id: "staff-a", salon_id: "main", firebase_uid: "staff1", name: "Staff A", phone_normalized: null, active: 1, employment_status: "active", show_on_booking: 1, created_at: now, updated_at: now });
  fake.seed("staff_services", {
    id: "staff-a__svc-a",
    salon_id: "main",
    staff_id: "staff-a",
    service_id: "svc-a",
    active: 1,
    created_at: now,
    updated_at: now,
  });
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    fake.seed("hr_work_schedules", {
      id: `staff-a__weekday-${weekday}`,
      salon_id: "main",
      employee_id: "staff-a",
      weekday,
      shift_template_id: null,
      active: 1,
      start_time: "09:00",
      end_time: "23:00",
      effective_from: "2020-01-01",
      effective_to: null,
      schedule_source: "test_fixture",
      created_at: now,
      updated_at: now,
    });
  }
}

function seedEmployeeTargetAuthScenario(fake) {
  const now = "2027-01-01T00:00:00.000Z";
  fake.seed("app_users", {
    id: "user-staff-a",
    firebase_uid: "staff-a-uid",
    salon_id: "main",
    email: "staff-a@example.com",
    display_name: "Staff A",
    primary_role: "staff",
    status: "active",
    email_verified: 1,
    created_at: now,
    updated_at: now,
  });
  fake.seed("app_users", {
    id: "user-staff-unlinked",
    firebase_uid: "staff-unlinked-uid",
    salon_id: "main",
    email: "staff-unlinked@example.com",
    display_name: "Unlinked Staff",
    primary_role: "staff",
    status: "active",
    email_verified: 1,
    created_at: now,
    updated_at: now,
  });
  fake.seed("employee_profiles", { id: "emp-a", salon_id: "main", firebase_uid: "staff-a-uid", name: "Employee A", email: "a@example.com", phone_normalized: null, status: "active", created_at: now, updated_at: now });
  fake.seed("employee_profiles", { id: "emp-b", salon_id: "main", firebase_uid: "staff-b-uid", name: "Employee B", email: "b@example.com", phone_normalized: null, status: "active", created_at: now, updated_at: now });
  fake.seed("user_employee_links", { id: "link-a", salon_id: "main", user_id: "user-staff-a", employee_id: "emp-a", link_status: "active", linked_at: now, updated_at: now });
  fake.seed("payroll_periods", { id: "period-2026-07", salon_id: "main", payroll_month: "2026-07", month_start: "2026-06-21", month_end: "2026-07-20", status: "open", created_at: now, updated_at: now });
  fake.seed("employee_target_plans", {
    id: "plan-a",
    salon_id: "main",
    name: "Plan A",
    status: "active",
    effective_start: "2026-01-01",
    effective_end: null,
    cumulative_tiers: 0,
    bonus_type: "fixed",
    included_service_ids_json: "[]",
    included_category_ids_json: "[]",
    excluded_service_ids_json: "[]",
    excluded_category_ids_json: "[]",
    created_at: now,
    updated_at: now,
  });
  fake.seed("employee_target_tiers", { id: "tier-a-1", salon_id: "main", plan_id: "plan-a", tier_name: "Tier 1", tier_order: 1, target_amount: 1000000, bonus_amount: 30000, bonus_percent_bps: 0, status: "active", created_at: now, updated_at: now });
  fake.seed("employee_target_assignments", { id: "assign-default", salon_id: "main", plan_id: "plan-a", scope_type: "default", employee_id: null, branch_id: null, status: "active", effective_start: "2026-01-01", effective_end: null, created_at: now, updated_at: now });
  fake.seed("employee_target_ledger", {
    id: "ledger-a",
    salon_id: "main",
    employee_id: "emp-a",
    booking_id: "booking-a",
    booking_item_id: "item-a",
    service_id: "svc-a",
    package_session_id: null,
    transaction_type: "service_completed",
    gross_amount: 875000,
    discount_amount: 0,
    refund_amount: 0,
    eligible_amount: 875000,
    performed_at: "2026-07-10T15:00:00.000Z",
    payroll_period_id: "period-2026-07",
    source_reference: "service:item-a",
    details_json: JSON.stringify({ serviceName: "Service A", rawEmployeeId: "emp-a" }),
    created_at: now,
    updated_at: now,
  });
  fake.seed("employee_target_ledger", {
    id: "ledger-b",
    salon_id: "main",
    employee_id: "emp-b",
    booking_id: "booking-b",
    booking_item_id: "item-b",
    service_id: "svc-a",
    package_session_id: null,
    transaction_type: "service_completed",
    gross_amount: 500000,
    discount_amount: 0,
    refund_amount: 0,
    eligible_amount: 500000,
    performed_at: "2026-07-11T15:00:00.000Z",
    payroll_period_id: "period-2026-07",
    source_reference: "service:item-b",
    details_json: JSON.stringify({ serviceName: "Service A", rawEmployeeId: "emp-b" }),
    created_at: now,
    updated_at: now,
  });
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

test("employee target mine endpoint returns only the linked employee target", async () => {
  const fake = new FakeD1();
  seedEmployeeTargetAuthScenario(fake);

  const response = await worker.fetch(request("/api/core/hr/employee-targets/mine?payrollMonth=2026-07", {
    token: "test:staff-a-uid:staff",
  }), env(fake));
  const body = await json(response);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.summary.employee_id, "emp-a");
  assert.equal(body.data.summary.net_target_amount, 875000);
  assert.equal(body.data.summary.current_target_amount, 1000000);
  assert.equal(body.data.summary.remaining_to_next_tier, 125000);
  assert.equal(body.data.summary.earned_bonus_amount, 0);
  assert.equal(body.data.authScope.own_only, true);
  assert.ok(!JSON.stringify(body.data).includes("ledger-b"), "own target response must not include Employee B ledger");
});

test("employee target detail endpoint rejects another employee for own-only staff accounts", async () => {
  const fake = new FakeD1();
  seedEmployeeTargetAuthScenario(fake);

  const response = await worker.fetch(request("/api/core/hr/employee-targets/emp-b?payrollMonth=2026-07", {
    token: "test:staff-a-uid:staff",
  }), env(fake));
  const body = await json(response);

  assert.equal(response.status, 403, JSON.stringify(body));
  assert.equal(body.error, "core_auth:missing_permission");
});

test("employee target mine endpoint rejects unlinked staff accounts clearly", async () => {
  const fake = new FakeD1();
  seedEmployeeTargetAuthScenario(fake);

  const response = await worker.fetch(request("/api/core/hr/employee-targets/mine?payrollMonth=2026-07", {
    token: "test:staff-unlinked-uid:staff",
  }), env(fake));
  const body = await json(response);

  assert.equal(response.status, 403, JSON.stringify(body));
  assert.equal(body.error, "employee_targets:employee_link_required");
});

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

function seedPayrollEntry(fake, overrides = {}) {
  const now = "2026-07-28T10:00:00.000Z";
  const row = {
    id: overrides.id || "payroll-maryam-2026-07",
    salon_id: "main",
    period_id: overrides.period_id || "period-2026-07",
    employee_id: overrides.employee_id || "emp-maryam",
    payroll_month: overrides.payroll_month || "2026-07",
    employee_name: overrides.employee_name || "Maryam",
    job_title: overrides.job_title || null,
    base_salary_halalas: overrides.base_salary_halalas ?? 310000,
    allowances_halalas: overrides.allowances_halalas ?? 0,
    work_days: overrides.work_days ?? 30,
    monthly_hours: overrides.monthly_hours ?? 240,
    daily_rate_halalas: overrides.daily_rate_halalas ?? 10333,
    hourly_rate_halalas: overrides.hourly_rate_halalas ?? 1292,
    absence_days: overrides.absence_days ?? 0,
    absence_deduction_halalas: overrides.absence_deduction_halalas ?? 0,
    expected_work_hours: overrides.expected_work_hours ?? 0,
    actual_worked_hours: overrides.actual_worked_hours ?? 0,
    missing_hours: overrides.missing_hours ?? 0,
    overtime_hours: overrides.overtime_hours ?? 0,
    attendance_summary_json: overrides.attendance_summary_json || JSON.stringify({
      totalScheduledHours: 0,
      totalActualWorkedHours: 0,
      totalLateHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 0,
      totalExtraHours: 0,
      attendanceDays: 0,
      absentDays: 0,
      incompleteDays: 0,
    }),
    detected_extra_hours: overrides.detected_extra_hours ?? 0,
    overtime_enabled: overrides.overtime_enabled ?? 0,
    financial_overtime_hours: overrides.financial_overtime_hours ?? 0,
    overtime_multiplier: overrides.overtime_multiplier ?? 1.5,
    overtime_value_halalas: overrides.overtime_value_halalas ?? 0,
    overtime_bonus_halalas: overrides.overtime_bonus_halalas ?? 0,
    delay_deduction_halalas: overrides.delay_deduction_halalas ?? 0,
    insurance_deduction_halalas: overrides.insurance_deduction_halalas ?? 0,
    other_deductions_halalas: overrides.other_deductions_halalas ?? 0,
    missing_hours_deduction_halalas: overrides.missing_hours_deduction_halalas ?? 0,
    additions_json: overrides.additions_json || "[]",
    manual_additions_halalas: overrides.manual_additions_halalas ?? 0,
    manual_deductions_halalas: overrides.manual_deductions_halalas ?? 0,
    advances_halalas: overrides.advances_halalas ?? 0,
    total_deductions_halalas: overrides.total_deductions_halalas ?? 0,
    gross_salary_halalas: overrides.gross_salary_halalas ?? 310000,
    final_salary_halalas: overrides.final_salary_halalas ?? 310000,
    net_salary_halalas: overrides.net_salary_halalas ?? 310000,
    schedule_snapshot_json: overrides.schedule_snapshot_json || JSON.stringify({
      payrollSetupComplete: true,
      payrollSetupMissing: [],
      dailyScheduledHours: 8,
      monthlyHoursSource: "configured_monthly_hours",
    }),
    absence_entries_json: overrides.absence_entries_json || "[]",
    deductions_json: overrides.deductions_json || "[]",
    mudad_file_id: overrides.mudad_file_id || null,
    status: overrides.status || "approved",
    approved_at: overrides.approved_at === undefined ? now : overrides.approved_at,
    approved_by_uid: overrides.approved_by_uid === undefined ? "owner1" : overrides.approved_by_uid,
    paid_at: overrides.paid_at || null,
    paid_by_uid: overrides.paid_by_uid || null,
    notes: overrides.notes || null,
    audit_log_json: overrides.audit_log_json || JSON.stringify([{ action: "approved", byUid: "owner1", at: now }]),
    created_by_uid: overrides.created_by_uid || "owner1",
    created_by_email: overrides.created_by_email || "owner@example.com",
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now,
  };
  if (!fake.find("employee_profiles", "main", row.employee_id)) {
    fake.seed("employee_profiles", {
      id: row.employee_id,
      salon_id: "main",
      firebase_uid: null,
      name: row.employee_name,
      email: null,
      phone_normalized: null,
      status: "active",
      created_at: now,
      updated_at: now,
    });
  }
  if (!fake.rows("employee_employment").some((item) => item.salon_id === "main" && item.employee_id === row.employee_id)) {
    fake.seed("employee_employment", {
      salon_id: "main",
      employee_id: row.employee_id,
      employment_status: "active",
      job_title: row.job_title,
      base_salary_halalas: row.base_salary_halalas,
      housing_allowance_halalas: 0,
      transportation_allowance_halalas: 0,
      other_allowances_halalas: 0,
      social_insurance_category: "non_saudi",
      social_insurance_effective_from: "2020-01-01",
      gosi_wage_mode: "derived",
      gosi_contributory_wage_override_halalas: 0,
      gosi_contributory_wage_override_reason: null,
      attendance_payroll_mode: "required",
      created_at: now,
      updated_at: now,
    });
  }
  if (!fake.rows("hr_work_schedules").some((item) => item.salon_id === "main" && item.employee_id === row.employee_id)) {
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      fake.seed("hr_work_schedules", {
        id: `${row.employee_id}__payroll-weekday-${weekday}`,
        salon_id: "main",
        employee_id: row.employee_id,
        weekday,
        shift_template_id: null,
        active: 1,
        start_time: "09:00",
        end_time: "17:00",
        effective_from: "2020-01-01",
        effective_to: null,
        schedule_source: "payroll_test_fixture",
        created_at: now,
        updated_at: now,
      });
    }
  }
  if (!fake.rows("attendance_records").some((item) => item.salon_id === "main" && item.employee_id === row.employee_id)) {
    fake.seed("attendance_records", {
      id: `${row.employee_id}__payroll-check-in`,
      salon_id: "main",
      employee_id: row.employee_id,
      employee_uid: null,
      date_key: "2026-07-01",
      record_type: "check_in",
      recorded_at: "2026-07-01T06:00:00.000Z",
      latitude: null,
      longitude: null,
      accuracy_meters: null,
      zone_id: null,
      device_id: null,
      source: "payroll_test_fixture",
      note: null,
      idempotency_key: null,
      created_at: now,
    });
  }
  fake.seed("payroll_entries", row);
  return row;
}

function payrollSavePayload(overrides = {}) {
  return {
    employeeId: "emp-maryam",
    employeeName: "Maryam",
    payrollMonth: "2026-07",
    baseSalaryHalalas: 310000,
    allowancesHalalas: 0,
    workDays: 30,
    monthlyHours: 240,
    dailyRateHalalas: 10333,
    hourlyRateHalalas: 1292,
    absenceDays: 30,
    absenceDeductionHalalas: 0,
    expectedWorkHours: 240,
    actualWorkedHours: 0,
    missingHours: 240,
    overtimeHours: 0,
    attendanceSummary: {
      totalScheduledHours: 240,
      totalActualWorkedHours: 0,
      totalLateHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 240,
      totalExtraHours: 0,
      attendanceDays: 0,
      absentDays: 30,
      incompleteDays: 0,
      attendanceRecordCount: 0,
      attendanceLinkStatus: "confirmed",
      attendanceDeductionEligible: true,
    },
    detectedExtraHours: 0,
    overtimeEnabled: false,
    financialOvertimeHours: 0,
    overtimeMultiplier: 1.5,
    overtimeValueHalalas: 0,
    overtimeBonusHalalas: 0,
    delayDeductionHalalas: 0,
    insuranceDeductionHalalas: 0,
    otherDeductionsHalalas: 0,
    missingHoursDeductionHalalas: 310080,
    additions: [],
    manualAdditionsHalalas: 0,
    manualDeductionsHalalas: 0,
    advancesHalalas: 0,
    totalDeductionsHalalas: 310080,
    grossSalaryHalalas: 310000,
    finalSalaryHalalas: 0,
    netSalaryHalalas: 0,
    scheduleSnapshot: {
      payrollSetupComplete: true,
      payrollSetupMissing: [],
      dailyScheduledHours: 8,
      monthlyHoursSource: "configured_monthly_hours",
    },
    deductions: [],
    status: "draft",
    ...overrides,
  };
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

test("core attendance endpoint returns core D1 records", async () => {
  const fake = new FakeD1();
  fake.seed("attendance_records", {
    id: "core-attendance-a",
    salon_id: "main",
    employee_id: "staff-a",
    employee_uid: "staff1",
    date_key: "2026-07-20",
    record_type: "check_in",
    recorded_at: "2026-07-20T06:00:00.000Z",
    latitude: null,
    longitude: null,
    accuracy_meters: null,
    zone_id: null,
    device_id: null,
    source: "app",
    note: null,
    idempotency_key: null,
    created_at: "2026-07-20T06:00:01.000Z",
  });

  const response = await worker.fetch(
    request("/api/core/hr/attendance?employeeId=staff-a&dateKey=2026-07-20"),
    env(fake)
  );
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].id, "core-attendance-a");
  assert.equal(body.data[0].record_type, "check_in");
});

test("core attendance endpoint merges and normalizes malikat attendance records", async () => {
  const core = new FakeD1();
  const attendance = new FakeD1();
  core.seed("attendance_records", {
    id: "core-attendance-b",
    salon_id: "main",
    employee_id: "core-staff",
    employee_uid: "core-uid",
    date_key: "2026-07-22",
    record_type: "check_out",
    recorded_at: "2026-07-22T10:00:00.000Z",
    latitude: null,
    longitude: null,
    accuracy_meters: null,
    zone_id: null,
    device_id: null,
    source: "app",
    note: null,
    idempotency_key: null,
    created_at: "2026-07-22T10:00:01.000Z",
  });
  attendance.seed("attendance_records", {
    id: "malikat-allowed-a",
    employee_doc_id: "1001",
    employee_uid: "SForOsVcv9QZLRc1GO3OK9KxMtV2",
    type: "check_in",
    server_time: "2026-07-22T21:05:40.317Z",
    client_time: "2026-07-22T21:05:38.000Z",
    location_lat: 24.7136,
    location_lng: 46.6753,
    location_accuracy: 12,
    zone_id: "salon-zone",
    zone_name: "Salon",
    result: "allowed",
    rejection_reason: "",
    created_at: "2026-07-22T21:05:41.000Z",
  });
  attendance.seed("attendance_records", {
    id: "malikat-denied-a",
    employee_doc_id: "1001",
    employee_uid: "SForOsVcv9QZLRc1GO3OK9KxMtV2",
    type: "check_out",
    server_time: "2026-07-22T22:00:00.000Z",
    result: "denied",
    created_at: "2026-07-22T22:00:01.000Z",
  });
  attendance.seed("attendance_records", {
    id: "malikat-break-a",
    employee_doc_id: "1001",
    employee_uid: "SForOsVcv9QZLRc1GO3OK9KxMtV2",
    type: "break_start",
    server_time: "2026-07-22T23:00:00.000Z",
    result: "allowed",
    created_at: "2026-07-22T23:00:01.000Z",
  });

  const merged = await worker.fetch(
    request("/api/core/hr/attendance"),
    { ...env(core), ATTENDANCE_DB: attendance }
  );
  const mergedBody = await json(merged);
  assert.equal(merged.status, 200, JSON.stringify(mergedBody));
  assert.deepEqual(mergedBody.data.map((row) => row.id), ["malikat:malikat-allowed-a", "core-attendance-b"]);
  assert.equal(mergedBody.data[0].employee_id, "1001");
  assert.equal(mergedBody.data[0].employee_uid, "SForOsVcv9QZLRc1GO3OK9KxMtV2");
  assert.equal(mergedBody.data[0].record_type, "check_in");
  assert.equal(mergedBody.data[0].recorded_at, "2026-07-22T21:05:40.317Z");
  assert.equal(mergedBody.data[0].date_key, "2026-07-23");
  assert.equal(mergedBody.data[0].latitude, 24.7136);
  assert.equal(mergedBody.data[0].longitude, 46.6753);
  assert.equal(mergedBody.data[0].accuracy_meters, 12);
  assert.equal(mergedBody.data[0].zone_id, "salon-zone");
  assert.equal(mergedBody.data[0].source, "malikat-attendance");

  const byEmployeeDocId = await worker.fetch(
    request("/api/core/hr/attendance?employeeId=1001"),
    { ...env(core), ATTENDANCE_DB: attendance }
  );
  const byEmployeeDocIdBody = await json(byEmployeeDocId);
  assert.equal(byEmployeeDocId.status, 200, JSON.stringify(byEmployeeDocIdBody));
  assert.deepEqual(byEmployeeDocIdBody.data.map((row) => row.id), ["malikat:malikat-allowed-a"]);

  const byEmployeeUid = await worker.fetch(
    request("/api/core/hr/attendance?employeeId=SForOsVcv9QZLRc1GO3OK9KxMtV2"),
    { ...env(core), ATTENDANCE_DB: attendance }
  );
  const byEmployeeUidBody = await json(byEmployeeUid);
  assert.equal(byEmployeeUid.status, 200, JSON.stringify(byEmployeeUidBody));
  assert.deepEqual(byEmployeeUidBody.data.map((row) => row.id), ["malikat:malikat-allowed-a"]);

  const byDateKey = await worker.fetch(
    request("/api/core/hr/attendance?dateKey=2026-07-23"),
    { ...env(core), ATTENDANCE_DB: attendance }
  );
  const byDateKeyBody = await json(byDateKey);
  assert.equal(byDateKey.status, 200, JSON.stringify(byDateKeyBody));
  assert.deepEqual(byDateKeyBody.data.map((row) => row.id), ["malikat:malikat-allowed-a"]);
});

test("core absence endpoint stores canonical employee id and filters by employee identity", async () => {
  const fake = new FakeD1();
  fake.seed("employee_profiles", {
    id: "1002",
    salon_id: "main",
    firebase_uid: "eqnFOm4TtWdAjpLeG4XopdEj24I2",
    name: "Sabah",
    email: null,
    phone_normalized: null,
    status: "active",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  });
  const response = await worker.fetch(request("/api/core/hr/absences", {
    method: "POST",
    body: {
      id: "absence-sabah-2026-07-15",
      employeeId: "eqnFOm4TtWdAjpLeG4XopdEj24I2",
      date: "2026-07-15",
      type: "admin",
      note: "غياب إداري",
    },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.employee_id, "1002");
  assert.equal(body.data.employee_uid, "eqnFOm4TtWdAjpLeG4XopdEj24I2");
  assert.equal(body.data.absence_type, "admin");
  assert.equal(body.data.date_key, "2026-07-15");
  assert.equal(body.data.created_by_uid, "owner1");

  const stored = fake.rows("employee_absences")[0];
  assert.equal(stored.salon_id, "main");
  assert.equal(stored.employee_id, "1002");
  assert.equal(stored.employee_uid, "eqnFOm4TtWdAjpLeG4XopdEj24I2");

  const byEmployeeId = await worker.fetch(
    request("/api/core/hr/absences?employeeId=1002"),
    env(fake)
  );
  const byEmployeeIdBody = await json(byEmployeeId);
  assert.equal(byEmployeeId.status, 200, JSON.stringify(byEmployeeIdBody));
  assert.deepEqual(byEmployeeIdBody.data.map((row) => row.id), ["absence-sabah-2026-07-15"]);

  const byEmployeeUid = await worker.fetch(
    request("/api/core/hr/absences?employeeId=eqnFOm4TtWdAjpLeG4XopdEj24I2"),
    env(fake)
  );
  const byEmployeeUidBody = await json(byEmployeeUid);
  assert.equal(byEmployeeUid.status, 200, JSON.stringify(byEmployeeUidBody));
  assert.deepEqual(byEmployeeUidBody.data.map((row) => row.id), ["absence-sabah-2026-07-15"]);
});

test("approved payroll can be reopened by admin and records audit details", async () => {
  const fake = new FakeD1();
  seedPayrollEntry(fake, {
    id: "payroll-reopen-approved",
    approved_at: "2026-07-28T10:00:00.000Z",
    approved_by_uid: "owner1",
  });

  const response = await worker.fetch(request("/api/core/hr/payroll-entries/payroll-reopen-approved/reopen", {
    method: "POST",
    token: "test:admin1:admin",
    body: {
      reason: "recalculate attendance after absence policy fix",
      status: "draft",
    },
  }), env(fake));
  const body = await json(response);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "draft");
  assert.equal(body.data.approved_at, null);
  assert.equal(body.data.approved_by_uid, null);

  const audit = JSON.parse(body.data.audit_log_json);
  const reopened = audit.at(-1);
  assert.equal(reopened.action, "reopened");
  assert.equal(reopened.byUid, "admin1");
  assert.equal(reopened.byEmail, "admin@example.com");
  assert.equal(reopened.reason, "recalculate attendance after absence policy fix");
  assert.equal(reopened.previousStatus, "approved");
  assert.equal(reopened.previousApprovedAt, "2026-07-28T10:00:00.000Z");
  assert.equal(reopened.previousApprovedByUid, "owner1");
});

test("paid payroll cannot be reopened", async () => {
  const fake = new FakeD1();
  seedPayrollEntry(fake, {
    id: "payroll-reopen-paid",
    status: "paid",
    paid_at: "2026-07-29T10:00:00.000Z",
    paid_by_uid: "owner1",
  });

  const response = await worker.fetch(request("/api/core/hr/payroll-entries/payroll-reopen-paid/reopen", {
    method: "POST",
    body: { reason: "attempt paid reopen" },
  }), env(fake));
  const body = await json(response);

  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, "core_payroll:paid_reopen_not_allowed");
  assert.equal(fake.find("payroll_entries", "main", "payroll-reopen-paid").status, "paid");
});

test("reopened payroll can be recalculated and updates attendance summary", async () => {
  const fake = new FakeD1();
  seedPayrollEntry(fake, { id: "payroll-recalculate-after-reopen" });

  const reopenResponse = await worker.fetch(request("/api/core/hr/payroll-entries/payroll-recalculate-after-reopen/reopen", {
    method: "POST",
    body: { reason: "recalculate attendance summary" },
  }), env(fake));
  assert.equal(reopenResponse.status, 200, JSON.stringify(await json(reopenResponse)));

  const saveResponse = await worker.fetch(request("/api/core/hr/payroll-entries", {
    method: "POST",
    body: payrollSavePayload({ id: "payroll-recalculate-after-reopen" }),
  }), env(fake));
  const saveBody = await json(saveResponse);

  assert.equal(saveResponse.status, 200, JSON.stringify(saveBody));
  assert.equal(saveBody.data.status, "draft");
  assert.equal(saveBody.data.missing_hours, 240);
  const attendance = JSON.parse(saveBody.data.attendance_summary_json);
  assert.equal(attendance.absentDays, 30);
  assert.equal(attendance.totalMissingHours, 240);
  assert.equal(attendance.attendanceLinkStatus, "confirmed");
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

test("client profile update validates identity and keeps existing bookings linked", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  await createCoreBooking(fake, { id: "booking-client-profile" });
  fake.seed("clients", {
    id: "client-b",
    salon_id: "main",
    name: "Client B",
    phone_normalized: "0500000002",
    status: "active",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });

  let response = await worker.fetch(request("/api/core/clients/client-a", {
    method: "PATCH",
    body: { name: "  نورة   الحربي  ", phone: "+966 55-123-4567" },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.name, "نورة الحربي");
  assert.equal(body.data.phone_normalized, "0551234567");

  response = await worker.fetch(request("/api/core/bookings/booking-client-profile"), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.client_id, "client-a");
  assert.equal(body.data.client_name, "نورة الحربي");
  assert.equal(body.data.client_phone, "0551234567");

  response = await worker.fetch(request("/api/core/clients/client-a", {
    method: "PATCH",
    body: { phone: "0500000002" },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, "core_client:phone_conflict");

  response = await worker.fetch(request("/api/core/clients/client-a", {
    method: "PATCH",
    body: { name: "    " },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(body.error, "core_validation:invalid_text");

  response = await worker.fetch(request("/api/core/clients/client-a", {
    method: "PATCH",
    body: { phone: "123" },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(body.error, "core_client:invalid_phone");

  response = await worker.fetch(request("/api/core/clients/client-a", {
    method: "PATCH",
    token: "test:reception1:reception",
    body: { name: "غير مسموح" },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 403, JSON.stringify(body));
  assert.equal(fake.find("bookings", "main", "booking-client-profile").client_id, "client-a");
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

test("backdated booking creation requires the authenticated internal route", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const bookingDate = riyadhDateOffset(-1);
  const baseBody = {
    salonId: "main",
    clientId: "client-a",
    staffId: "staff-a",
    source: "internal",
    bookingDate,
    startTime: "10:00",
    items: [{ serviceId: "svc-a" }],
  };

  let response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    token: "",
    body: { ...baseBody, id: "booking-past-guest" },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(body.error, "core_booking:past_date_not_allowed");

  response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: { ...baseBody, id: "booking-past-public-owner" },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(body.error, "core_booking:past_date_not_allowed");

  response = await worker.fetch(request("/api/core/internal/bookings", {
    method: "POST",
    token: "test:client-user:client",
    body: { ...baseBody, id: "booking-past-client" },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 403, JSON.stringify(body));
  assert.equal(body.error, "core_auth:insufficient_permissions");

  const startedAt = Date.now();
  response = await worker.fetch(request("/api/core/internal/bookings", {
    method: "POST",
    body: {
      ...baseBody,
      id: "booking-past-internal",
      invoiceId: "invoice-past-internal",
      source: "client",
      items: [{ id: "item-past-internal", serviceId: "svc-a" }],
    },
  }), env(fake));
  body = await json(response);
  const finishedAt = Date.now();
  assert.equal(response.status, 200, JSON.stringify(body));

  const booking = fake.find("bookings", "main", "booking-past-internal");
  const item = fake.find("booking_items", "main", "item-past-internal");
  const invoice = fake.find("invoices", "main", "invoice-past-internal");
  const audit = fake.rows("audit_logs").find(
    (row) => row.action === "booking_created" && row.entity_id === "booking-past-internal"
  );
  assert.equal(booking.booking_date, bookingDate);
  assert.equal(booking.source, "internal");
  assert.equal(booking.created_by_uid, "owner1");
  assert.equal(item.booking_date, bookingDate);
  assert.equal(invoice.booking_id, booking.id);
  assert.ok(Date.parse(booking.created_at) >= startedAt && Date.parse(booking.created_at) <= finishedAt);
  assert.ok(Date.parse(invoice.created_at) >= startedAt && Date.parse(invoice.created_at) <= finishedAt);
  assert.ok(audit, "backdated creation must remain visible in the audit log");
  assert.equal(JSON.parse(audit.after_json).bookingDate, bookingDate);
  assert.equal(JSON.parse(audit.after_json).backdated, true);
});

test("public booking rejects a past item date even when its parent date is future", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    token: "",
    body: {
      salonId: "main",
      id: "booking-future-parent-past-item",
      clientId: "client-a",
      staffId: "staff-a",
      source: "internal",
      bookingDate: "2099-01-10",
      startTime: "10:00",
      items: [{ id: "item-past", serviceId: "svc-a", bookingDate: "2020-01-10" }],
    },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(body.error, "core_booking:past_date_not_allowed");
  assert.equal(fake.rows("bookings").length, 0);
});

test("booking creation canonicalizes a stale service id by an exact Core service name", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-stale-service",
      invoiceId: "invoice-stale-service",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-11",
      startTime: "10:00",
      items: [{
        id: "item-stale-service",
        serviceId: "legacy-firestore-service-id",
        serviceName: "Service A",
      }],
    },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  const item = fake.rows("booking_items").find((row) => row.id === "item-stale-service");
  assert.equal(item?.service_id, "svc-a");
  assert.equal(item?.service_name_snapshot, "Service A");
});

test("booking creation resolves a legacy Arabic service label to one canonical Core service", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  fake.seed("services", {
    id: "svc-blowdry-short",
    salon_id: "main",
    name: "استشوار قصير",
    section_id: "hair-care",
    category_id: "blowdry",
    duration_minutes: 30,
    price_halalas: 5000,
    active: 1,
    sort_order: 2,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  fake.seed("staff_services", { salon_id: "main", staff_id: "staff-a", service_id: "svc-blowdry-short", active: 1, created_at: "2027-01-01T00:00:00.000Z", updated_at: "2027-01-01T00:00:00.000Z" });
  fake.seed("staff_services", {
    salon_id: "main",
    staff_id: "staff-a",
    service_id: "svc-blowdry-short",
    active: 1,
    created_at: typeof now === "string" ? now : "2026-01-01T00:00:00.000Z",
    updated_at: typeof now === "string" ? now : "2026-01-01T00:00:00.000Z",
  });
  fake.seed("services", {
    id: "svc-blowdry-long",
    salon_id: "main",
    name: "استشوار طويل",
    section_id: "hair-care",
    category_id: "blowdry",
    duration_minutes: 45,
    price_halalas: 7500,
    active: 1,
    sort_order: 3,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  fake.seed("staff_services", {
    salon_id: "main",
    staff_id: "staff-a",
    service_id: "svc-blowdry-long",
    active: 1,
    created_at: typeof now === "string" ? now : "2026-01-01T00:00:00.000Z",
    updated_at: typeof now === "string" ? now : "2026-01-01T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-arabic-stale-service",
      invoiceId: "invoice-arabic-stale-service",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-11",
      startTime: "11:00",
      items: [{
        id: "item-arabic-stale-service",
        serviceId: "legacy-firestore-blowdry-short",
        serviceName: "الاستشوار - شعر قصير",
      }],
    },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  const item = fake.rows("booking_items").find(
    (row) => row.id === "item-arabic-stale-service"
  );
  assert.equal(item?.service_id, "svc-blowdry-short");
  assert.equal(item?.service_name_snapshot, "استشوار قصير");
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
  const queryLogStart = fake.allQueries.length;
  const response = await worker.fetch(request("/api/core/bookings"), env(fake));
  const body = await json(response);
  const reads = fake.allQueryCount - before;
  const bookingQueries = fake.allQueries.slice(queryLogStart).map((entry) => entry.sql);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.length, 150);
  assert.equal(body.data[0].client_name, "Client A");
  assert.equal(body.data[0].staff_name, "Staff A");
  assert.equal(body.data[0].items.length, 1);
  assert.ok(reads <= 12, `expected bounded reads, received ${reads}`);
  assert.ok(
    bookingQueries.some((sql) => sql.startsWith("SELECT * FROM clients WHERE salon_id = ? AND id IN (")),
    "booking hydration must scope client reads to referenced client ids"
  );
  assert.ok(
    bookingQueries.some((sql) => sql.startsWith("SELECT * FROM invoices WHERE salon_id = ? AND booking_id IN (")),
    "booking hydration must scope invoice reads to referenced booking ids"
  );
  assert.ok(
    bookingQueries.some((sql) => sql.startsWith("SELECT * FROM booking_items WHERE salon_id = ? AND booking_id IN (")),
    "booking item hydration must preserve the tenant fence"
  );
  assert.ok(
    !bookingQueries.some((sql) => sql.startsWith("SELECT * FROM clients WHERE salon_id = ? ORDER BY")),
    "booking hydration must not scan the tenant client table"
  );
  assert.ok(
    !bookingQueries.some((sql) => sql.startsWith("SELECT * FROM invoices WHERE salon_id = ? ORDER BY")),
    "booking hydration must not scan the tenant invoice table"
  );
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
  fake.seed("staff_services", { salon_id: "main", staff_id: "staff-a", service_id: "svc-b", active: 1, created_at: now, updated_at: now });
  fake.seed("staff_services", {
    salon_id: "main",
    staff_id: "staff-a",
    service_id: "svc-b",
    active: 1,
    created_at: typeof now === "string" ? now : "2026-01-01T00:00:00.000Z",
    updated_at: typeof now === "string" ? now : "2026-01-01T00:00:00.000Z",
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
  fake.seed("staff_services", { salon_id: "main", staff_id: "staff-a", service_id: "svc-b", active: 1, created_at: now, updated_at: now });
  fake.seed("staff_services", {
    salon_id: "main",
    staff_id: "staff-a",
    service_id: "svc-b",
    active: 1,
    created_at: typeof now === "string" ? now : "2026-01-01T00:00:00.000Z",
    updated_at: typeof now === "string" ? now : "2026-01-01T00:00:00.000Z",
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

test("booking mutation routes enforce canonical permissions", async () => {
  const fake = new FakeD1();
  seedCore(fake);

  const seedBooking = (id) => {
    fake.seed("bookings", {
      id,
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
      payment_status: "unpaid",
      package_sessions_used: 0,
      created_by_uid: "owner1",
      created_at: "2027-01-01T00:00:00.000Z",
      updated_at: "2027-01-01T00:00:00.000Z",
      cancelled_at: null,
      completed_at: null,
    });
  };

  const expectForbidden = async (path, options) => {
    const response = await worker.fetch(request(path, options), env(fake));
    const body = await json(response);
    assert.equal(response.status, 403, JSON.stringify(body));
    return body;
  };

  seedBooking("booking-auth-operational");
  await expectForbidden("/api/core/bookings/booking-auth-operational", {
    method: "PATCH",
    token: "test:hr1:hr",
    body: { notes: "forbidden operational edit" },
  });

  seedBooking("booking-auth-financial");
  await expectForbidden("/api/core/bookings/booking-auth-financial", {
    method: "PATCH",
    token: "test:accountant1:accountant",
    body: { paidHalalas: 2500, reconcilePayment: true },
  });

  seedBooking("booking-auth-mixed");
  await expectForbidden("/api/core/bookings/booking-auth-mixed", {
    method: "PATCH",
    token: "test:accountant1:accountant",
    body: {
      notes: "mixed edit",
      paidHalalas: 2500,
      reconcilePayment: true,
    },
  });

  seedBooking("booking-auth-delete-reception");
  await expectForbidden("/api/core/bookings/booking-auth-delete-reception", {
    method: "DELETE",
    token: "test:reception1:reception",
    body: {},
  });

  seedBooking("booking-auth-complete-accountant");
  await expectForbidden(
    "/api/core/bookings/booking-auth-complete-accountant/complete",
    {
      method: "POST",
      token: "test:accountant1:accountant",
      body: { salonId: "main" },
    }
  );

  seedBooking("booking-auth-cancel-accountant");
  await expectForbidden(
    "/api/core/bookings/booking-auth-cancel-accountant/cancel",
    {
      method: "POST",
      token: "test:accountant1:accountant",
      body: { salonId: "main", reason: "forbidden" },
    }
  );

  seedBooking("booking-auth-reschedule-accountant");
  await expectForbidden(
    "/api/core/bookings/booking-auth-reschedule-accountant/reschedule",
    {
      method: "POST",
      token: "test:accountant1:accountant",
      body: {
        salonId: "main",
        bookingDate: "2027-01-11",
        startTime: "10:00",
      },
    }
  );

  const internalResponse = await worker.fetch(
    request("/api/core/internal/bookings", {
      method: "POST",
      token: "test:accountant1:accountant",
      body: {
        salonId: "main",
        id: "booking-auth-internal",
        clientId: "client-a",
        staffId: "staff-a",
        bookingDate: "2027-01-10",
        startTime: "12:00",
        items: [{ id: "item-auth-internal", serviceId: "svc-a" }],
      },
    }),
    env(fake)
  );
  assert.equal(
    internalResponse.status,
    403,
    JSON.stringify(await json(internalResponse))
  );

  seedBooking("booking-auth-owner-financial");
  const ownerFinancial = await worker.fetch(
    request("/api/core/bookings/booking-auth-owner-financial", {
      method: "PATCH",
      body: {
        paymentStatus: "partial",
      },
    }),
    env(fake)
  );
  assert.equal(
    ownerFinancial.status,
    200,
    JSON.stringify(await json(ownerFinancial))
  );
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

test("booking payment reconciliation replaces canonical payment and income rows atomically", async () => {
  const fake = new FakeD1();
  seedCore(fake);

  await createCoreBooking(fake, {
    id: "booking-reconcile-edit",
    invoiceId: "invoice-reconcile-edit",
  });

  fake.seed("payments", {
    id: "payment-reconcile-old",
    salon_id: "main",
    invoice_id: "invoice-reconcile-edit",
    booking_id: "booking-reconcile-edit",
    client_id: "client-a",
    method: "card",
    amount_halalas: 7500,
    status: "paid",
    provider: "seed",
    created_at: "2026-01-01T00:00:00.000Z",
  });

  fake.seed("income_entries", {
    id: "income-reconcile-old",
    salon_id: "main",
    booking_id: "booking-reconcile-edit",
    invoice_id: "invoice-reconcile-edit",
    payment_id: "payment-reconcile-old",
    amount_halalas: 7500,
    category: "payment",
    description: "Old payment",
    method: "card",
    source: "booking",
    occurred_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  });

  fake.update("invoices", "main", "invoice-reconcile-edit", {
    paid_halalas: 7500,
    status: "paid",
  });

  fake.update("bookings", "main", "booking-reconcile-edit", {
    payment_status: "paid",
  });

  const response = await worker.fetch(
    request("/api/core/bookings/booking-reconcile-edit", {
      method: "PATCH",
      body: {
        paidHalalas: 2500,
        paymentMethod: "card",
        reconcilePayment: true,
      },
    }),
    env(fake)
  );

  assert.equal(response.status, 200);

  const booking = fake.find(
    "bookings",
    "main",
    "booking-reconcile-edit"
  );

  const invoice = fake.find(
    "invoices",
    "main",
    "invoice-reconcile-edit"
  );

  const payments = fake
    .rows("payments")
    .filter(
      (row) =>
        row.salon_id === "main" &&
        row.booking_id === "booking-reconcile-edit"
    );

  const incomeRows = fake
    .rows("income_entries")
    .filter(
      (row) =>
        row.salon_id === "main" &&
        row.booking_id === "booking-reconcile-edit" &&
        row.payment_id
    );

  assert.equal(booking.payment_status, "partial");

  assert.equal(Number(invoice.paid_halalas), 2500);
  assert.equal(invoice.status, "partial");

  assert.equal(payments.length, 1);
  assert.equal(payments[0].method, "card");
  assert.equal(Number(payments[0].amount_halalas), 2500);
  assert.equal(payments[0].provider, "dashboard_edit");
  assert.notEqual(payments[0].id, "payment-reconcile-old");

  assert.equal(incomeRows.length, 1);
  assert.equal(incomeRows[0].payment_id, payments[0].id);
  assert.equal(incomeRows[0].invoice_id, "invoice-reconcile-edit");
  assert.equal(incomeRows[0].method, "card");
  assert.equal(Number(incomeRows[0].amount_halalas), 2500);
  assert.notEqual(incomeRows[0].id, "income-reconcile-old");

  assert.equal(
    fake.find("payments", "main", "payment-reconcile-old"),
    null
  );

  assert.equal(
    fake.find("income_entries", "main", "income-reconcile-old"),
    null
  );

  assert.equal(
    payments.reduce(
      (sum, row) => sum + Number(row.amount_halalas || 0),
      0
    ),
    Number(invoice.paid_halalas)
  );

  assert.equal(
    incomeRows.reduce(
      (sum, row) => sum + Number(row.amount_halalas || 0),
      0
    ),
    Number(invoice.paid_halalas)
  );
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

test("income routes enforce canonical income permissions", async () => {
  const fake = new FakeD1();
  seedCore(fake);

  let response = await worker.fetch(request("/api/core/income", {
    token: "test:accountant1:accountant",
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/income", {
    method: "POST",
    token: "test:accountant1:accountant",
    body: { id: "income-accountant", amountHalalas: 1000, method: "cash" },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/income", {
    token: "test:hr1:hr",
  }), env(fake));
  assert.equal(response.status, 403, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/income", {
    method: "POST",
    token: "test:hr1:hr",
    body: { id: "income-forbidden", amountHalalas: 1000, method: "cash" },
  }), env(fake));
  assert.equal(response.status, 403, JSON.stringify(await json(response)));
});

test("income read model hydrates booking metadata without bookings.view", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const now = "2027-01-01T00:00:00.000Z";

  fake.seed("bookings", {
    id: "booking-income-direct",
    public_id: "QS-270110-INCOME01",
    salon_id: "main",
    client_id: "client-a",
    staff_id: "staff-a",
    booking_date: "2027-01-10",
    start_time: "10:00",
    end_time: "10:30",
    status: "completed",
    source: "test",
    total_halalas: 10000,
    payment_status: "partial",
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  fake.seed("invoices", {
    id: "invoice-income-latest",
    salon_id: "main",
    booking_id: "booking-income-direct",
    client_id: "client-a",
    invoice_number: "INV-LATEST",
    total_halalas: 10000,
    paid_halalas: 9000,
    status: "partial",
    issued_at: "2027-01-11T00:00:00.000Z",
    created_at: "2027-01-11T00:00:00.000Z",
  });

  fake.seed("invoices", {
    id: "invoice-income-linked",
    salon_id: "main",
    booking_id: "booking-income-direct",
    client_id: "client-a",
    invoice_number: "INV-LINKED",
    total_halalas: 10000,
    paid_halalas: 4000,
    status: "partial",
    issued_at: "2027-01-10T00:00:00.000Z",
    created_at: "2027-01-10T00:00:00.000Z",
  });

  fake.seed("income_entries", {
    id: "income-booking-direct",
    salon_id: "main",
    booking_id: "booking-income-direct",
    invoice_id: "invoice-income-linked",
    amount_halalas: 4000,
    method: "cash",
    source: "booking",
    occurred_at: "2027-01-10T10:30:00.000Z",
    created_at: "2027-01-10T10:30:00.000Z",
  });

  fake.seed("bookings", {
    id: "booking-income-item-staff",
    public_id: "QS-270110-INCOME02",
    salon_id: "main",
    client_id: "client-a",
    staff_id: null,
    booking_date: "2027-01-10",
    start_time: "11:00",
    end_time: "11:30",
    status: "completed",
    source: "test",
    total_halalas: 7500,
    payment_status: "paid",
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  fake.seed("booking_items", {
    id: "item-income-staff",
    salon_id: "main",
    booking_id: "booking-income-item-staff",
    service_id: "service-a",
    service_name_snapshot: "Service A",
    staff_id: "staff-a",
    booking_date: "2027-01-10",
    start_time: "11:00",
    end_time: "11:30",
    created_at: now,
  });

  fake.seed("invoices", {
    id: "invoice-income-item-staff",
    salon_id: "main",
    booking_id: "booking-income-item-staff",
    client_id: "client-a",
    invoice_number: "INV-ITEM-STAFF",
    total_halalas: 7500,
    paid_halalas: 7500,
    status: "paid",
    issued_at: "2027-01-10T11:30:00.000Z",
    created_at: "2027-01-10T11:30:00.000Z",
  });

  fake.seed("income_entries", {
    id: "income-booking-item-staff",
    salon_id: "main",
    booking_id: "booking-income-item-staff",
    invoice_id: "invoice-income-item-staff",
    amount_halalas: 7500,
    method: "card",
    source: "booking",
    occurred_at: "2027-01-10T11:30:00.000Z",
    created_at: "2027-01-10T11:30:00.000Z",
  });

  const response = await worker.fetch(request("/api/core/income", {
    token: "test:accountant1:accountant",
  }), env(fake));
  const body = await json(response);

  assert.equal(response.status, 200, JSON.stringify(body));

  const direct = body.data.find((row) => row.id === "income-booking-direct");
  assert.ok(direct);
  assert.equal(direct.booking_public_id, "QS-270110-INCOME01");
  assert.equal(direct.booking_date, "2027-01-10");
  assert.equal(direct.booking_status, "completed");
  assert.equal(direct.booking_total_halalas, 10000);
  assert.equal(direct.booking_paid_halalas, 4000);
  assert.equal(direct.booking_payment_status, "partial");
  assert.equal(direct.booking_staff_id, "staff-a");
  assert.equal(direct.booking_staff_name, "Staff A");
  assert.equal(direct.booking_client_name, "Client A");
  assert.equal(direct.booking_invoice_id, "invoice-income-linked");
  assert.equal(direct.booking_invoice_number, "INV-LINKED");

  const fallback = body.data.find((row) => row.id === "income-booking-item-staff");
  assert.ok(fallback);
  assert.equal(fallback.booking_staff_id, "staff-a");
  assert.equal(fallback.booking_staff_name, "Staff A");
  assert.equal(fallback.booking_paid_halalas, 7500);
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

test("core migration emits D1 operational identity and permission tables", () => {
  const result = spawnSync(process.execPath, [
    "scripts/migrate-core-firestore-to-d1.mjs",
    "--input=scripts/fixtures/core-migration-fixture.json",
    "--today=2026-07-16",
    "--dump-sql",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /INSERT OR REPLACE INTO roles /);
  assert.match(result.stdout, /INSERT OR REPLACE INTO permissions /);
  assert.match(result.stdout, /INSERT OR REPLACE INTO role_permissions /);
  assert.match(result.stdout, /INSERT OR REPLACE INTO app_users /);
  assert.equal(migrationTableCount(result.stdout, "user_employee_links"), 0);
  assert.match(result.stdout, /accounts\.update/);
  assert.match(result.stdout, /permissions\.manage/);
  assert.doesNotMatch(result.stdout, /salons\/main\/users/);
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
  assert.equal(migrationTableCount(result.stdout, "booking_slot_locks"), 6);
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
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
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

test("approved employee leave blocks booking and is exposed by availability", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  fake.seed("employee_leaves", {
    id: "leave-a",
    salon_id: "main",
    employee_id: "staff-a",
    leave_type: "annual",
    start_date: "2027-01-09",
    end_date: "2027-01-11",
    duration_kind: "full",
    status: "approved",
    note: "annual leave",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
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

test("authenticated client can load public /booking data without operations permissions", async () => {
  const fake = new FakeD1();
  const now = new Date().toISOString();

  fake.seed("service_sections", {
    id: "visible-section", salon_id: "main", name: "Visible", active: 1, sort_order: 1, created_at: now, updated_at: now,
  });
  fake.seed("service_sections", {
    id: "hidden-section", salon_id: "main", name: "Hidden", active: 0, sort_order: 2, created_at: now, updated_at: now,
  });
  fake.seed("staff", {
    id: "visible-staff", salon_id: "main", firebase_uid: "staff-visible", name: "Visible Staff",
    active: 1, show_on_booking: 1, employment_status: "active", created_at: now, updated_at: now,
  });
  fake.seed("staff", {
    id: "hidden-staff", salon_id: "main", firebase_uid: "staff-hidden", name: "Hidden Staff",
    active: 1, show_on_booking: 0, employment_status: "active", created_at: now, updated_at: now,
  });
  fake.seed("staff", {
    id: "inactive-staff", salon_id: "main", firebase_uid: "staff-inactive", name: "Inactive Staff",
    active: 1, show_on_booking: 1, employment_status: "inactive", created_at: now, updated_at: now,
  });
  fake.seed("staff", {
    id: "hr-inactive-staff", salon_id: "main", firebase_uid: "staff-hr-inactive", name: "HR Inactive Staff",
    active: 1, show_on_booking: 1, employment_status: "active", created_at: now, updated_at: now,
  });
  fake.seed("staff", {
    id: "disabled-account-staff", salon_id: "main", firebase_uid: "staff-disabled-account", name: "Disabled Account Staff",
    active: 1, show_on_booking: 1, employment_status: "active", created_at: now, updated_at: now,
  });
  fake.seed("app_users", {
    id: "user-disabled-account-staff", salon_id: "main", firebase_uid: "staff-disabled-account",
    email: "disabled-staff@example.com", display_name: "Disabled Account Staff", primary_role: "staff",
    status: "disabled", email_verified: 1, created_at: now, updated_at: now,
  });
  fake.seed("user_employee_links", {
    id: "link-disabled-account-staff", salon_id: "main",
    user_id: "user-disabled-account-staff", employee_id: "disabled-account-staff",
    link_status: "active", linked_at: now, updated_at: now,
  });
  fake.seed("employee_profiles", {
    id: "hr-inactive-staff", salon_id: "main", firebase_uid: "staff-hr-inactive", name: "HR Inactive Staff",
    status: "inactive", created_at: now, updated_at: now,
  });
  fake.seed("employee_employment", {
    salon_id: "main", employee_id: "hr-inactive-staff", employment_status: "inactive",
    created_at: now, updated_at: now,
  });
  fake.seed("discounts", {
    id: "visible-offer", salon_id: "main", code: "VISIBLE", code_key: "VISIBLE", name: "Visible Offer",
    type: "percent", value: 10, active: 1, published: 1, status: "active", deleted_at: null,
    created_at: now, updated_at: now,
  });
  fake.seed("discounts", {
    id: "deleted-offer", salon_id: "main", code: "DELETED", code_key: "DELETED", name: "Deleted Offer",
    type: "percent", value: 10, active: 1, published: 1, status: "active", deleted_at: now,
    created_at: now, updated_at: now,
  });

  const token = "test:client1:client";

  const sectionsResponse = await worker.fetch(
    request("/api/core/sections?active=true", { token }),
    env(fake)
  );
  assert.equal(sectionsResponse.status, 200);
  const sectionsBody = await json(sectionsResponse);
  assert.deepEqual(sectionsBody.data.map((row) => row.id), ["visible-section"]);

  const staffResponse = await worker.fetch(
    request("/api/core/staff?active=true", { token }),
    env(fake)
  );
  assert.equal(staffResponse.status, 200);
  const staffBody = await json(staffResponse);
  assert.deepEqual(staffBody.data.map((row) => row.id), ["visible-staff"]);

  const discountsResponse = await worker.fetch(
    request("/api/core/discounts?includeDeleted=true", { token }),
    env(fake)
  );
  assert.equal(discountsResponse.status, 200);
  const discountsBody = await json(discountsResponse);
  assert.deepEqual(discountsBody.data.map((row) => row.id), ["visible-offer"]);
});

test("authenticated client can submit a public /booking reservation", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    token: "test:client1:client",
    body: {
      salonId: "main",
      id: "client-booking-a",
      invoiceId: "invoice-client-booking-a",
      clientId: "spoofed-client-id",
      staffId: "staff-a",
      bookingDate: "2027-01-12",
      startTime: "11:00",
      items: [{ id: "item-client-booking-a", serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
  const created = fake.find("bookings", "main", "client-booking-a");
  assert.equal(created?.created_by_uid, "client1");
  assert.equal(created?.client_id, "client-a");
});

test("client identity endpoints never trust browser-supplied Firebase UID", async () => {
  const fake = new FakeD1();
  seedCore(fake);

  const clientResponse = await worker.fetch(request("/api/core/clients", {
    method: "POST",
    token: "test:client1:client",
    body: {
      salonId: "main",
      name: "Spoof attempt",
      phone: "0500000002",
      firebaseUid: "victim-uid",
    },
  }), env(fake));
  const clientBody = await json(clientResponse);
  assert.equal(clientResponse.status, 200, JSON.stringify(clientBody));
  assert.equal(clientBody.data.id, "client-a");
  assert.equal(fake.find("clients", "main", "client-a")?.firebase_uid, "client1");

  const guestResponse = await worker.fetch(request("/api/core/clients", {
    method: "POST",
    token: "",
    body: {
      salonId: "main",
      name: "Guest",
      phone: "0500000009",
      firebaseUid: "victim-uid",
    },
  }), env(fake));
  const guestBody = await json(guestResponse);
  assert.equal(guestResponse.status, 200, JSON.stringify(guestBody));
  assert.equal(fake.find("clients", "main", guestBody.data.id)?.firebase_uid, null);
});

test("reception app_user can use operational client search through D1 role authority", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const response = await worker.fetch(
    request("/api/core/clients?search=0500000001", {
      token: "test:reception1:reception",
    }),
    env(fake)
  );
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
});


test("Stage11 booking lifecycle fails closed for partial HR projections while allowing staff-only resources", async () => {
  const date = "2027-01-04";
  const weekday = new Date(date + "T12:00:00.000Z").getUTCDay();

  const resolveCase = async ({
    id,
    profileStatus = "active",
    employmentStatus = "active",
    endDate,
    profile = true,
    employment = true,
  }) => {
    const db = new FakeD1();
    db.seed("staff", {
      id, salon_id: "main", firebase_uid: null, name: id, phone_normalized: null,
      active: 1, employment_status: "active", show_on_booking: 1, created_at: date, updated_at: date,
    });
    db.seed("hr_work_schedules", {
      id: "schedule-" + id, salon_id: "main", employee_id: id, weekday,
      shift_template_id: null, start_time: "09:00", end_time: "17:00", active: 1,
      schedule_source: "test", effective_from: "2027-01-01", effective_to: null,
      created_at: date, updated_at: date,
    });
    if (profile) {
      db.seed("employee_profiles", {
        id, salon_id: "main", firebase_uid: null, name: id, status: profileStatus,
        created_at: date, updated_at: date,
      });
    }
    if (employment) {
      db.seed("employee_employment", {
        salon_id: "main", employee_id: id, employment_status: employmentStatus,
        end_date: endDate ?? null, created_at: date, updated_at: date,
      });
    }
    return resolveStaffBookingDay(db, "main", db.find("staff", "main", id), date, "10:00", "11:00");
  };

  assert.equal((await resolveCase({ id: "active-employee", profileStatus: "active", employmentStatus: "active", endDate: null })).available, true);
  assert.equal((await resolveCase({ id: "staff-only", profile: false, employment: false })).available, true);
  assert.equal((await resolveCase({ id: "profile-only", employment: false })).available, false);
  assert.equal((await resolveCase({ id: "employment-only", profile: false })).available, false);
  assert.equal((await resolveCase({ id: "inactive-employee", profileStatus: "inactive", employmentStatus: "inactive", endDate: null })).available, false);
  assert.equal((await resolveCase({ id: "inactive-profile", profileStatus: "inactive", employmentStatus: "active", endDate: null })).available, false);
  assert.equal((await resolveCase({ id: "inactive-employment", profileStatus: "active", employmentStatus: "inactive", endDate: null })).available, false);
  assert.equal((await resolveCase({ id: "offboarded-employee", profileStatus: "inactive", employmentStatus: "inactive", endDate: "2027-01-03" })).available, false);
  assert.equal((await resolveCase({ id: "ended-employee", profileStatus: "active", employmentStatus: "active", endDate: "2027-01-03" })).available, false);
});
