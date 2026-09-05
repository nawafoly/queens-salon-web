import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("dashboard loyalty is Core D1 only", () => {
  const page = read("src/pages/DashboardLoyalty.tsx");
  const service = read("src/services/CoreClientService.ts");
  const repo = read("workers/core/repositories/clients.js");

  assert.match(page, /CoreClientService\.list\("", \{ includeLoyalty: true \}\)/);
  assert.match(page, /CoreClientService\.patch\(client\.id, \{ vip: nextVip \}\)/);
  assert.doesNotMatch(page, /firebase\/firestore|services\/firebase|FirestoreReadStats/);
  assert.doesNotMatch(page, /\b(getDoc|getDocs|setDoc|updateDoc|collection|doc)\b/);

  assert.match(service, /includeLoyalty/);
  assert.match(service, /loyaltyBalance/);
  assert.match(repo, /loyalty_point_transactions/);
  assert.match(repo, /SUM\(points\) AS loyalty_balance/);
  assert.match(repo, /last_completed_at/);
  assert.doesNotMatch(repo, /firebase|firestore/i);
});

test("client list loyalty summary is one Core query, not an N+1 overview loop", () => {
  const page = read("src/pages/DashboardLoyalty.tsx");
  const repo = read("workers/core/repositories/clients.js");
  assert.doesNotMatch(page, /\.map\([^)]*CoreClientService\.overview/);
  assert.match(repo, /LEFT JOIN \(\s*SELECT\s+client_id,[\s\S]*GROUP BY client_id/);
});
