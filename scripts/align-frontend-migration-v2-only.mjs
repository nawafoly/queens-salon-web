import fs from "node:fs";

const guardPath = "scripts/check-frontend-core-migration.mjs";
let guard = fs.readFileSync(guardPath, "utf8");

guard = guard.replace(
  'import { readFileSync } from "node:fs";',
  'import { existsSync, readFileSync } from "node:fs";'
);

guard = guard.replace(
  /\n\s*\{\s*\n\s*file:\s*["']src\/pages\/BookingInternal\.tsx["'],\s*\n\s*forbidden:\s*\[[\s\S]*?\n\s*\},(?=\s*\n\s*\{)/,
  ""
);
guard = guard.replace(
  /\n\s*\{\s*\n\s*file:\s*["']src\/pages\/BookingInternal\.tsx["'],\s*\n\s*required:\s*\[\/BookingInternalV2\/\],\s*\n\s*\},/,
  ""
);

if (/file:\s*["']src\/pages\/BookingInternal\.tsx["']/.test(guard)) {
  throw new Error("stale BookingInternal contract remains in frontend migration guard");
}
if (!guard.includes('historical BookingInternal wrapper must remain deleted')) {
  guard = guard.replace(
    "const failures = [];",
    'const failures = [];\nif (existsSync("src/pages/BookingInternal.tsx")) {\n  failures.push("src/pages/BookingInternal.tsx: historical BookingInternal wrapper must remain deleted");\n}'
  );
}
fs.writeFileSync(guardPath, guard, "utf8");

const testPath = "workers/frontend-core-migration.test.mjs";
let tests = fs.readFileSync(testPath, "utf8");
tests = tests.replace(
  'import { readFileSync } from "node:fs";',
  'import { existsSync, readFileSync } from "node:fs";'
);

tests = tests.replace(
  /\n\s*const legacyEntry = readFileSync\(["']src\/pages\/BookingInternal\.tsx["'],\s*["']utf8["']\);\s*\n\s*assert\.match\(legacyEntry,\s*\/BookingInternalV2\/\);\s*\n\s*assert\.doesNotMatch\(legacyEntry,[\s\S]*?firestoreAvailabilityBackfill\)[^\n]*\);/,
  '\n\n  assert.equal(existsSync("src/pages/BookingInternal.tsx"), false, "historical BookingInternal wrapper must stay deleted");'
);

tests = tests.replace(
  /const internal = readFileSync\(["']src\/pages\/BookingInternal\.tsx["'],\s*["']utf8["']\);/,
  'const internalV2 = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");'
);
tests = tests.replace(
  /\n\s*assert\.match\(internal,\s*\/BookingInternalV2\/\);\s*\n\s*assert\.doesNotMatch\(internal,\s*\/CoreRefundService\|getDataSourceFlags\/\);/,
  '\n\n  assert.equal(existsSync("src/pages/BookingInternal.tsx"), false, "legacy internal booking entrypoint must stay deleted");\n  assert.doesNotMatch(internalV2, /CoreRefundService|getDataSourceFlags/);'
);

if (tests.includes('readFileSync("src/pages/BookingInternal.tsx"')) {
  throw new Error("frontend migration tests still read deleted BookingInternal.tsx");
}
if (!tests.includes('existsSync("src/pages/BookingInternal.tsx")')) {
  throw new Error("frontend migration tests do not assert legacy wrapper absence");
}
fs.writeFileSync(testPath, tests, "utf8");

console.log("Aligned frontend migration guard/tests with V2-only internal booking architecture.");
