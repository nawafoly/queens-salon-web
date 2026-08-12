import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const AUDIT_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, '.sql', '.md', '.txt']);
const SCAN_ROOTS = ['src', 'workers', 'scripts', 'migrations', 'docs', 'functions'];
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-staff',
  'coverage',
  '.wrangler',
  '.vite',
  'build',
]);

const bookingRuntimeRoots = [
  'src/pages/Booking.tsx',
  'src/pages/BookingInternal.tsx',
  'src/features/internal-booking-v2/BookingInternalV2.tsx',
  'src/pages/Checkout.tsx',
  'src/pages/DashboardBookings.tsx',
  'src/services/bookingDataSource.ts',
  'src/services/bookingDataSourceCompat.ts',
  'src/services/bookingDataSources/coreD1BookingDataSource.ts',
  'src/services/CoreAvailabilityService.ts',
  'workers/core/repositories/availability.js',
  'workers/core/repositories/booking-staff-policy.js',
  'workers/core/repositories/bookings.js',
];

const alwaysFirestoreFallbackFiles = new Set([
  'src/services/bookingDataSources/firestoreBookingDataSource.ts',
]);

const compatibilityFiles = new Set([
  'src/services/coreBookingMappers.ts',
  'workers/core/repositories/staff.js',
]);

