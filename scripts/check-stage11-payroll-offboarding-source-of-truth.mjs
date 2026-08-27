import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const fail = (message) => { throw new Error(`STAGE11_V4_SOURCE_GUARD: ${message}`); };

const [
  offboarding,
  payroll,
  attendance,
  shifts,
  lifecycle,
  hrService,
  dashboard,
  index,
  readiness,
  accounts,
  errors,
  coreApiClient,
  migration,
] = await Promise.all([
  read('workers/core/repositories/employee-offboarding.js'),
  read('workers/core/repositories/payroll.js'),
  read('workers/core/repositories/attendance.js'),
  read('workers/core/repositories/shift-control.js'),
  read('src/services/employeeLifecycleService.ts'),
  read('src/services/CoreHrService.ts'),
  read('src/pages/DashboardEmployees.tsx'),
  read('workers/core/index.js'),
  read('src/helpers/hr/payrollReadiness.js'),
  read('workers/core/repositories/accounts.js'),
  read('workers/core/errors.js'),
  read('src/services/coreApiClient.ts'),
  read('migrations/core/0034_employee_offboarding_invariants.sql'),
]);

if (/from ['"][^'"]*(firebase|firestore)|\b(getFirestore|collection|setDoc|updateDoc|deleteDoc)\b/i.test(offboarding)) {
  fail('offboarding repository must not depend on Firebase/Firestore business data');
}
if (!offboarding.includes('dbBatch(db, statements)')) fail('offboarding must use one Core D1 batch');
if (!offboarding.includes('employee_offboarding_fences')) fail('offboarding fence write missing');
if (!offboarding.includes('offboarding_future_end_date_not_supported')) fail('future endDate backend guard missing');
if (!offboarding.includes('offboarding_future_bookings_require_reassignment')) fail('upcoming booking blocker missing');
if (!offboarding.includes('offboarding_post_end_date_activity_conflict')) fail('post-end historical activity blocker missing');
if (!offboarding.includes("link_status IN ('active','pending')")) fail('active/pending employee-link convergence missing');
if (!offboarding.includes('offboarding_privileged_account_requires_manual_review')) fail('privileged account manual review guard missing');
if (!offboarding.includes('offboarding_account_identity_conflict')) fail('repurposed account identity guard missing');
if (!offboarding.includes('planEmployeeOffboardingAccountAccess')) fail('canonical accounts lifecycle planner not used');
if (/UPDATE\s+app_users/i.test(offboarding)) fail('offboarding repository must not own a second direct app_users update policy');
if (!offboarding.includes("action: 'employee_offboarded'")) fail('employee offboarding audit missing');
if (!offboarding.includes("action: 'account_disabled_by_employee_offboarding'")) fail('account side-effect audit missing');

if (!accounts.includes('planEmployeeOffboardingAccountAccess')) fail('accounts repository offboarding policy helper missing');
if (!accounts.includes('employeeOffboardingAccountDisableStatement')) fail('accounts repository lifecycle disable statement missing');
if (!accounts.includes("'owner'" ) || !accounts.includes("'admin'") || !accounts.includes("'hr'") || !accounts.includes("'accountant'") || !accounts.includes("'reception'")) {
  fail('privileged account role policy incomplete');
}

if (!migration.includes('CREATE TABLE IF NOT EXISTS employee_offboarding_fences')) fail('offboarding fence migration missing');
for (const triggerName of [
  'trg_employee_offboarding_fence_insert_booking_guard',
  'trg_employee_offboarding_fence_update_booking_guard',
  'trg_employee_profiles_block_fenced_active_insert',
  'trg_employee_profiles_block_fenced_active_update',
  'trg_employee_employment_block_fenced_rehire_insert',
  'trg_employee_employment_block_fenced_rehire_update',
  'trg_staff_block_fenced_operational_insert',
  'trg_staff_block_fenced_operational_update',
  'trg_bookings_block_offboarded_staff_insert',
  'trg_bookings_block_offboarded_staff_update',
  'trg_booking_items_block_offboarded_staff_insert',
  'trg_booking_items_block_offboarded_staff_update',
]) {
  if (!migration.includes(triggerName)) fail(`missing SQLite invariant trigger: ${triggerName}`);
}
if (!migration.includes("RAISE(ABORT, 'core_booking:employee_not_active')")) fail('booking-side fence abort missing');
if (!migration.includes("RAISE(ABORT, 'core_hr:offboarding_future_bookings_require_reassignment')")) fail('offboarding-side future booking fence abort missing');
if (!migration.includes("RAISE(ABORT, 'core_hr:offboarding_post_end_date_activity_conflict')")) fail('offboarding-side post-end activity fence abort missing');
if (!migration.includes("RAISE(ABORT, 'core_hr:employee_rehire_requires_lifecycle_operation')")) fail('HR projection rehire fence abort missing');
if (/wrangler\s+d1|--remote|migrations\s+apply/i.test(migration)) fail('migration file must be source-only and contain no apply command');

const routeStart = index.indexOf('    case "hr-employee:offboard":');
const routeEnd = index.indexOf('    case "hr-employees":', routeStart + 1);
if (routeStart < 0 || routeEnd <= routeStart) fail('Core offboarding route missing');
const offboardRoute = index.slice(routeStart, routeEnd);
if (!/requirePermission\(ctx,\s*["']employees\.delete["']\)/.test(offboardRoute)) fail('offboarding endpoint must require employees.delete');
if (/employees\.manage|accounts\.disable/.test(offboardRoute)) fail('offboarding route authorization is wider than employees.delete');
if (!index.includes('normalized.details !== undefined')) fail('structured AppError details are not serialized by Core API');

if (!errors.includes('core_booking:employee_not_active')) fail('SQLite booking fence error normalization missing');
if (!errors.includes('core_hr:employee_rehire_requires_lifecycle_operation')) fail('SQLite HR projection fence error normalization missing');
if (!coreApiClient.includes('details?: unknown')) fail('CoreApiError details field missing');
if (!coreApiClient.includes('payload.details')) fail('frontend Core client does not preserve structured details');

if (!migration.includes("BEFORE UPDATE OF staff_id, booking_date, status, completed_at, deleted_at ON bookings")) {
  fail('parent booking invariant must cover staff/date/status/completed/deleted transitions');
}
if (!/trg_bookings_block_offboarded_staff_update[\s\S]*FROM booking_items bi[\s\S]*bi\.booking_id = NEW\.id/.test(migration)) {
  fail('parent booking transition guard must inspect booking_items assignments');
}
if (!migration.includes("OLD.deleted_at IS NOT NULL") ||
    !migration.includes("OLD.completed_at IS NOT NULL") ||
    !migration.includes("LOWER(COALESCE(OLD.status, '')) IN ('completed', 'cancelled', 'canceled', 'rejected')")) {
  fail('booking status/finalization reactivation transition guard missing');
}
if (!/trg_booking_items_block_offboarded_staff_(insert|update)[\s\S]*JOIN bookings b/.test(migration)) {
  fail('booking_items guards must validate parent booking operational state');
}
if (!migration.includes("LOWER(COALESCE(b.status, '')) NOT IN ('completed', 'cancelled', 'canceled', 'rejected')")) {
  fail('canonical non-finalized booking vocabulary missing from DB invariant');
}
if (!migration.includes('BEFORE UPDATE OF booking_id, salon_id, staff_id, booking_date ON booking_items')) {
  fail('booking_items reparent/re-salon transition is not fenced');
}
if (!migration.includes("COALESCE(OLD.booking_id, '') <> COALESCE(NEW.booking_id, '')")) {
  fail('booking_items parent-reassignment transition check missing');
}
if (!migration.includes('trg_bookings_block_fenced_item_identity_detach')) {
  fail('parent booking identity-detach guard missing');
}
if (!migration.includes('trg_employee_offboarding_fence_delete_immutable') ||
    !migration.includes('trg_employee_offboarding_fence_identity_immutable') ||
    !migration.includes('core_hr:offboarding_fence_history_immutable')) {
  fail('durable offboarding fence immutability guards missing');
}
const hrEmployeesSource = await read('workers/core/repositories/hr-employees.js');
if (!hrEmployeesSource.includes('employee_offboarding_fences')) {
  fail('generic HR save is not fence-aware');
}
if (!hrEmployeesSource.includes('core_hr:employee_rehire_requires_lifecycle_operation')) {
  fail('generic HR save rehire fail-closed error missing');
}
if (!hrEmployeesSource.includes('staff.show_on_booking') || !hrEmployeesSource.includes('staff.employment_status')) {
  fail('generic HR save must evaluate final staff operational projection against offboarding fence');
}
if (!hrEmployeesSource.includes('core_hr:offboarding_lifecycle_fields_locked')) {
  fail('generic HR save must lock offboarded employment lifecycle dates');
}

if (!payroll.includes('core_payroll:gosi_effective_date_required')) fail('GOSI effective date fail-closed guard missing');
if (!attendance.includes('core_attendance:employee_not_active')) fail('attendance employment guard missing');
if (!shifts.includes("blocked_reason: 'employee_not_active'")) fail('schedule inactive guard missing');
if (!shifts.includes('has_profile') || !shifts.includes('has_employment')) fail('schedule guard must distinguish absent HR projection from partial HR projection');
if (/CoreStaffService/.test(lifecycle)) fail('frontend lifecycle still owns staff mutation');
if (!/offboardEmployee\(/.test(hrService)) fail('CoreHrService offboarding intent missing');
if (/confirm\(`هل تريد أرشفة الموظفة/.test(dashboard)) fail('legacy window.confirm archive flow remains');
if (!dashboard.includes('max={todayIso()}')) fail('offboarding date input should constrain future dates for UX');
if (!dashboard.includes('offboarding_post_end_date_activity_conflict')) fail('post-end activity blocker UX missing');
if (!dashboard.includes('offboarding_privileged_account_requires_manual_review')) fail('privileged account blocker UX missing');
if (!readiness.includes('classifyStage11PayrollReadiness')) fail('Stage 11 readiness classifier missing');
if (/calculateGosi/.test(await read('src/services/CorePayrollService.ts'))) fail('browser payroll service must not calculate GOSI');

console.log('STAGE 11 v5 payroll/offboarding source-of-truth guard: PASS');

const bookingUpdateTrigger = migration.match(
  /CREATE TRIGGER IF NOT EXISTS trg_bookings_block_offboarded_staff_update[\s\S]*?\nEND;/
)?.[0] || '';
if (!bookingUpdateTrigger) fail('operational parent booking update trigger missing');
if (/NEW\.completed_at\s+IS\s+NULL/i.test(bookingUpdateTrigger)) {
  fail('canonical booking status must not be masked by NEW.completed_at in operational update guard');
}
if (!/LOWER\(COALESCE\(NEW\.status,\s*''\)\)\s+NOT IN \('completed', 'cancelled', 'canceled', 'rejected'\)/.test(bookingUpdateTrigger)) {
  fail('operational parent booking update guard must be status-driven');
}

for (const triggerName of [
  'trg_bookings_block_offboarded_staff_insert',
  'trg_booking_items_block_offboarded_staff_insert',
  'trg_booking_items_block_offboarded_staff_update',
]) {
  const trigger = migration.match(
    new RegExp(`CREATE TRIGGER IF NOT EXISTS ${triggerName}[\\s\\S]*?\\nEND;`)
  )?.[0] || '';
  if (!trigger) fail(`${triggerName} missing`);
  if (/completed_at\s+IS\s+NULL/i.test(trigger)) {
    fail(`${triggerName} must not use completed_at to mask canonical operational status`);
  }
}
