import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("workers/core/repositories/files.js", "utf8");
const migration = readFileSync("migrations/core/0064_file_metadata_read_efficiency.sql", "utf8");

test("file metadata filters are applied inside D1 before LIMIT", () => {
  const start = source.indexOf("export async function listFileMetadata");
  const end = source.indexOf("export async function getFileMetadata", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.match(block, /where = \['salon_id = \?'\]/);
  assert.match(block, /where\.push\('employee_id = \?'\)/);
  assert.match(block, /where\.push\('category = \?'\)/);
  assert.match(block, /where\.push\('status = \?'\)/);
  assert.match(block, /WHERE \$\{where\.join\(' AND '\)\}/);
  assert.match(block, /ORDER BY created_at DESC[\s\S]*LIMIT \?/);
  assert.doesNotMatch(block, /rows\.filter/);
  assert.doesNotMatch(block, /LIMIT 1000'/);
});

test("file metadata list indexes cover tenant ordering and scoped employee reads", () => {
  assert.match(
    migration,
    /file_metadata\(salon_id, created_at DESC\)/
  );
  assert.match(
    migration,
    /file_metadata\(salon_id, employee_id, category, status, created_at DESC\)/
  );
});
