import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

test("customer record exposes exactly one edit-data action", () => {
  const source = fs.readFileSync(
    path.join(root, "src/features/customers/CustomerRecordModal.tsx"),
    "utf8"
  );

  assert.equal((source.match(/تعديل البيانات/g) || []).length, 1);
  assert.match(source, /dsv2-customers-section-edit/);
});

test("customer text has guarded mojibake repair at display boundary", () => {
  const formatter = fs.readFileSync(
    path.join(root, "src/features/customers/customerFormatters.ts"),
    "utf8"
  );
  const modal = fs.readFileSync(
    path.join(root, "src/features/customers/CustomerRecordModal.tsx"),
    "utf8"
  );

  assert.match(formatter, /CUSTOMER_TEXT_ENCODING_POLICY_V1/);
  assert.match(formatter, /repairCustomerDisplayText/);
  assert.match(formatter, /TextDecoder\("windows-1256"\)/);
  assert.match(formatter, /TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(modal, /repairCustomerDisplayText\(customer\.importedNote\)/);
});
