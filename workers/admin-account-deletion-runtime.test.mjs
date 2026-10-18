import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

test("orphan permanent admin deletion orchestration has no frontend runtime consumer", () => {
  assert.equal(existsSync("src/services/adminAccountDeletionService.ts"), false);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = dir + "/" + entry.name;
    return entry.isDirectory() ? walk(path) : /\.(?:tsx?|jsx?)$/.test(entry.name) ? [path] : [];
  });
  const files = walk("src");
  assert.ok(files.length > 100, "Must inspect the entire frontend source tree");
  const obsoleteImport = /(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])[^"']*\/adminAccountDeletionService["']/;
  for (const path of files) {
    assert.doesNotMatch(readFileSync(path, "utf8"), obsoleteImport, path);
  }
});

test("administrative account deletion remains explicitly logical in D1", () => {
  const settings = readFileSync("src/pages/settings/SettingsUsers.tsx", "utf8");
  const client = readFileSync("src/services/CoreAccountService.ts", "utf8");
  const repo = readFileSync("workers/core/repositories/accounts.js", "utf8");

  assert.ok(settings.includes('if (action === "delete") await CoreAccountService.remove(account.id);'));
  assert.ok(settings.includes('title={t("حذف الحساب منطقياً")}'));
  assert.ok(settings.includes('description={t("سيتم تغيير حالة الحساب في D1 بدون حذف سجل الهوية من Firebase.")}'));
  assert.ok(client.includes("method: \"DELETE\""));
  assert.ok(client.includes("/api/admin/accounts/"));
  assert.ok(repo.includes("export async function deleteAccount("));
  assert.ok(repo.includes("protectOwnerTarget(actor, target, 'delete')"));
  assert.ok(repo.includes("await assertNotLastOwner("));
  assert.ok(repo.includes("return updateAccount(db, salonId, id, { status: 'deleted' }, actor)"));
  assert.doesNotMatch(settings, /adminDeleteUserAccount|deleteAdminAccountPermanently/);
});

test("Firebase Auth deletion callable stays preserved as a separate server capability", () => {
  const functions = readFileSync("functions/src/index.ts", "utf8");
  assert.ok(functions.includes('export const adminDeleteUserAccount = onCall('));
  assert.ok(functions.includes("admin.auth().deleteUser(targetUid)"));
  assert.ok(functions.includes("if (targetUid === callerUid)"));
  assert.ok(functions.includes("batch.delete(usersRef)"));
  assert.ok(functions.includes("batch.delete(adminRef)"));
});
