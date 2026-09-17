import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("employee web push keeps D1 as authority and uses durable outbox", () => {
  const migration = read("migrations/core/0076_employee_web_push.sql");
  const repository = read("workers/core/repositories/web-push.js");
  const worker = read("workers/core/index.js");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS web_push_subscriptions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS web_push_outbox/);
  assert.match(migration, /AFTER INSERT ON employee_notifications/);
  assert.match(migration, /AFTER INSERT ON notification_records/);
  assert.match(repository, /sendPushNotification/);
  assert.match(repository, /unreadCountForUid/);
  assert.match(worker, /employee-push:subscribe/);
  assert.match(worker, /flushEmployeeWebPushOutbox/);
});

test("employee PWA shows user-visible push and synchronizes app badge", () => {
  const serviceWorker = read("public/employee-push-sw.js");
  const client = read("src/services/employeeWebPush.ts");
  const portal = read("src/pages/EmployeePortal.tsx");

  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /setAppBadge/);
  assert.match(serviceWorker, /notificationclick/);
  assert.match(client, /Notification\.requestPermission/);
  assert.match(client, /pushManager\.subscribe/);
  assert.match(client, /\/api\/core\/hr\/push\/subscriptions/);
  assert.match(portal, /syncEmployeeAppBadge/);
  assert.match(portal, /تنبيهات التطبيق/);
});
