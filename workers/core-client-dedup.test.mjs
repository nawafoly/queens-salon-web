import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCoreClientDedupArtifact } from "../scripts/dedupe-core-clients.mjs";

test("dedupe merges every phone-shaped legacy client into the sole Firebase-linked client", () => {
  const result = buildCoreClientDedupArtifact({
    generatedAt: "2026-07-18T00:00:00.000Z",
    clients: [
      { id: "966547929657", salon_id: "main", name: "legacy", phone_normalized: "0547929657", firebase_uid: null, legacy_ids_json: "[]" },
      { id: "client-real", salon_id: "main", name: "real", phone_normalized: "0547929657", firebase_uid: "uid-real", legacy_ids_json: "[]" },
    ],
    aliases: [{ salon_id: "main", alias_id: "0547929657", canonical_client_id: "966547929657", alias_type: "migration" }],
    activity: { bookings: { "966547929657": 4, "client-real": 2 } },
  });
  assert.equal(result.report.safeMergeCount, 1);
  assert.equal(result.report.blockingGroupCount, 0);
  assert.deepEqual(result.report.safeMerges[0].sourceClientIds, ["966547929657"]);
  assert.match(result.sql, /UPDATE bookings SET client_id = 'client-real'/);
  assert.match(result.sql, /DELETE FROM clients.*'966547929657'/);
  assert.match(result.sql, /'0547929657'.*'client-real'.*'phone'/);
});

test("dedupe reports all unsafe duplicate groups together instead of stopping at the first", () => {
  const result = buildCoreClientDedupArtifact({
    clients: [
      { id: "966500000001", salon_id: "main", phone_normalized: "0500000001" },
      { id: "client-a", salon_id: "main", phone_normalized: "0500000001" },
      { id: "966500000002", salon_id: "main", phone_normalized: "0500000002", firebase_uid: "uid-a" },
      { id: "client-b", salon_id: "main", phone_normalized: "0500000002", firebase_uid: "uid-b" },
    ],
  });
  assert.equal(result.report.safeMergeCount, 0);
  assert.equal(result.report.blockingGroupCount, 2);
  assert.deepEqual(result.report.blockingGroups.map((row) => row.phone), ["0500000001", "0500000002"]);
});

test("duplicate phones without a phone-shaped legacy ID are reported but never auto-merged", () => {
  const result = buildCoreClientDedupArtifact({
    clients: [
      { id: "client-a", salon_id: "main", phone_normalized: "0500000003", firebase_uid: "uid-a" },
      { id: "client-b", salon_id: "main", phone_normalized: "0500000003" },
    ],
  });
  assert.equal(result.report.safeMergeCount, 0);
  assert.equal(result.report.blockingGroupCount, 0);
  assert.equal(result.report.sharedPhoneGroupCount, 1);
});
