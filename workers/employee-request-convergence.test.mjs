import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read=(p)=>readFileSync(p,"utf8");

test("employee requests use one canonical master reference and salary advance naming",()=>{
 const service=read("src/services/employeeRequests.ts");
 const worker=read("workers/core/repositories/employee-requests.js");
 const migration=read("migrations/core/0025_employee_request_reference_integrity.sql");
 assert.match(service,/salary_advance:\s*"طلب سلفة"/);
 assert.match(worker,/salary_advance:\s*'طلب سلفة'/);
 assert.doesNotMatch(service,/صرف معجل للراتب/);
 assert.doesNotMatch(worker,/صرف معجل للراتب/);
 assert.match(worker,/core_employee_request:execution_reference_missing/);
 assert.match(worker,/source_reference_type = \?, source_reference_id = \?/);
 for(const token of ["employee_permission_request","employee_leave","overtime","salary_advance","employee_financial_payment","attendance_record","exit_return","resignation"]) assert.match(migration,new RegExp(token));
});

test("needs-info can resume review and request actions are version-idempotent",()=>{
 const admin=read("src/pages/hr/AdminEmployeeRequests.tsx");
 const service=read("src/services/employeeRequests.ts");
 const worker=read("workers/core/repositories/employee-requests.js");
 assert.match(admin,/selected\.status === "needs_info"/);
 assert.match(admin,/runAction\("start-review"\)/);
 assert.match(admin,/استئناف المراجعة/);
 assert.match(worker,/needs_info:\s*new Set\(\['under_review'/);
 assert.match(worker,/answer_info:\s*'under_review'/);
 assert.match(service,/makeRequestActionIdempotencyKey/);
 assert.match(service,/employee-request-action:\$\{id\}:\$\{action\}:\$\{versionToken\}/);
});

test("canonical execution tables keep request-level uniqueness",()=>{
 const m20=read("migrations/core/0020_employee_requests.sql");
 const m23=read("migrations/core/0023_exceptional_financial_payment_requests.sql");
 assert.match(m20,/idx_employee_permission_request_source/);
 assert.match(m20,/idx_employee_leaves_request/);
 assert.match(m20,/UNIQUE \(salon_id, request_id\)/);
 assert.match(m23,/employee_financial_payments/);
 assert.match(m23,/UNIQUE \(salon_id, request_id\)/);
});

test("active UI uses salary-advance terminology and legacy reference gaps remain auditable",()=>{
 const portal=read("src/pages/EmployeePortal.tsx");
 const permissions=read("src/helpers/permissions.ts");
 const migration=read("migrations/core/0025_employee_request_reference_integrity.sql");
 assert.match(portal,/label:\s*"طلب سلفة"/);
 assert.doesNotMatch(portal,/صرف معجل للراتب/);
 assert.match(permissions,/label:\s*"اعتماد السلفة"/);
 assert.doesNotMatch(permissions,/اعتماد الصرف المعجل/);
 assert.match(migration,/CREATE VIEW IF NOT EXISTS employee_request_reference_gaps/);
 assert.match(migration,/missing_reference/);
 assert.match(migration,/broken_reference/);
});
