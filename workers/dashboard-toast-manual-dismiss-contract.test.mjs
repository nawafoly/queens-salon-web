import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/components/dashboard-v2/DashboardToastV2.tsx", import.meta.url),
  "utf8",
);

const toastItem = source.slice(
  source.indexOf("function DashboardToastItemV2("),
  source.indexOf("export function useDashboardToastV2()"),
);

test("dashboard toast has a visible explicit dismiss control", () => {
  assert.match(toastItem, /className="dsv2-toast__close"/);
  assert.match(toastItem, /onClick=\{\(\) => onDismiss\(toast\.id\)\}/);
  assert.match(toastItem, /aria-label="إغلاق الإشعار"/);
});

test("dashboard toast does not schedule automatic dismissal", () => {
  assert.doesNotMatch(toastItem, /setTimeout|scheduleDismiss|remainingRef|pauseTimer|resumeTimer/);
  assert.match(source, /const dismissToast = useCallback/);
  assert.match(source, /setToasts\(\(current\) => current\.filter\(\(toast\) => toast\.id !== id\)\)/);
});
