import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createClient, patchClient } from "./core/repositories/clients.js";

function rowObject(row) {
  return row == null ? null : { ...row };
}

function d1FromSqlite(database) {
  const bindStatement = (sql, bindings) => {
    const execute = (mode) => {
      const statement = database.prepare(sql);

      if (mode === "first") {
        return rowObject(statement.get(...bindings));
      }

      if (mode === "all") {
        return {
          results: statement.all(...bindings).map((row) => ({ ...row })),
        };
      }

      const result = statement.run(...bindings);
      return {
        meta: {
          changes: Number(result.changes || 0),
        },
      };
    };

    return {
      async first() {
        return execute("first");
      },
      async all() {
        return execute("all");
      },
      async run() {
        return execute("run");
      },
      async __batchRun() {
        return execute("run");
      },
    };
  };

  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return bindStatement(sql, bindings);
        },
        async first() {
          return bindStatement(sql, []).first();
        },
        async all() {
          return bindStatement(sql, []).all();
        },
        async run() {
          return bindStatement(sql, []).run();
        },
      };
    },

    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.__batchRun());
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function createFixture() {
  const sqlite = new DatabaseSync(":memory:");

  sqlite.exec(`
    CREATE TABLE clients (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone_normalized TEXT,
      email TEXT,
      firebase_uid TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      vip INTEGER NOT NULL DEFAULT 0,
      legacy_client_doc_id TEXT,
      canonical_client_id TEXT,
      legacy_ids_json TEXT NOT NULL DEFAULT '[]',
      birthdate TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE client_aliases (
      salon_id TEXT NOT NULL,
      alias_id TEXT NOT NULL,
      canonical_client_id TEXT NOT NULL,
      alias_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (salon_id, alias_id)
    );
  `);

  return {
    sqlite,
    db: d1FromSqlite(sqlite),
  };
}

async function seed(db, data) {
  return createClient(db, "main", data);
}

function countClients(sqlite) {
  return Number(
    sqlite.prepare("SELECT COUNT(*) AS count FROM clients").get().count
  );
}

test("createClient reuses an existing client by normalized phone even when the name differs", async () => {
  const { sqlite, db } = createFixture();

  const original = await seed(db, {
    id: "client-a",
    name: "nawaf",
    phone: "0590130494",
  });

  const resolved = await createClient(db, "main", {
    name: "nawaf oly",
    phone: "0590130494",
  });

  assert.equal(resolved.id, original.id);
  assert.equal(countClients(sqlite), 1);
});

test("createClient reuses an existing client by firebase uid", async () => {
  const { sqlite, db } = createFixture();

  const original = await seed(db, {
    id: "client-a",
    name: "Original",
    firebaseUid: "uid-123",
  });

  const resolved = await createClient(db, "main", {
    name: "Different Name",
    firebaseUid: "uid-123",
  });

  assert.equal(resolved.id, original.id);
  assert.equal(countClients(sqlite), 1);
});

test("createClient reuses an existing client by normalized email", async () => {
  const { sqlite, db } = createFixture();

  const original = await seed(db, {
    id: "client-a",
    name: "Original",
    email: "Nawaf@Example.COM",
  });

  const resolved = await createClient(db, "main", {
    name: "Different Name",
    email: "  nawaf@example.com  ",
  });

  assert.equal(resolved.id, original.id);
  assert.equal(countClients(sqlite), 1);
});

test("createClient rejects when phone and email resolve to different clients", async () => {
  const { db } = createFixture();

  await seed(db, {
    id: "client-phone",
    name: "Phone owner",
    phone: "0500000001",
  });

  await seed(db, {
    id: "client-email",
    name: "Email owner",
    email: "owner@example.com",
  });

  await assert.rejects(
    () =>
      createClient(db, "main", {
        name: "Conflicting identity",
        phone: "0500000001",
        email: "owner@example.com",
      }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "core_client:identity_conflict");
      return true;
    }
  );
});

test("createClient rejects when firebase uid and phone resolve to different clients", async () => {
  const { db } = createFixture();

  await seed(db, {
    id: "client-uid",
    name: "UID owner",
    firebaseUid: "uid-owner",
  });

  await seed(db, {
    id: "client-phone",
    name: "Phone owner",
    phone: "0500000002",
  });

  await assert.rejects(
    () =>
      createClient(db, "main", {
        name: "Conflicting identity",
        firebaseUid: "uid-owner",
        phone: "0500000002",
      }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "core_client:identity_conflict");
      return true;
    }
  );
});

