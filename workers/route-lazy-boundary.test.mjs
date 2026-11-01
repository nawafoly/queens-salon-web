import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/App.tsx", "utf8");

test("protected Dashboard and EmployeePortal are loaded only on demand", () => {
  for (const page of ["Dashboard", "EmployeePortal"]) {
    assert.ok(app.includes(`const ${page} = React.lazy(() => import("./pages/${page}"));`));
    assert.ok(!app.includes(`import ${page} from "./pages/${page}";`));
  }
});

test("existing route guards remain wrapped in branded Suspense fallback", () => {
  assert.ok(app.includes('<React.Suspense fallback={<LoadingBrand text="جاري تحميل الصفحة..." />}>'));
  assert.match(app, /<React\.Suspense[\s\S]*?<Routes>[\s\S]*?<\/Routes>[\s\S]*?<\/React\.Suspense>/);
  assert.ok(app.includes("renderAdminRoute("));
  assert.ok(app.includes("renderDashboardRoute("));
  assert.ok(app.includes("renderEmployeeRoute(<EmployeePortal />)"));
});
