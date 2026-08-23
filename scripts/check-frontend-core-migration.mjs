#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const forbiddenChecks = [
  {
    file: "src/pages/Booking.tsx",
    forbidden: [
      /from\s+["']\.\.\/services\/firestoreBookings["']/,
      /import\s+\*\s+as\s+firestoreBookings/,
      /firebase\/firestore/,
      /firebase\/storage/,
      /services\/firebase/,
      /firestorePackages/,
      /createOrLoadUserProfile/,
      /getDataSourceFlags/,
      /collection\([^\n]*["']booking_slots["']/,
      /doc\([^\n]*["']availability_days["']/,
    ],
  },
  {
    file: "src/features/internal-booking-v2/BookingInternalV2.tsx",
    forbidden: [
      /firebase\/firestore/,
      /firebase\/storage/,
      /services\/firebase/,
      /bookingDataSourceCompat/,
      /AppSettingsService/,
      /firestoreOffers/,
      /getDataSourceFlags/,
    ],
  },
  {
    file: "src/services/firestoreOffers.ts",
    forbidden: [/firebase\/firestore/, /getDataSourceFlags/],
  },  {
    file: "src/pages/Offers.tsx",
    forbidden: [
      /firebase\/firestore/,
      /services\/firebase/,
      /onSnapshot/,
      /service_packages/,
    ],
  },
  {
    file: "src/pages/DashboardOffers.tsx",
    forbidden: [
      /firebase\/firestore/,
      /services\/firebase/,
      /firestorePackages/,
      /getDataSourceFlags/,
    ],
  },
  {
    file: "src/pages/DashboardBookings.tsx",
    forbidden: [
      /firebase\/firestore/,
      /services\/firestoreIncome/,
      /getDataSourceFlags/,
      /watchAllBookings/,
      /collection\(db/,
      /getDocs\(/,
      /getDoc\(/,
    ],
  },
  {
    file: "src/pages/DashboardClients.tsx",
    forbidden: [
      /firebase\/firestore/,
      /services\/firebase/,
      /getDataSourceFlags/,
      /listAllBookings/,
      /CLIENTS_COLLECTION/,
    ],
  },
  {
    file: "src/pages/DashboardReports.tsx",
    forbidden: [
      /firebase\/firestore/,
      /services\/firebase/,
      /AppSettingsService/,
      /FirestoreReadStats/,
      /staff_public/,
      /normalizeCoreStaffPayrollRows/,
      /CoreSettingsService/,
      /helpers\/staffPayroll/,
      /collection\(db/,
      /getDocs\(/,
    ],
  },
  {
    file: "src/pages/AdminHrDashboard.tsx",
    forbidden: [
      /AdminPermissionRequestsPage/,
      /employeePermissionRequests/,
      /listEmployeePermissionRequests/,
      /\blistEmployeeFiles\b/,
    ],
  },
  {
    file: "src/pages/hr/AdminFilesV2.tsx",
    forbidden: [
      /createEmployeeFileRecord/,
      /createEmployeeNotification/,
      /\blistEmployeeFiles\b/,
      /uploadFileToR2/,
      /storageUrl/,
    ],
  },
  {
    file: "src/pages/hr/EmployeeFiles.tsx",
    forbidden: [
      /EmployeeFilesLegacy/,
      /services\/employeeHub["']/,
      /firebase\/firestore/,
      /storageUrl/,
    ],
  },
  {
    file: "src/services/employeeDirectory.ts",
    forbidden: [
      /firebase\/firestore/,
      /services\/firebase/,
      /fetchDirectoryFromFirestore/,
      /source:\s*["']firestore["']/,
    ],
  },
  {
    file: "src/pages/hr/AdminMessagesV2.tsx",
    forbidden: [/firebase\/firestore/, /employeeMessagesCol/, /getDocs\(/, /createEmployeeNotification/],
  },
  {
    file: "src/pages/hr/EmployeeMessagesLegacy.tsx",
    forbidden: [/firebase\/firestore/, /employeeMessagesCol/, /getDocs\(/, /createEmployeeNotification/],
  },
  {
    file: "src/pages/dashboardEmployees/EmployeeMessagesSection.tsx",
    forbidden: [/firebase\/firestore/, /employeeMessagesCol/, /getDocs\(/, /createEmployeeNotification/],
  },
  {
    file: "src/pages/dashboardEmployees/EmployeeFilesSection.tsx",
    forbidden: [
      /firebase\/firestore/,
      /services\/employeeHub/,
      /hrCollections/,
      /storageUrl/,
      /window\.open\(/,
    ],
  },
  {
    file: "src/pages/hr/CreateStaffAccount.tsx",
    forbidden: [/CreateStaffAccountLegacy/, /window\.location/, /isDashboardCreateStaffRoute/],
  },
  {
    file: "src/pages/hr/CreateStaffAccountV2.tsx",
    forbidden: [
      /syncEmployeeRecordFromUser/,
      /services\/employeeHub/,
      /firebase\/firestore/,
      /staff_public/,
    ],
  },
  {
    file: "src/pages/DashboardEmployees.tsx",
    forbidden: [
      /employee_leave_requests/,
      /\bcreateLeaveRequest\(/,
    ],
  },
  {
    file: "src/services/canonicalEmployeeLeaveRequests.ts",
    forbidden: [
      /firebase\/firestore/,
      /hrDoc\(/,
      /approveEmployeeLeaveRequest/,
      /reviewLeaveRequest/,
    ],
  },
  {
    file: "src/pages/hr/shared.ts",
    forbidden: [
      /firebase\/firestore/,
      /hrCollections/,
      /\bgetDoc\(/,
      /\bgetDocs\(/,
      /staff_public/,
    ],
  },
  {
    file: "src/pages/hr/EmployeeProfile.tsx",
    forbidden: [
      /syncEmployeeRecordFromUser/,
      /services\/employeeHub/,
      /firebase\/firestore/,
    ],
  },
  {
    file: "src/pages/EmployeePortal.tsx",
    forbidden: [
      /import\s+EmployeeLeavePage/,
      /import\s+EmployeePermissionRequestsPage/,
      /<EmployeeLeavePage/,
      /<EmployeePermissionRequestsPage/,
    ],
  },
];

const requiredChecks = [
  {
    file: "src/pages/Booking.tsx",
    required: [
      /CoreSettingsService/,
      /ClientPortalService\.snapshot/,
      /PackageService\.getActive/,
      /uploadFileToR2/,
      /listActiveSections\(SALON_ID, "core"\)/,
    ],
  },
  {
    file: "src/services/CoreIncomeService.ts",
    required: [/CoreFinanceService/, /CoreRefundService/, /listAllIncomeCore/, /upsertIncomeCore/, /removeIncomeCore/],
  },
  {
    file: "src/services/CoreExpenseService.ts",
    required: [/CoreFinanceService/, /listAllExpensesCore/, /upsertExpenseCore/, /removeExpenseCore/, /countMonthlyExpensesMissingNotesCore/],
  },
  {
    file: "src/services/firestoreOffers.ts",
    required: [/CoreOfferService/],
  },
  {
    file: "src/pages/DashboardOffers.tsx",
    required: [/PackageService/, /CoreCatalogService/],
  },
  {
    file: "src/pages/DashboardClients.tsx",
    required: [/listCoreBookings/, /CoreClientService/],
  },
  {
    file: "src/pages/DashboardReports.tsx",
    required: [
      /listCoreBookings\(\)/,
      /listAllIncomeCore\(\)/,
      /listAllExpensesCore\(\)/,
      /CoreHrService\.listPayrollEntries\(\)/,
      /generatePayrollEntriesForMonths/,
      /projectCorePayrollEntriesToFinancialRows/,
    ],
  },
  {
    file: "src/services/firestoreBookings.ts",
    required: [/getDataSourceFlags\(\)\.useCoreD1/, /CoreBookingService/, /CoreAuditService/],
  },
  {
    file: "src/services/logService.ts",
    required: [/getDataSourceFlags\(\)\.useCoreD1/, /CoreAuditService/],
  },
  {
    file: "src/pages/DashboardBookings.tsx",
    required: [
      /CoreBookingService\.list/,
      /coreD1BookingDataSource\.updateBooking/,
      /CoreClientService\.overview/,
      /CoreAuditService\.list/,
      /CoreRefundService/,
    ],
  },
  {
    file: "src/features/internal-booking-v2/BookingInternalV2.tsx",
    required: [
      /listCoreBookableStaffForDate/,
      /getCoreStaffBookableStartSlots/,
      /resolveCoreBookingDataSource\(\)\.getServiceSections\(\)/,
      /resolveCoreBookingDataSource\(\)\.createBookingGroup/,
      /CoreSettingsService\.get<InternalBookingAppSettings>\("app"\)/,
      /CoreOfferService\.list/,
      /firebase\/auth/,
    ],
  },
  {
    file: "src/services/CoreBookingService.ts",
    required: [/async\s+reschedule\s*\(/, /\/reschedule/],
  },
  {
    file: "src/services/bookingDataSources/coreD1BookingDataSource.ts",
    required: [/CoreBookingService\.(?:reschedule|patch)/, /CoreAvailabilityService\.invalidate/],
  },
  {
    file: "src/services/AppSettingsService.ts",
    required: [
      /function useCoreSettingsStore/,
      /flags\.useSettingsD1\s*\|\|\s*flags\.useCoreD1/,
      /CoreSettingsService/,
    ],
  },
  {
    file: "src/pages/AdminHrDashboard.tsx",
    required: [
      /listEmployeeRequests\(\{ type: "permission"/,
      /AdminEmployeeRequestsPage session=\{session\} initialType="permission"/,
    ],
  },
  {
    file: "src/services/CoreWorkforceService.ts",
    required: [
      /\/api\/core\/hr\/messages/,
      /\/api\/core\/hr\/notifications/,
      /\/api\/core\/hr\/recruitment/,
    ],
  },
  {
    file: "src/services/employeeHub.ts",
    required: [
      /CoreWorkforceService\.listMessages/,
      /CoreWorkforceService\.listNotifications/,
      /CoreWorkforceService\.listRecruitment/,
      /listCoreEmployeeDirectory\(\)/,
    ],
  },
  {
    file: "src/pages/hr/AdminMessagesV2.tsx",
    required: [/listEmployeeMessages\(500\)/, /markEmployeeThreadRead/],
  },
  {
    file: "src/pages/hr/EmployeeMessagesLegacy.tsx",
    required: [/listEmployeeMessages\(500\)/, /markEmployeeThreadRead/],
  },
  {
    file: "src/pages/dashboardEmployees/EmployeeMessagesSection.tsx",
    required: [/listEmployeeMessages\(500\)/, /markEmployeeThreadRead/],
  },
  {
    file: "workers/core/index.js",
    required: [
      /\/api\/core\/hr\/messages/,
      /\/api\/core\/hr\/notifications/,
      /\/api\/core\/hr\/recruitment/,
      /case "employee-messages"/,
      /case "employee-notifications"/,
      /case "recruitment"/,
    ],
  },
  {
    file: "src/pages/dashboardEmployees/EmployeeFilesSection.tsx",
    required: [
      /listCoreEmployeeFiles/,
      /createCoreEmployeeFile/,
      /openCoreEmployeeFile/,
      /downloadCoreEmployeeFile/,
      /updateCoreEmployeeFileStatus/,
    ],
  },
  {
    file: "src/pages/hr/CreateStaffAccount.tsx",
    required: [/CreateStaffAccountV2/, /return <CreateStaffAccountV2/],
  },
  {
    file: "src/pages/hr/CreateStaffAccountV2.tsx",
    required: [
      /createUserWithEmailAndPassword/,
      /deleteUser/,
      /CoreAccountService\.(?:create|update)/,
      /CoreAccountService\.linkEmployee/,
      /CoreHrService\.saveEmployee/,
      /CoreWorkforceService\.createNotification/,
    ],
  },
  {
    file: "src/pages/DashboardEmployees.tsx",
    required: [/createManagedLeaveRequest/, /decideCanonicalEmployeeLeaveRequest/],
  },
  {
    file: "src/services/employeeHub.ts",
    required: [
      /listCoreEmployeeRequests\(\{ type: "leave"/,
      /listMyEmployeeRequests\(\{ type: "leave"/,
      /createManagedEmployeeRequest/,
    ],
  },
  {
    file: "src/services/canonicalEmployeeLeaveRequests.ts",
    required: [/employeeRequestAction/, /employee_leave_core_cancellation_missing/],
  },
  {
    file: "workers/core/repositories/employee-requests.js",
    required: [/cancelExecutedLeaveRequest/, /execution_reversed/, /decideLeave\(/],
  },
  {
    file: "src/pages/hr/shared.ts",
    required: [/CoreAccountService\.me\(\)/, /CoreHrService\.getMyEmployeeProfile\(\)/],
  },
  {
    file: "src/pages/hr/EmployeeProfile.tsx",
    required: [/CoreHrService\.saveMyEmployeeProfile\(/],
  },
  {
    file: "src/pages/EmployeePortal.tsx",
    required: [
      /path="leave"[\s\S]{0,180}\/employee\/requests\?new=leave/,
      /path="permission"[\s\S]{0,180}\/employee\/requests\?new=permission/,
    ],
  },
  {
    file: "workers/core/index.js",
    required: [
      /\/api\/core\/hr\/employee-profile\/mine/,
      /case "employee-profile:mine"/,
      /id: ctx\.employeeId/,
    ],
  },
  {
    file: "src/services/CoreHrService.ts",
    required: [/\/api\/core\/hr\/employees/, /\/api\/core\/hr\/attendance/],
  },
  {
    file: "src/services/CoreFilesService.ts",
    required: [
      /getDataSourceFlags\(\)\.useR2Files/,
      /\/api\/core\/files/,
      /async updateMetadata\(/,
      /method: "PATCH"/,
    ],
  },
  {
    file: "src/services/employeeDirectory.ts",
    required: [
      /CoreHrService\.listEmployees\(\)/,
      /CoreStaffService\.list/,
      /CoreAccountService\.list/,
      /source:\s*"api"/,
    ],
  },
  {
    file: "src/services/employeeFilesCore.ts",
    required: [
      /CoreFilesService\.list\(\)/,
      /CoreFilesService\.createMetadata/,
      /CoreFilesService\.upload/,
      /CoreFilesService\.download/,
      /CoreFilesService\.updateMetadata/,
    ],
  },
  {
    file: "src/pages/hr/AdminFilesV2.tsx",
    required: [
      /listCoreEmployeeFiles/,
      /createCoreEmployeeFile/,
      /openCoreEmployeeFile/,
      /downloadCoreEmployeeFile/,
    ],
  },
  {
    file: "src/pages/hr/EmployeeFiles.tsx",
    required: [
      /listMyCoreEmployeeFiles/,
      /markCoreEmployeeFileRead/,
      /openCoreEmployeeFile/,
      /downloadCoreEmployeeFile/,
    ],
  },
  {
    file: "workers/core/index.js",
    required: [
      /files_r2:self_update_read_only/,
      /patchFileMetadata/,
    ],
  },
];

const failures = [];
if (existsSync("src/pages/BookingInternal.tsx")) {
  failures.push("src/pages/BookingInternal.tsx: historical BookingInternal wrapper must remain deleted");
}
for (const check of forbiddenChecks) {
  const source = readFileSync(check.file, "utf8");
  for (const pattern of check.forbidden) {
    if (pattern.test(source)) failures.push(`${check.file}: forbidden ${pattern}`);
  }
}
for (const check of requiredChecks) {
  const source = readFileSync(check.file, "utf8");
  for (const pattern of check.required) {
    if (!pattern.test(source)) failures.push(`${check.file}: missing ${pattern}`);
  }
}

const documentedExceptions = [
  "Firebase Authentication remains for sign-in, ID-token verification and password reset delivery only; operational account status, roles, permissions and employee links are D1-owned.",
  "Employee portal identity, account role, employee linkage, self profile, leave and permission request entry points are Core D1-owned; Firebase is authentication-only for those flows.",
  "Employee leave request listing, manager-direct creation, approval/execution and post-execution cancellation are Core D1-owned; cancelling an executed leave reverses the canonical leave ledger exactly once.",
  "Employee portal, admin and embedded DashboardEmployees file flows are Core D1/R2-owned; authenticated file content never opens a legacy storageUrl directly.",
  "Booking scheduling updates use Core D1 and replace slot locks atomically.",
  "Internal messages, employee notifications and recruitment are Core D1-owned; message notifications are created atomically with the Core message write. Legacy Firestore helpers remain historical-only.",
  "Employee account provisioning uses Firebase only to create/authenticate the identity; account status, role, employee profile and employee linkage are Core D1-owned.",
  "Weekly-report Firestore helpers currently have no active portal/dashboard consumer and remain historical-only pending any future weekly-report product workflow.",
  "D1/R2 failures never trigger an automatic Firestore or Firebase Storage fallback.",
];

if (failures.length) {
  console.error("frontend core migration guard failed");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("frontend core migration guard passed");
console.log("documented temporary exceptions:");
documentedExceptions.forEach((item) => console.log(`- ${item}`));
