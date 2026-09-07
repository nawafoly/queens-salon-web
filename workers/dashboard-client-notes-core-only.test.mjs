import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("dashboard client notes persist through Core instead of browser storage", () => {
  const modal = readFileSync("src/features/customers/CustomerRecordModal.tsx", "utf8");
  const service = readFileSync("src/services/CoreClientService.ts", "utf8");

  assert.match(modal, /CoreClientService\.patch\(clientId, \{ notes: noteText\.trim\(\) \}\)/);
  assert.match(modal, /تم حفظ الملاحظة في Core/);
  assert.doesNotMatch(modal, /dashboard_client_notes_v1/);
  assert.doesNotMatch(modal, /localStorage\.(?:getItem|setItem)/);

  assert.match(service, /notes:\s*string/);
  assert.match(service, /method:\s*"PATCH"/);
});
