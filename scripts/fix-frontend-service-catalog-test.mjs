import fs from 'node:fs';

const file = 'workers/frontend-core-migration.test.mjs';
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const staleName = 'service catalog read facades are Firestore-only in Phase 7';
const currentName = 'service catalog facades expose explicit Core reads without runtime source flags';

if (!text.includes(currentName)) {
  const escapedName = staleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `test\\(\\s*(["'])${escapedName}\\1\\s*,\\s*\\(\\)\\s*=>\\s*\\{[\\s\\S]*?\\n\\s*\\}\\);`,
    'g'
  );
  const matches = text.match(pattern) || [];
  if (matches.length !== 1) {
    throw new Error(`[frontend-catalog-test] expected one stale catalog test, found ${matches.length}; namePresent=${text.includes(staleName)}`);
  }

  const replacement = `test("${currentName}", () => {
  const sources = [
    "src/services/firestoreServiceSections.ts",
    "src/services/firestoreServiceCategories.ts",
    "src/services/firestoreServices.ts",
  ].map((file) => readFileSync(file, "utf8"));

  // Booking selects Core explicitly (covered separately). These compatibility
  // facades must not silently choose a backend through a runtime feature flag.
  for (const source of sources) {
    assert.doesNotMatch(source, /getDataSourceFlags/);
  }
  assert.ok(
    sources.some((source) => /coreD1ServiceCatalog/.test(source)),
    "service catalog facades must expose the explicit Core catalog path"
  );
});`;
  text = text.replace(pattern, replacement);
}

if (text.includes(staleName)) {
  throw new Error('[frontend-catalog-test] stale Firestore-only catalog expectation remains');
}
if (!text.includes(currentName)) {
  throw new Error('[frontend-catalog-test] current explicit-Core catalog expectation is missing');
}

fs.writeFileSync(file, eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
console.log('[frontend-catalog-test] explicit Core catalog expectation installed');
