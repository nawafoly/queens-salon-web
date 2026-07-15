#!/usr/bin/env node
import { readFileSync } from "node:fs";

const checks = [
  {
    file: "src/pages/Booking.tsx",
    forbidden: [
      /from\s+["']\.\.\/services\/firestoreBookings["']/,
      /import\s+\*\s+as\s+firestoreBookings/,
    ],
  },
  {
    file: "src/pages/BookingInternal.tsx",
    forbidden: [
      /from\s+["']\.\.\/services\/firestoreBookings["']/,
      /import\s+\*\s+as\s+firestoreBookings/,
    ],
  },
];

const failures = [];
for (const check of checks) {
  const source = readFileSync(check.file, "utf8");
  for (const pattern of check.forbidden) {
    if (pattern.test(source)) {
      failures.push(`${check.file}: ${pattern}`);
    }
  }
}

const documentedExceptions = [
  "Booking.tsx: Firestore remains temporarily for slot availability, offers, settings, uploads and the legacy source selected when VITE_USE_CORE_D1=false.",
  "BookingInternal.tsx: Firestore remains temporarily for availability metadata, refunds, audit/income compatibility, offers, settings and legacy reads outside the migrated operations.",
];

if (failures.length) {
  console.error("frontend core migration guard failed");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("frontend core migration guard passed");
console.log("documented temporary exceptions:");
documentedExceptions.forEach((item) => console.log(`- ${item}`));
