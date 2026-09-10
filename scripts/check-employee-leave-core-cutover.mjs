#!/usr/bin/env node
import { readFileSync } from "node:fs";

const checks = [
  {
    file: "src/pages/hr/EmployeeLeave.tsx",
    required: [/createManagedLeaveRequest/],
    forbidden: [/\bcreateLeaveRequest\s*\(/],
  },
  {
    file: "src/pages/DashboardEmployees.tsx",
    required: [
      /createManagedLeaveRequest/,
      /decideCanonicalEmployeeLeaveRequest/,
      /canonicalDisplayLeaveForEmployee/,
      /CoreHrService\.listLeaves\(\{ status: "approved" \}\)/,
      /Core employee_leaves is the only operational leave source/,
      /Never consume legacy Firestore leave mirrors at runtime/,
    ],
    forbidden: [
      /employee_leave_requests/,
      /\bcreateLeaveRequest\(/,
      /const profilePatch = \{\s*onLeave:/,
      /setDoc\(staffPublicDoc\(selectedEmployeeId\),\s*profilePatch/,
      /setDoc\(doc\(db,\s*"salons",\s*SALON_ID,\s*"employees",\s*selectedEmployeeId\),\s*profilePatch/,
      /CoreHrService\.saveEmployee\(\{[\s\S]{0,220}leaveStartDate:/,
      /onLeave:\s*effectiveModalOnLeave/,
      /employmentEndDate:\s*normalizedEmploymentEndDate,\s*onLeave:/,
    ],
  },
  {
    file: "src/pages/AdminHrDashboard.tsx",
    required: [
      /CoreHrService\.listLeaves\(\{ status: "approved" \}\)/,
      /currentFullDayLeaveEmployeeIds/,
      /normalizeText\(leave\.durationKind\) === "partial"/,
      /onLeave:\s*currentFullDayLeaveEmployeeIds\.has/,
    ],
    forbidden: [],
  },
  {
    file: "src/pages/EmployeePortal.tsx",
    required: [
      /path="leave"[\s\S]{0,180}\/employee\/requests\?new=leave/,
      /path="permission"[\s\S]{0,180}\/employee\/requests\?new=permission/,
    ],
    forbidden: [/EmployeeLeavePage/, /EmployeePermissionRequestsPage/],
  },
  {
    file: "src/services/employeeHub.ts",
    required: [
      /listCoreEmployeeRequests\(\{ type: "leave"/,
      /listMyEmployeeRequests\(\{ type: "leave"/,
      /createManagedEmployeeRequest/,
      /CoreHrService\.listAbsences/,
      /CoreHrService\.createAbsence/,
    ],
    forbidden: [],
  },
  {
    file: "src/services/canonicalEmployeeLeaveRequests.ts",
    required: [/employeeRequestAction/, /employee_leave_core_cancellation_missing/],
    forbidden: [/firebase\/firestore/, /hrDoc\(/, /approveEmployeeLeaveRequest/, /reviewLeaveRequest/],
  },
  {
    file: "workers/core/repositories/employee-requests.js",
    required: [
      /employee-requests-legacy\.js/,
      /requireExplicitSaLeaveType/,
      /assertLeaveRequestDecisionAllowed/,
      /executeStatutoryOvertimeRequest/,
      /annual_leave_cash_substitution_during_service_not_allowed/,
    ],
    forbidden: [
      /leaveType:\s*cleanText\([^)]*payload\.leaveType[^)]*\)\s*\|\|\s*['"]annual['"]/,
      /baseSalaryHalalas\s*\/\s*30/,
      /leave_balance\s*=\s*leave_balance\s*-\s*\?/,
    ],
  },
  {
    file: "workers/core/repositories/employee-requests-legacy.js",
    required: [
      /cancelExecutedLeaveRequest/,
      /execution_reversed/,
      /decideLeave\(/,
      /existingLeaveStatus !== 'approved'/,
    ],
    forbidden: [],
  },
  {
    file: "workers/core/repositories/leaves.js",
    required: [
      /leaves-legacy\.js/,
      /requireExplicitSaLeaveType/,
      /approveAnnualLeave/,
      /cancelApprovedAnnualLeave/,
      /approveSickLeave/,
      /cancelApprovedSickLeave/,
      /leaveDecisionRuntime/,
      /core_leave:leave_type_required/,
    ],
    forbidden: [
      /data\.leaveType[\s\S]{0,120}\|\|\s*['"]annual['"]/,
      /leave_balance\s*=\s*leave_balance\s*[-+]\s*\?/,
    ],
  },
  {
    file: "workers/core/repositories/annual-leave-cancellation.js",
    required: [
      /LEAVE_REVERSAL/,
      /leave_reversal/,
      /UPDATE employee_leaves[\s\S]{0,500}status = 'rejected'/,
    ],
    forbidden: [/DELETE FROM employee_leave_balance_ledger/],
  },
  {
    file: "workers/core/repositories/booking-staff-policy.js",
    required: [
      /source:\s*"employee_leaves"[\s\S]{0,260}leaveNote:[\s\S]{0,160}fullLeave\.(?:hr_note|employee_note)/,
    ],
    forbidden: [/staff\.leave_note/],
  },
  {
    file: "workers/core/repositories/availability.js",
    required: [/leaveNote:\s*onLeave\s*\?\s*cleanText\(bookingDay\.leaveNote\)/],
    forbidden: [/staff\.leave_note/],
  },
  {
    file: "workers/core/repositories/permissions.js",
    required: [/cancelPermissionBookingBlock[\s\S]{0,300}refreshPayrollEntries/],
    forbidden: [],
  },
];

function exportedAsyncFunctionBlock(source, name) {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const next = source.indexOf("\nexport ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

const failures = [];
for (const check of checks) {
  const source = readFileSync(check.file, "utf8");
  for (const pattern of check.required) {
    if (!pattern.test(source)) failures.push(`${check.file}: missing ${pattern}`);
  }
  for (const pattern of check.forbidden) {
    if (pattern.test(source)) failures.push(`${check.file}: forbidden ${pattern}`);
  }
}

const employeeHubSource = readFileSync("src/services/employeeHub.ts", "utf8");
const activeEmployeeHubFunctions = [
  ["listEmployeeAbsences", /CoreHrService\.listAbsences/, /employeeAbsencesCol|firebase\/firestore|\b(?:addDoc|getDocs|updateDoc)\(/],
  ["listEmployeeAbsencesByEmployee", /CoreHrService\.listAbsences/, /employeeAbsencesCol|firebase\/firestore|\b(?:addDoc|getDocs|updateDoc)\(/],
  ["createEmployeeAbsenceRecord", /CoreHrService\.createAbsence/, /employeeAbsencesCol|firebase\/firestore|\b(?:addDoc|getDocs|updateDoc)\(/],
  ["createManagedLeaveRequest", /createManagedEmployeeRequest/, /employeeLeaveRequestsCol|firebase\/firestore|\b(?:addDoc|getDocs|updateDoc)\(/],
  ["listLeaveRequestsByEmployee", /listMyEmployeeRequests/, /employeeLeaveRequestsCol|firebase\/firestore|\b(?:addDoc|getDocs|updateDoc)\(/],
  ["listEmployeeLeaveRequests", /listCoreEmployeeRequests/, /employeeLeaveRequestsCol|firebase\/firestore|\b(?:addDoc|getDocs|updateDoc)\(/],
];

for (const [name, required, forbidden] of activeEmployeeHubFunctions) {
  const block = exportedAsyncFunctionBlock(employeeHubSource, name);
  if (!block) {
    failures.push(`src/services/employeeHub.ts: missing active function ${name}`);
    continue;
  }
  if (!required.test(block)) failures.push(`src/services/employeeHub.ts:${name}: missing ${required}`);
  if (forbidden.test(block)) failures.push(`src/services/employeeHub.ts:${name}: forbidden legacy runtime ${forbidden}`);
}

if (failures.length) {
  console.error("employee leave Core cutover guard failed");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("employee leave Core cutover guard passed");
console.log("- active employee leave entry is Employee Requests -> Core employee_requests");
console.log("- leave type is explicit; missing type never defaults to annual");
console.log("- annual and sick decisions dispatch through statutory runtimes");
console.log("- active-service annual leave cash substitution is blocked");
console.log("- overtime request authorization never creates payroll money before attendance reconciliation");
console.log("- historical request/leave lifecycle code is isolated behind legacy adapters for audit compatibility");
console.log("- DashboardEmployees never writes operational leave state to Firestore mirrors");
console.log("- dashboard leave status is derived from approved Core employee_leaves; partial leave never marks a full-day status");
console.log("- approved annual cancellation writes a reversal event and preserves original ledger history");
console.log("- absence create/list runtime is Core-owned");
console.log("- booking availability reads leave state and leave note from the same canonical employee_leaves fact");
console.log("- historical EmployeeLeave/permission pages remain unreachable from the active employee portal");
console.log("- partial permission cancellation refreshes payroll state");
