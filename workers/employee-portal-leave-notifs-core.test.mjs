import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scoped = [
  "src/pages/EmployeePortal.tsx",
  "src/pages/hr/EmployeeLeave.tsx",
  "src/pages/hr/EmployeePayroll.tsx",
  "src/pages/hr/EmployeeNotifications.tsx",
  "src/components/EmployeeNotificationBellMenu.tsx",
];

test("employee portal leave/notifications scoped files do not import employeeHub", () => {
  for (const file of scoped) {
    const source = readFileSync(file, "utf8");
    assert.equal(
      /services\/employeeHub/.test(source),
      false,
      `${file} still imports employeeHub`
    );
  }
});

test("employee portal notifications use Core workforce + request notification services", () => {
  const portal = readFileSync("src/pages/EmployeePortal.tsx", "utf8");
  const notifications = readFileSync("src/pages/hr/EmployeeNotifications.tsx", "utf8");
  const bell = readFileSync("src/components/EmployeeNotificationBellMenu.tsx", "utf8");
  const core = readFileSync("src/services/employeeNotificationsCore.ts", "utf8");

  assert.match(portal, /employeeNotificationsCore/);
  assert.match(portal, /listEmployeeRequestNotifications/);
  assert.match(notifications, /markAllEmployeeNotificationsRead/);
  assert.match(notifications, /markAllEmployeeRequestNotificationsRead/);
  assert.match(bell, /employeeNotificationsCore/);
  assert.match(core, /CoreWorkforceService\.listNotifications/);
  assert.match(core, /CoreWorkforceService\.markAllNotificationsRead/);
  assert.equal(/firebase\/firestore/.test(core), false);
});

test("employee leave page uses Core leave request + notification modules", () => {
  const leave = readFileSync("src/pages/hr/EmployeeLeave.tsx", "utf8");
  const leaveCore = readFileSync("src/services/employeeLeaveRequestsCore.ts", "utf8");
  assert.match(leave, /createManagedLeaveRequest/);
  assert.match(leave, /employeeLeaveRequestsCore/);
  assert.match(leave, /employeeNotificationsCore/);
  assert.match(leaveCore, /createManagedEmployeeRequest/);
  assert.match(leaveCore, /listMyEmployeeRequests\(\{ type: "leave"/);
  assert.equal(/firebase\/firestore/.test(leaveCore), false);
});