test("createClient creates a genuinely new client when no identity matches", async () => {
  const { sqlite, db } = createFixture();

  await seed(db, {
    id: "client-a",
    name: "Existing",
    phone: "0500000003",
    email: "existing@example.com",
    firebaseUid: "uid-existing",
  });

  const created = await createClient(db, "main", {
    id: "client-b",
    name: "New Client",
    phone: "0500000004",
    email: "new@example.com",
    firebaseUid: "uid-new",
  });

  assert.equal(created.id, "client-b");
  assert.equal(countClients(sqlite), 2);
});

test("patchClient rejects moving an email onto another client's identity", async () => {
  const { db } = createFixture();

  await seed(db, {
    id: "client-a",
    name: "A",
    email: "a@example.com",
  });

  await seed(db, {
    id: "client-b",
    name: "B",
    email: "b@example.com",
  });

  await assert.rejects(
    () =>
      patchClient(db, "main", "client-b", {
        email: " A@EXAMPLE.COM ",
      }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "core_client:email_conflict");
      return true;
    }
  );
});

test("patchClient rejects moving a firebase uid onto another client's identity", async () => {
  const { db } = createFixture();

  await seed(db, {
    id: "client-a",
    name: "A",
    firebaseUid: "uid-a",
  });

  await seed(db, {
    id: "client-b",
    name: "B",
    firebaseUid: "uid-b",
  });

  await assert.rejects(
    () =>
      patchClient(db, "main", "client-b", {
        firebaseUid: "uid-a",
      }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "core_client:firebase_uid_conflict");
      return true;
    }
  );
});


test("createClient rejects ambiguous legacy phone identity", async () => {
  const { sqlite, db } = createFixture();

  sqlite.exec(`
    INSERT INTO clients
      (id, salon_id, name, phone_normalized, email, firebase_uid, created_at, updated_at)
    VALUES
      ('legacy_phone_a', 'main', 'A', '0590130494', NULL, NULL, '2026-01-01', '2026-01-01'),
      ('legacy_phone_b', 'main', 'B', '0590130494', NULL, NULL, '2026-01-01', '2026-01-01')
  `);

  await assert.rejects(
    () =>
      createClient(db, "main", {
        name: "Incoming",
        phone: "0590130494",
      }),
    (error) => {
      assert.equal(error?.status, 409);
      assert.equal(error?.code, "core_client:identity_ambiguous");
      return true;
    }
  );
});

test("createClient rejects ambiguous legacy email identity", async () => {
  const { sqlite, db } = createFixture();

  sqlite.exec(`
    INSERT INTO clients
      (id, salon_id, name, phone_normalized, email, firebase_uid, created_at, updated_at)
    VALUES
      ('legacy_email_a', 'main', 'A', NULL, 'same@example.com', NULL, '2026-01-01', '2026-01-01'),
      ('legacy_email_b', 'main', 'B', NULL, 'SAME@example.com', NULL, '2026-01-01', '2026-01-01')
  `);

  await assert.rejects(
    () =>
      createClient(db, "main", {
        name: "Incoming",
        email: "same@example.com",
      }),
    (error) => {
      assert.equal(error?.status, 409);
      assert.equal(error?.code, "core_client:identity_ambiguous");
      return true;
    }
  );
});

test("createClient rejects ambiguous legacy firebase uid identity", async () => {
  const { sqlite, db } = createFixture();

  sqlite.exec(`
    INSERT INTO clients
      (id, salon_id, name, phone_normalized, email, firebase_uid, created_at, updated_at)
    VALUES
      ('legacy_uid_a', 'main', 'A', NULL, NULL, 'uid_same', '2026-01-01', '2026-01-01'),
      ('legacy_uid_b', 'main', 'B', NULL, NULL, 'uid_same', '2026-01-01', '2026-01-01')
  `);

  await assert.rejects(
    () =>
      createClient(db, "main", {
        name: "Incoming",
        firebaseUid: "uid_same",
      }),
    (error) => {
      assert.equal(error?.status, 409);
      assert.equal(error?.code, "core_client:identity_ambiguous");
      return true;
    }
  );
});
