import fs from 'node:fs';
import path from 'node:path';

const filePath = path.join(process.cwd(), 'src/pages/Booking.tsx');
const raw = fs.readFileSync(filePath, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const before = 'x.slotCards.filter((slot: TimeSlot) => slot.state === "available")';
const after = 'x.slotCards.filter((slot) => slot.state === "available")';
const matches = text.split(before).length - 1;

if (matches === 0) {
  if (text.includes(after)) {
    console.log('[slotcard-type-fix] Booking.tsx already fixed.');
    process.exit(0);
  }
  throw new Error('[slotcard-type-fix] expected slotCards filter not found');
}

text = text.split(before).join(after);

if (text.includes('x.slotCards.filter((slot: TimeSlot) =>')) {
  throw new Error('[slotcard-type-fix] stale TimeSlot annotation remains on slotCards');
}

const next = eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
fs.writeFileSync(filePath, next, 'utf8');
console.log(`[slotcard-type-fix] fixed ${matches} slotCards filter annotation(s).`);
