import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const employees = fs.readFileSync(
  path.join(root, "src/pages/DashboardEmployees.tsx"),
  "utf8"
);
const payroll = fs.readFileSync(
  path.join(root, "src/pages/DashboardPayroll.tsx"),
  "utf8"
);
const entryCss = fs.readFileSync(
  path.join(root, "src/styles/dashboard-v2/dashboard-v2.css"),
  "utf8"
);
const referenceCss = fs.readFileSync(
  path.join(root, "src/styles/dashboard-v2/workflow-modal-reference.css"),
  "utf8"
);

test("workflow dialogs share one Dashboard V2 modal reference", () => {
  const offboardingTitle = employees.indexOf('title="إنهاء خدمة الموظفة"');
  assert.ok(offboardingTitle >= 0, "employee offboarding modal not found");

  const offboardingStart = employees.lastIndexOf(
    "<DashboardModalV2",
    offboardingTitle
  );
  assert.ok(offboardingStart >= 0, "offboarding DashboardModalV2 start not found");

  const offboardingClose = employees.indexOf(
    "</DashboardModalV2>",
    offboardingTitle
  );
  assert.ok(offboardingClose > offboardingTitle, "offboarding DashboardModalV2 end not found");

  const offboardingArea = employees.slice(
    offboardingStart,
    offboardingClose + "</DashboardModalV2>".length
  );
  assert.match(offboardingArea, /dsv2-workflow-reference/);

  const payrollReferenceCount = (
    payroll.match(/payroll-modal[^"]*dsv2-workflow-reference/g) || []
  ).length;

  assert.ok(
    payrollReferenceCount >= 4,
    `expected at least 4 payroll workflow dialogs on the shared reference, got ${payrollReferenceCount}`
  );

  assert.match(payroll, /aria-label="تسجيل اعتماد متأخر"/);
  assert.match(payroll, /aria-label="إدارة تسجيل الدفع"/);
  assert.match(payroll, /aria-label="إعادة فتح الراتب"/);
  assert.match(payroll, /تأكيد الاعتماد/);

  assert.match(
    entryCss,
    /@import "\.\/workflow-modal-reference\.css";/
  );

  assert.match(
    referenceCss,
    /Dashboard V2 — Workflow Modal Reference/
  );

  assert.match(
    referenceCss,
    /\.dsv2-modal\.dsv2-workflow-reference/
  );

  assert.match(
    referenceCss,
    /\.payroll-modal\.dsv2-workflow-reference/
  );
  assert.match(
    referenceCss,
    /WORKFLOW_MODAL_TEXT_CONTRAST_V1/
  );
  assert.match(
    referenceCss,
    /-webkit-text-fill-color:\s*#172033\s*!important/
  );
  assert.match(
    referenceCss,
    /::placeholder/
  );
  assert.match(
    referenceCss,
    /#765b16/
  );

  assert.match(
    payroll,
    /payroll-detail-modal dsv2-workflow-reference dsv2-workflow-reference--wide/
  );
  assert.match(
    referenceCss,
    /WORKFLOW_MODAL_WIDE_DETAIL_V1/
  );
  assert.match(
    referenceCss,
    /dsv2-workflow-reference--wide/
  );

  assert.match(
    referenceCss,
    /WORKFLOW_MODAL_DETAIL_CONTENT_REFERENCE_V1/
  );
  assert.match(
    referenceCss,
    /\.payroll-detail-grid[\s\S]*grid-template-columns:\s*minmax\(145px, 44%\)/
  );
  assert.match(
    referenceCss,
    /\.payroll-net-panel[\s\S]*repeat\(5, minmax\(0, 1fr\)\)/
  );
  assert.match(
    referenceCss,
    /font-variant-numeric:\s*tabular-nums/
  );

  assert.doesNotMatch(
    payroll,
    /السجل المختصر/
  );
  assert.match(
    referenceCss,
    /WORKFLOW_MODAL_DAILY_ITEMS_REFINEMENT_V1/
  );
  assert.match(
    referenceCss,
    /\.payroll-adjustment-list[\s\S]*> span/
  );
  assert.match(
    referenceCss,
    /linear-gradient\(180deg/
  );
  assert.match(
    referenceCss,
    /#475467/
  );

  assert.doesNotMatch(
    payroll,
    /className="payroll-audit-list"/
  );
  assert.doesNotMatch(
    payroll,
    /سجل مختصر/
  );
  assert.match(
    referenceCss,
    /WORKFLOW_MODAL_ALL_DETAIL_CARDS_V1/
  );
  assert.match(
    referenceCss,
    /\.payroll-adjustment-list[\s\S]*> p/
  );
  assert.match(
    referenceCss,
    /-webkit-text-fill-color:\s*#475467\s*!important/
  );
  assert.match(
    referenceCss,
    /\.payroll-detail-grid > section/
  );
assert.match(
    referenceCss,
    /WORKFLOW_MODAL_NUMERIC_ENGLISH_AND_SPACING_V1/
  );
  assert.match(
    referenceCss,
    /\.payroll-net-panel[\s\S]*margin-top:\s*22px/
  );
  assert.match(
    referenceCss,
    /unicode-bidi:\s*isolate/
  );

  assert.match(
    referenceCss,
    /WORKFLOW_MODAL_STICKY_HEADER_V1/
  );
  assert.match(
    referenceCss,
    /\.dsv2-dialog__head[\s\S]*position:\s*sticky\s*!important/
  );
  assert.match(
    referenceCss,
    /\.payroll-modal\.dsv2-workflow-reference[\s\S]*> header[\s\S]*top:\s*0\s*!important/
  );
  assert.match(
    referenceCss,
    /z-index:\s*50\s*!important/
  );

});
