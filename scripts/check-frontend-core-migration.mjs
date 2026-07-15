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
    required: [/getDataSourceFlags\(\)\.useCoreD1/, /CoreOfferService/],
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
  "Firebase Authentication and role/profile lookup remain temporary until the authentication migration phase.",
  "HR, payroll, attendance, leave, settings, uploads/storage and staff file workflows remain Phase 6 Firebase exceptions.",
  "Booking rescheduling that changes staff, date, time or duration is intentionally blocked in Core D1 mode until the dedicated reschedule endpoint is completed.",
  "The public booking UI still reads offers/settings/uploads through explicitly selected legacy adapters where Phase 5 has not cut them over.",
  "Legacy Firestore branches remain available only when VITE_USE_CORE_D1=false; D1 failures never trigger automatic Firestore fallback.",
];

if (failures.length) {
  console.error("frontend core migration guard failed");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("frontend core migration guard passed");
console.log("documented temporary exceptions:");
documentedExceptions.forEach((item) => console.log(`- ${item}`));
