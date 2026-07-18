#!/usr/bin/env node
import { readFileSync } from "node:fs";

const forbiddenChecks = [
  {
    file: "src/pages/Booking.tsx",
    forbidden: [
      /from\s+["']\.\.\/services\/firestoreBookings["']/,
      /import\s+\*\s+as\s+firestoreBookings/,
      /collection\([^\n]*["']booking_slots["']/,
      /doc\([^\n]*["']availability_days["']/,
    ],
  },
  {
    file: "src/pages/BookingInternal.tsx",
    forbidden: [
      /from\s+["']\.\.\/services\/firestoreBookings["']/,
      /import\s+\*\s+as\s+firestoreBookings/,
      /collection\([^\n]*["']booking_slots["']/,
      /doc\([^\n]*["']availability_days["']/,
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
];

const requiredChecks = [
  {
    file: "src/services/firestoreIncome.ts",
    required: [/getDataSourceFlags\(\)\.useCoreD1/, /CoreFinanceService/],
  },
  {
    file: "src/services/firestoreExpenses.ts",
    required: [/getDataSourceFlags\(\)\.useCoreD1/, /CoreFinanceService/],
  },
  {
    file: "src/services/firestoreOffers.ts",
    required: [/CoreOfferService/],
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
    required: [/CoreRefundService/, /getDataSourceFlags\(\)\.useCoreD1/],
  },
  {
    file: "src/pages/BookingInternal.tsx",
    required: [/CoreRefundService/, /CoreAuditService/],
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
    file: "src/services/CoreHrService.ts",
    required: [/\/api\/core\/hr\/employees/, /\/api\/core\/hr\/attendance/],
  },
  {
    file: "src/services/CoreFilesService.ts",
    required: [/getDataSourceFlags\(\)\.useR2Files/, /\/api\/core\/files/],
  },
];

const failures = [];
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
  "Firebase Authentication remains temporary; Core verifies the Firebase ID token, and Packages may additionally read the signed-in user's own role profile for authorization when the token claim is missing or stale.",
  "Phase 6 adds Core D1 HR, attendance, leave, absence, payroll and schedule APIs, while legacy HR UI branches remain explicitly selected when VITE_USE_HR_D1=false.",
  "Salon settings have an explicit D1 adapter and files have an explicit R2 adapter; their Firebase branches remain available only while the corresponding flags are false.",
  "Booking scheduling updates use Core D1 and replace slot locks atomically.",
  "Messages, recruitment, weekly-report and notification UI workflows still require a later explicit cutover where they currently use legacy Firebase services.",
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
