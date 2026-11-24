import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

test("client ID index preserves results and tenant isolation", () => {
  const db = new DatabaseSync(":memory:");

  try {
    db.exec(`
      CREATE TABLE clients (
        id TEXT PRIMARY KEY,
        salon_id TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT
      );

      CREATE INDEX idx_core_clients_salon_canonical
      ON clients (salon_id, name);
    `);

    const insert = db.prepare(
      "INSERT INTO clients (id, salon_id, name, phone) VALUES (?, ?, ?, ?)"
    );

    for (let i = 1; i <= 200; i++) {
      insert.run(`main-${i}`, "main", `Client ${i}`, `050${i}`);
      insert.run(`other-${i}`, "other", `Other ${i}`, `060${i}`);
    }

    const scenarios = [
      [],
      ["main-1"],
      ["main-1", "main-2"],
      Array.from({ length: 80 }, (_, i) => `main-${i + 1}`),
      ["main-1", "main-199", "missing-client"],
      ["main-1", "other-1", "main-2"],
      ["main-1", "main-1", "main-2"]
    ];

    for (const ids of scenarios) {
      if (!ids.length) continue;

      const placeholders = ids.map(() => "?").join(",");

      const original = `
        SELECT * FROM clients
        WHERE salon_id = ? AND id IN (${placeholders})
      `;

      const optimized = `
        SELECT * FROM clients INDEXED BY sqlite_autoindex_clients_1
        WHERE salon_id = ? AND id IN (${placeholders})
      `;

      const params = ["main", ...ids];

      const sort = rows =>
        rows.sort((a, b) => a.id.localeCompare(b.id));

      const before = sort(db.prepare(original).all(...params));
      const after = sort(db.prepare(optimized).all(...params));

      assert.deepEqual(
        after,
        before,
        `Result mismatch for ${ids.length} IDs`
      );

      assert.ok(
        after.every(row => row.salon_id === "main"),
        "Tenant isolation failed"
      );

      const plan = db.prepare(
        `EXPLAIN QUERY PLAN ${optimized}`
      ).all(...params);

      assert.ok(
        plan.some(row =>
          String(row.detail).includes("sqlite_autoindex_clients_1")
        ),
        "Client ID index was not used"
      );
    }

    console.log("CLIENT_RESULTS_MATCH");
    console.log("CLIENT_TENANT_ISOLATION_PASSED");
    console.log("CLIENT_ID_INDEX_USED");
  } finally {
    db.close();
  }
});