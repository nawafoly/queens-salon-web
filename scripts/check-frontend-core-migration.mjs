#!/usr/bin/env node
import { readFileSync } from "node:fs";

const checks = [
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

const failures = [];
for (const check of checks) {
  const source = readFileSync(check.file, "utf8");
  for (const pattern of check.forbidden) {
    if (pattern.test(source)) failures.push(`${check.file}: ${pattern}`);
  }
}

const documentedExceptions = [
  "Booking.tsx: offers, settings, uploads and the explicitly selected legacy adapter still use Firebase during cutover.",
  "BookingInternal.tsx: refunds, audit/income compatibility, offers, settings, uploads and the manual legacy backfill remain temporary Firebase exceptions.",
  "Slot availability and booked-slot metadata are now selected through bookingDataSource; D1 mode performs no automatic Firebase fallback.",
];

if (failures.length) {
  console.error("frontend core migration guard failed");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("frontend core migration guard passed");
console.log("documented temporary exceptions:");
documentedExceptions.forEach((item) => console.log(`- ${item}`));
