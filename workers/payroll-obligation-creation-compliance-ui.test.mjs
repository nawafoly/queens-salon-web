import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../src/pages/dashboardEmployees/PayrollObligationsPanel.tsx",
    import.meta.url
  ),
  "utf8"
);

function functionBlock(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing: ${startMarker}`);

  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `missing boundary after: ${startMarker}`);

  return source.slice(start, end);
}

test(
  "recurring deduction validation returns before Core write",
  () => {
    const block = functionBlock(
      "async function submitRecurringDeduction()",
      "async function submitOneTimeObligation()"
    );

    const validation = block.indexOf(
      "if (Object.keys(nextErrors).length > 0)"
    );
    const earlyReturn = block.indexOf(
      "return;",
      validation
    );
    const write = block.indexOf(
      "CoreHrService.savePayrollRecurringDeduction"
    );

    assert.ok(validation >= 0);
    assert.ok(earlyReturn > validation);
    assert.ok(write > earlyReturn);
    assert.match(
      block,
      /complianceValidationErrors\(recurringCompliance\)/
    );
  }
);

test(
  "one-time obligation validation returns before Core write",
  () => {
    const start = source.indexOf(
      "async function submitOneTimeObligation()"
    );
    const end = source.indexOf(
      "\n  return (",
      start
    );

    assert.ok(start >= 0);
    assert.ok(end > start);

    const block = source.slice(start, end);

    const validation = block.indexOf(
      "if (Object.keys(nextErrors).length > 0)"
    );
    const earlyReturn = block.indexOf(
      "return;",
      validation
    );
    const write = block.indexOf(
      "CoreHrService.createPayrollObligation"
    );

    assert.ok(validation >= 0);
    assert.ok(earlyReturn > validation);
    assert.ok(write > earlyReturn);
    assert.match(
      block,
      /complianceValidationErrors\(obligationCompliance\)/
    );
  }
);

test(
  "creation UI exposes inline compliance validation",
  () => {
    assert.match(
      source,
      /data-payroll-recurring-form="true"/
    );
    assert.match(
      source,
      /data-payroll-obligation-form="true"/
    );
    assert.match(
      source,
      /error=\{recurringErrors\.laborDeductionClass\}/
    );
    assert.match(
      source,
      /error=\{obligationErrors\.laborDeductionClass\}/
    );
    assert.match(
      source,
      /error=\{recurringErrors\.evidenceReference\}/
    );
    assert.match(
      source,
      /error=\{obligationErrors\.evidenceReference\}/
    );
    assert.match(
      source,
      /focusFirstInvalidForm/
    );
  }
);