const rules = [
  ['staff_schedules', /\bstaff_schedules\b/g],
  ['customWorkingHours', /\bcustomWorkingHours\b/g],
  ['customWorkingHourOverrides', /\bcustomWorkingHourOverrides\b/g],
  ['resolveStaffWorkingWindowsForDate', /\bresolveStaffWorkingWindowsForDate\b/g],
  ['filterStaffSlotsByWorkingHours', /\bfilterStaffSlotsByWorkingHours\b/g],
  ['isStaffWorkingAtTime', /\bisStaffWorkingAtTime\b/g],
  ['isStaffAvailableForDate', /\bisStaffAvailableForDate\b/g],
  ['getStaffLeaveMetaForDate', /\bgetStaffLeaveMetaForDate\b/g],
  ['legacy leave_start_date', /\bleave_start_date\b/g],
  ['legacy leave_end_date', /\bleave_end_date\b/g],
  ['legacy leaveStartDate', /\bleaveStartDate\b/g],
  ['legacy leaveEndDate', /\bleaveEndDate\b/g],
  ['Firestore booking datasource', /\bfirestoreBookingDataSource\b/g],
  ['Firestore bookings module import', /(?:import|export)[^\n]*from\s+["'][^"']*firestoreBookings["']/g],
  ['Firestore availability backfill', /\bfirestoreAvailabilityBackfill\b/g],
  ['Firebase Firestore runtime', /from\s+["']firebase\/firestore["']/g],
  ['Firestore availability_days', /["']availability_days["']/g],
  ['Firestore booking_slots', /["']booking_slots["']/g],
  ['Core/Firestore runtime flag branch', /getDataSourceFlags\(\)\.useCoreD1/g],
  ['non-zero booking overtime', /\bALLOW_OVERTIME_MIN\s*=\s*(?!0\b)\d+/g],
  ['hardcoded 12:00-22:00 booking window', /["']12:00["'][\s\S]{0,180}?["']22:00["']/g],
  ['salon hours generate staff slot grid', /generateSalonTimeSlots\(\s*(?:dayOpenTime|dayHours\.start)[\s\S]{0,220}?(?:dayCloseTime|dayHours\.end)/g],
  ['salon close caps staff service end', /filterSlotsByServiceEnd\([\s\S]{0,260}?\bdayCloseTime\b/g],
];

function posix(value) {
  return value.split(path.sep).join('/');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (AUDIT_EXTENSIONS.has(ext)) out.push(posix(path.relative(root, abs)));
  }
  return out;
}

const allFiles = [...new Set(SCAN_ROOTS.flatMap((scanRoot) => walk(path.join(root, scanRoot))))].sort();
const sourceFiles = new Set(allFiles.filter((file) => SOURCE_EXTENSIONS.includes(path.extname(file).toLowerCase())));
const textCache = new Map();
function read(file) {
  if (!textCache.has(file)) {
    textCache.set(file, fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'));
  }
  return textCache.get(file);
}

function isTypeOnlyImport(prefix, clause) {
  if (String(prefix || '').trim()) return true;
  const trimmed = String(clause || '').trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  const names = trimmed.slice(1, -1).split(',').map((part) => part.trim()).filter(Boolean);
  return names.length > 0 && names.every((part) => part.startsWith('type '));
}

function resolveRelativeImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return '';
  const base = posix(path.normalize(path.join(path.dirname(fromFile), specifier)));
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];
  return candidates.find((candidate) => sourceFiles.has(candidate)) || '';
}

function runtimeImports(file) {
  if (!sourceFiles.has(file)) return [];
  const text = read(file);
  const imports = [];
  const importRe = /\bimport\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/g;
  for (const match of text.matchAll(importRe)) {
    if (isTypeOnlyImport(match[1], match[2])) continue;
    const resolved = resolveRelativeImport(file, match[3]);
    if (resolved) imports.push(resolved);
  }
  const sideEffectRe = /\bimport\s+["']([^"']+)["']\s*;?/g;
  for (const match of text.matchAll(sideEffectRe)) {
    const resolved = resolveRelativeImport(file, match[1]);
    if (resolved) imports.push(resolved);
  }
  const dynamicRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of text.matchAll(dynamicRe)) {
    const resolved = resolveRelativeImport(file, match[1]);
    if (resolved) imports.push(resolved);
  }
  return [...new Set(imports)];
}

const reachable = new Set();
const queue = bookingRuntimeRoots.filter((file) => sourceFiles.has(file));
while (queue.length) {
  const file = queue.shift();
  if (!file || reachable.has(file)) continue;
  reachable.add(file);
  for (const dependency of runtimeImports(file)) {
    if (!reachable.has(dependency)) queue.push(dependency);
  }
}

function lineForIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function isHistoryOrMigration(file) {
  return (
    file.startsWith('migrations/') ||
    file.startsWith('docs/') ||
    file.startsWith('scripts/') ||
    file.includes('/migrations/') ||
    /(?:^|\/)PHASE\d|(?:^|\/)README|(?:^|\/)CHANGELOG/i.test(file) ||
    /(?:\.test\.|\.spec\.|__tests__|\/tests?\/)/i.test(file)
  );
}

function typeOnlyContext(context) {
  return /\bimport\s+type\b/.test(context) || /\{\s*type\s+[^}]+\}\s+from/.test(context);
}

function categoryFor(file, label, context) {
  if (isHistoryOrMigration(file)) return 2;
  if (alwaysFirestoreFallbackFiles.has(file)) return 4;
  if (typeOnlyContext(context) || file.startsWith('src/types/') || compatibilityFiles.has(file)) return 3;
  if (!reachable.has(file)) return 0;

  // Firestore can still be used for non-booking compatibility/catalog reads in
  // a booking screen during the cutover. The high-risk condition is a booking
  // availability/write fallback, not a generic firebase/firestore import.
  if (label === 'Firebase Firestore runtime') {
    return /(?:^|\/)(?:firestoreBookings|firestoreBookingDataSource)\.[cm]?[jt]sx?$/.test(file) ? 4 : 3;
  }

  // General salon business hours may remain for UI/open-day semantics. They
  // become high risk only when they generate/cap an employee slot grid; those
  // decision patterns have dedicated rules below.
  if (label === 'hardcoded 12:00-22:00 booking window') return 3;

  if (
    label.startsWith('Firestore ') ||
    label === 'Core/Firestore runtime flag branch' ||
    label === 'non-zero booking overtime'
  ) {
    return 4;
  }
  return 1;
}

const findings = [];
for (const file of allFiles) {
  const text = read(file);
  const lines = text.split('\n');
  for (const [label, regex] of rules) {
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
    for (const match of text.matchAll(re)) {
      const line = lineForIndex(text, match.index ?? 0);
      const from = Math.max(1, line - 1);
      const to = Math.min(lines.length, line + 1);
      const context = lines.slice(from - 1, to).join(' | ').trim();
      const category = categoryFor(file, label, context);
      if (!category) continue;
      findings.push({ file, line, label, category, context });
    }
  }
}

findings.sort((a, b) => a.category - b.category || a.file.localeCompare(b.file) || a.line - b.line || a.label.localeCompare(b.label));

const categoryTitles = new Map([
  [1, 'Runtime Legacy يجب حذفه'],
  [2, 'Migration/history فقط ويمكن أن يبقى'],
  [3, 'Type/DTO compatibility لا يتخذ قرارًا ويمكن أن يبقى مؤقتًا'],
  [4, 'Firestore runtime fallback يجب قطعه'],
]);

console.log('=== LEGACY BOOKING RUNTIME AUDIT ===');
console.log(`repo files scanned: ${allFiles.length}`);
console.log(`booking runtime files reachable: ${reachable.size}`);
console.log(`findings: ${findings.length}`);

for (const category of [1, 4, 3, 2]) {
  const rows = findings.filter((item) => item.category === category);
  console.log(`\n=== CATEGORY ${category}: ${categoryTitles.get(category)} (${rows.length}) ===`);
  let current = '';
  for (const item of rows) {
    if (item.file !== current) {
      current = item.file;
      console.log(`\n## ${current}`);
    }
    console.log(`[${item.line}] ${item.label}`);
    console.log(`  ${item.context}`);
  }
}

const highRisk = findings.filter((item) => item.category === 1 || item.category === 4);
console.log('\n=== SUMMARY ===');
for (const category of [1, 2, 3, 4]) {
  console.log(`CATEGORY_${category}_TOTAL: ${findings.filter((item) => item.category === category).length}`);
}
const counts = new Map();
for (const item of findings) counts.set(item.label, (counts.get(item.label) || 0) + 1);
for (const [label, count] of [...counts.entries()].sort()) console.log(`${label}: ${count}`);
console.log(`HIGH_RISK_TOTAL: ${highRisk.length}`);

if (process.argv.includes('--fail-on-high-risk') && highRisk.length) process.exitCode = 1;
