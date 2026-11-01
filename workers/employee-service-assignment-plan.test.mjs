import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/helpers/employeeServiceAssignmentPlan.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const { planActiveEmployeeServiceAssignments: plan } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const page = readFileSync("src/pages/DashboardEmployees.tsx", "utf8");

test("stale home-service IDs do not poison active selections sent to Core", () => {
  const data = plan(
    ["home-services_الخدمه_في_المنازل_استشوار_شعر_قصير", "srv-hair", "srv-nails", "srv-hair"],
    [{ id: "srv-hair", active: true }, { id: "srv-nails", active: true }]
  );
  assert.deepEqual(data.activeIds, ["srv-hair", "srv-nails"]);
  assert.deepEqual(data.unresolvedIds, ["home-services_الخدمه_في_المنازل_استشوار_شعر_قصير"]);
});

test("inactive catalog entries are not treated as eligible assignments", () => {
  const data = plan(["id-disabled", "id-current"], [
    { id: "id-disabled", active: false }, { id: "id-current" }
  ]);
  assert.deepEqual(data.activeIds, ["id-current"]);
  assert.deepEqual(data.unresolvedIds, ["id-disabled"]);
});

test("only exact canonical service IDs match; no name-guessing across home and salon services", () => {
  assert.deepEqual(
    plan(["home-services_استشوار"], [{ id: "salon-blowdry", active: true }]),
    { activeIds: [], unresolvedIds: ["home-services_استشوار"] }
  );
});

test("empty or incomplete catalogs are not silently accepted by employee save", () => {
  assert.deepEqual(
    plan(["orphan-id"], []),
    { activeIds: [], unresolvedIds: ["orphan-id"] }
  );
  assert.match(page, /serviceOptions\.length === 0 \|\| serviceOptions\.length >= 1000/);
  assert.match(page, /const approved = await requestConfirmation\(/);
  assert.match(page, /if \(!approved\) return;/);
});

test("employee master write uses verified active assignments and rehydrates from Core", () => {
  assert.match(page, /const specialtiesFixed = serviceSavePlan\.activeIds/);
  assert.match(page, /specialties: specialtiesFixed/);
  assert.match(page, /const reloadedRows = await load\(/);
  assert.match(page, /verifyEmployeeSaveSnapshot\(/);
});
