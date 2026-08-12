import fs from 'node:fs';

const path = 'src/services/employeeHub.ts';
let text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const expected = '    durationKind: cleanText(input.durationKind).toLowerCase() === "partial" ? "partial" : "full_day",';
const legacy = '    durationKind: input.durationKind === "partial" ? "partial" : "full_day",';

if (!text.includes(expected)) {
  const count = text.split(legacy).length - 1;
  if (count !== 1) {
    throw new Error(`[partial-leave-employeehub] expected one direct durationKind comparison, found ${count}`);
  }
  text = text.replace(legacy, expected);
}

if (!text.includes(expected)) {
  throw new Error('[partial-leave-employeehub] normalized durationKind contract is missing');
}

fs.writeFileSync(path, `${text.replace(/\s+$/g, '')}\n`, 'utf8');
console.log('[partial-leave-employeehub] durationKind normalization installed');
