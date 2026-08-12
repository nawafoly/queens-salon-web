import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';

const source = fs.readFileSync('src/helpers/timeSlots.ts', 'utf8');
const compiled = await transform(source, {
  loader: 'ts',
  format: 'esm',
  target: 'es2022',
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
const { generateSalonTimeSlots, filterSlotsByServiceEnd } = mod;

function lastStart({ durationMin, bufferMin = 10, stepMin }) {
  const timeline = generateSalonTimeSlots('15:00', '23:00', stepMin);
  const starts = filterSlotsByServiceEnd(
    timeline,
    '23:00',
    durationMin,
    bufferMin,
    0
  );
  return starts.at(-1)?.value24 || '';
}

// 5-minute grid: exact latest starts for a 23:00 employee shift.
assert.equal(lastStart({ durationMin: 15, stepMin: 5 }), '22:35');
assert.equal(lastStart({ durationMin: 30, stepMin: 5 }), '22:20');
assert.equal(lastStart({ durationMin: 60, stepMin: 5 }), '21:50');

// 10-minute grid: 22:35 is not representable, so 15-minute service starts 22:30.
assert.equal(lastStart({ durationMin: 15, stepMin: 10 }), '22:30');
assert.equal(lastStart({ durationMin: 30, stepMin: 10 }), '22:20');
assert.equal(lastStart({ durationMin: 60, stepMin: 10 }), '21:50');

// Explicitly prove that no slot may overrun shift end through service + buffer.
const timeline = generateSalonTimeSlots('15:00', '23:00', 5);
for (const durationMin of [15, 30, 60, 95]) {
  const starts = filterSlotsByServiceEnd(timeline, '23:00', durationMin, 10, 0);
  for (const slot of starts) {
    assert.ok(
      slot.minutes + durationMin + 10 <= 23 * 60,
      `${slot.value24} overruns 23:00 for duration=${durationMin}`
    );
  }
}

console.log('Booking shift-end boundary check passed: service duration + buffer never exceed employee shift end.');
