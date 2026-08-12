import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync('src/helpers/timeSlots.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
  fileName: 'timeSlots.ts',
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
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

const observations = {
  shift: '15:00-23:00',
  bufferMin: 10,
  step5: {
    duration15: lastStart({ durationMin: 15, stepMin: 5 }),
    duration30: lastStart({ durationMin: 30, stepMin: 5 }),
    duration60: lastStart({ durationMin: 60, stepMin: 5 }),
  },
  step10: {
    duration15: lastStart({ durationMin: 15, stepMin: 10 }),
    duration30: lastStart({ durationMin: 30, stepMin: 10 }),
    duration60: lastStart({ durationMin: 60, stepMin: 10 }),
  },
};
fs.writeFileSync(
  'booking-shift-boundary-results.json',
  `${JSON.stringify(observations, null, 2)}\n`,
  'utf8'
);
console.log('Booking shift boundary observations:', JSON.stringify(observations));

assert.equal(observations.step5.duration15, '22:35');
assert.equal(observations.step5.duration30, '22:20');
assert.equal(observations.step5.duration60, '21:50');
assert.equal(observations.step10.duration15, '22:30');
assert.equal(observations.step10.duration30, '22:20');
assert.equal(observations.step10.duration60, '21:50');

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
