import { ensureClientAccount } from "./core/repositories/auth-register.js";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { getSelfProfile, resolveSelfClient } from "./core/repositories/client-portal.js";

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
      status TEXT DEFAULT 'active',
      notes TEXT,
      vip INTEGER DEFAULT 0,
      legacy_client_doc_id TEXT,
      city TEXT,
      birthdate TEXT,
      avatar_url TEXT,
      membership_id TEXT,
      membership_percent REAL,
      canonical_client_id TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE app_users (
      id TEXT PRIMARY KEY,
      firebase_uid TEXT,
      salon_id TEXT,
      email TEXT,
      phone TEXT,
      display_name TEXT,
      photo_url TEXT,
      primary_role TEXT,
      status TEXT,
      email_verified INTEGER,
      last_login_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT,
      legacy_source TEXT,
      legacy_id TEXT
    );

    CREATE TABLE roles (
      salon_id TEXT,
      role_key TEXT,
      role_name TEXT
    );

    CREATE TABLE permissions (
      permission_key TEXT
    );

    CREATE TABLE role_permissions (
      salon_id TEXT,
      role_key TEXT,
      permission_key TEXT
    );

    CREATE TABLE user_permissions (
      salon_id TEXT,
      user_id TEXT,
      permission_key TEXT,
      effect TEXT
    );

    CREATE TABLE user_employee_links (
      salon_id TEXT,
      user_id TEXT,
      link_status TEXT,
      employee_id TEXT
    );
    CREATE TABLE employee_profiles (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      phone_normalized TEXT
    );
    CREATE TABLE client_aliases (
      salon_id TEXT NOT NULL,
      alias_id TEXT NOT NULL,
      canonical_client_id TEXT NOT NULL,
      alias_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (salon_id, alias_id)
    );

    CREATE TABLE bookings (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      status TEXT NOT NULL,
      booking_date TEXT,
      start_time TEXT,
      deleted_at TEXT
    );

    CREATE TABLE invoices (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      client_id TEXT NOT NULL
    );

    CREATE TABLE payments (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      client_id TEXT
    );

    CREATE TABLE refunds (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      client_id TEXT
    );

    CREATE TABLE loyalty_point_transactions (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      client_id TEXT NOT NULL
    );
  `);

  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async first() {
              const row = sqlite.prepare(sql).get(...bindings);
              return row ? { ...row } : null;
            },
            async all() {
              return {
                results: sqlite.prepare(sql)
                  .all(...bindings)
                  .map((row) => ({ ...row })),
              };
            },
            async run() {
              const result = sqlite.prepare(sql).run(...bindings);
              return { meta: { changes: result.changes } };
            },
          };
        },
      };
    },
  };

  return { sqlite, db };
}

test("reading client profile must not migrate another client's financial records", async () => {
  const { sqlite, db } = createFixture();

  sqlite.exec(`
    INSERT INTO clients
      (id, salon_id, name, firebase_uid, canonical_client_id)
    VALUES
      ('uid-client', 'main', 'Test account', 'test-uid', 'uid-client');

    INSERT INTO clients
      (id, salon_id, name, phone_normalized)
    VALUES
      ('phone-client', 'main', 'Test phone', '0500000001');

    INSERT INTO bookings
      (id, salon_id, client_id, status, booking_date, start_time)
    VALUES
      ('booking-1', 'main', 'phone-client', 'completed',
       '2026-11-01', '15:00');

    INSERT INTO invoices
      (id, salon_id, client_id)
    VALUES
      ('invoice-1', 'main', 'phone-client');
  `);

  const identity = {
    uid: "test-uid",
    claims: {
      phone_number: "+966500000001",
      name: "Test account",
    },
  };

  await getSelfProfile(db, "main", identity);

  const booking = sqlite
    .prepare("SELECT client_id FROM bookings WHERE id = ?")
    .get("booking-1");

  const invoice = sqlite
    .prepare("SELECT client_id FROM invoices WHERE id = ?")
    .get("invoice-1");

  assert.equal(
    booking.client_id,
    "phone-client",
    "Reading a profile must not reassign a booking"
  );

  assert.equal(
    invoice.client_id,
    "phone-client",
    "Reading a profile must not reassign an invoice"
  );

  sqlite.close();
});
test("reading an existing client profile must not modify identity records", async () => {
  const { sqlite, db } = createFixture();

  sqlite.exec(`
    INSERT INTO clients
      (id, salon_id, name, firebase_uid, canonical_client_id)
    VALUES
      ('existing-client', 'main', 'Existing account',
       'existing-uid', 'existing-client');
  `);

  const before = sqlite
    .prepare("SELECT total_changes() AS count")
    .get().count;

  await getSelfProfile(db, "main", {
    uid: "existing-uid",
    claims: {
      name: "Existing account",
    },
  });

  const after = sqlite
    .prepare("SELECT total_changes() AS count")
    .get().count;

  assert.equal(
    after,
    before,
    "Reading an existing client profile must not write to the database"
  );

  sqlite.close();
});
test("client portal rejects a phone match owned by another Firebase identity", async () => {
  const { sqlite, db } = createFixture();

  try {
    sqlite.exec(`
      INSERT INTO clients
        (id, salon_id, name, phone_normalized, firebase_uid, canonical_client_id)
      VALUES
        ('client-b', 'main', 'Client B', '0500000002', 'firebase-b', 'client-b');
    `);

    const identity = {
      uid: "firebase-a",
      claims: {
        phone_number: "+966500000002",
        name: "Client A",
      },
    };

    const before = sqlite
      .prepare("SELECT total_changes() AS count")
      .get().count;

    await assert.rejects(
      () => getSelfProfile(db, "main", identity),
      (error) => {
        assert.ok(
          error.status === 403 || error.status === 409,
          "A different Firebase identity must be rejected"
        );
        return true;
      }
    );

    const after = sqlite
      .prepare("SELECT total_changes() AS count")
      .get().count;

    assert.equal(after, before, "Rejected access must not modify client data");
  } finally {
    sqlite.close();
  }
});
test("client portal must not trust an unlinked phone-only identity", async () => {
  const { sqlite, db } = createFixture();

  try {
    sqlite.exec(`
      INSERT INTO clients
        (id, salon_id, name, phone_normalized)
      VALUES
        ('legacy-client', 'main', 'Legacy Client', '0500000003');
    `);

    const before = sqlite
      .prepare("SELECT total_changes() AS count")
      .get().count;

    await assert.rejects(
      () => getSelfProfile(db, "main", {
        uid: "unlinked-firebase-user",
        claims: {
          phone_number: "+966500000003",
          name: "Different User",
        },
      }),
      (error) => {
        assert.ok(
          [403, 404, 409].includes(error.status),
          "Unverified identity ownership must not grant access"
        );
        return true;
      }
    );

    const after = sqlite
      .prepare("SELECT total_changes() AS count")
      .get().count;

    assert.equal(after, before);
  } finally {
    sqlite.close();
  }
});
test("new client registration creates a Firebase-linked client", async () => {
  const { sqlite, db } = createFixture();

  try {
    const client = await resolveSelfClient(
      db,
      "main",
      {
        uid: "firebase-new-client",
        claims: {
          name: "New Client",
        },
      },
      { createIfMissing: true }
    );

    assert.equal(client.firebase_uid, "firebase-new-client");

    const stored = sqlite.prepare(
      "SELECT id, firebase_uid FROM clients WHERE salon_id = ?"
    ).all("main");

    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, client.id);
    assert.equal(stored[0].firebase_uid, "firebase-new-client");
  } finally {
    sqlite.close();
  }
});

test("registration must not claim an unlinked legacy client by phone", async () => {
  const { sqlite, db } = createFixture();

  try {
    sqlite.exec(`
      INSERT INTO clients
        (id, salon_id, name, phone_normalized)
      VALUES
        ('legacy-owner', 'main', 'Legacy Owner', '0500000004');
    `);

    await assert.rejects(
      () => resolveSelfClient(
        db,
        "main",
        {
          uid: "firebase-different-user",
          claims: {
            name: "Different User",
            phone_number: "+966500000004",
          },
        },
        { createIfMissing: true }
      ),
      (error) => {
        assert.ok(
          [403, 409].includes(error.status),
          "Unverified phone ownership must not claim a legacy record"
        );
        return true;
      }
    );

    const legacy = sqlite.prepare(
      "SELECT firebase_uid FROM clients WHERE id = ?"
    ).get("legacy-owner");

    assert.equal(legacy.firebase_uid, null);
  } finally {
    sqlite.close();
  }
});
test("registration preflight rejects a legacy phone collision without writes", async () => {
  const { sqlite, db } = createFixture();

  try {
    sqlite.exec(`
      INSERT INTO clients
        (id, salon_id, name, phone_normalized)
      VALUES
        ('legacy-phone-owner', 'main', 'Legacy Owner', '0500000005');
    `);

    const before = sqlite
      .prepare("SELECT total_changes() AS count")
      .get().count;

    const request = new Request("https://test.local/register", {
      headers: {
        Authorization: "Bearer test:new-phone-user:client",
      },
    });

    await assert.rejects(
      () => ensureClientAccount(
        db,
        "main",
        {
          FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
          PACKAGES_AUTH_TEST_MODE: "true",
        },
        request,
        {
          name: "Different User",
          phone: "0500000005",
        }
      ),
      (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.code, "core_client:identity_link_required");
        return true;
      }
    );

    const after = sqlite
      .prepare("SELECT total_changes() AS count")
      .get().count;

    assert.equal(after, before, "Rejected registration must not write to D1");
  } finally {
    sqlite.close();
  }
});

test("registration preflight rejects a legacy email collision without writes", async () => {
  const { sqlite, db } = createFixture();

  try {
    sqlite.exec(`
      INSERT INTO clients
        (id, salon_id, name, email)
      VALUES
        ('legacy-email-owner', 'main', 'Legacy Owner', 'legacy@example.com');
    `);

    const before = sqlite
      .prepare("SELECT total_changes() AS count")
      .get().count;

    const request = new Request("https://test.local/register", {
      headers: {
        Authorization: "Bearer test:new-email-user:client",
      },
    });

    await assert.rejects(
      () => ensureClientAccount(
        db,
        "main",
        {
          FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
          PACKAGES_AUTH_TEST_MODE: "true",
        },
        request,
        {
          name: "Different User",
          email: "legacy@example.com",
        }
      ),
      (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.code, "core_client:identity_link_required");
        return true;
      }
    );

    const after = sqlite
      .prepare("SELECT total_changes() AS count")
      .get().count;

    assert.equal(after, before, "Rejected registration must not write to D1");
  } finally {
    sqlite.close();
  }
});
test("full client registration creates matching account and profile", async () => {
  const { sqlite, db } = createFixture();

  try {
    const uid = "firebase-full-registration";

    const request = new Request("https://test.local/register", {
      headers: {
        Authorization: `Bearer test:${uid}:client`,
      },
    });

    const result = await ensureClientAccount(
      db,
      "main",
      {
        FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
        PACKAGES_AUTH_TEST_MODE: "true",
      },
      request,
      {
        name: "New Client",
        phone: "0500000006",
      }
    );

    const account = sqlite.prepare(
      "SELECT * FROM app_users WHERE firebase_uid = ?"
    ).get(uid);

    const client = sqlite.prepare(
      "SELECT * FROM clients WHERE firebase_uid = ?"
    ).get(uid);

    assert.ok(account, "Core account must exist");
    assert.ok(client, "Core client profile must exist");

    assert.equal(account.primary_role, "client");
    assert.equal(account.salon_id, "main");
    assert.equal(client.salon_id, "main");
    assert.equal(client.phone_normalized, "0500000006");

    assert.equal(result.user.id, account.id);
    assert.equal(result.client.id, client.id);

    assert.equal(
      sqlite.prepare(
        "SELECT COUNT(*) AS count FROM app_users"
      ).get().count,
      1
    );

    assert.equal(
      sqlite.prepare(
        "SELECT COUNT(*) AS count FROM clients"
      ).get().count,
      1
    );
  } finally {
    sqlite.close();
  }
});
test("registration must not replace another account Firebase UID using an unverified email", async () => {
  const { sqlite, db } = createFixture();

  try {
    sqlite.exec(`
      INSERT INTO app_users (
        id, firebase_uid, salon_id, email,
        display_name, primary_role, status
      )
      VALUES (
        'existing-account',
        'firebase-original-owner',
        'main',
        'existing@example.com',
        'Original Owner',
        'client',
        'active'
      );
    `);

    const before = sqlite
      .prepare("SELECT total_changes() AS count")
      .get().count;

    const request = new Request("https://test.local/register", {
      headers: {
        Authorization: "Bearer test:firebase-different-user:client",
      },
    });

    await assert.rejects(
      () => ensureClientAccount(
        db,
        "main",
        {
          FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
          PACKAGES_AUTH_TEST_MODE: "true",
        },
        request,
        {
          name: "Different User",
          email: "existing@example.com",
        }
      ),
      (error) => {
        assert.ok(
          [403, 409].includes(error.status),
          "An unverified email must not authorize account takeover"
        );
        return true;
      }
    );

    const account = sqlite.prepare(
      "SELECT firebase_uid FROM app_users WHERE id = ?"
    ).get("existing-account");

    assert.equal(
      account.firebase_uid,
      "firebase-original-owner",
      "The existing Firebase identity must remain unchanged"
    );

    const after = sqlite
      .prepare("SELECT total_changes() AS count")
      .get().count;

    assert.equal(
      after,
      before,
      "Rejected registration must not change account records"
    );
  } finally {
    sqlite.close();
  }
});
test("repeated registration reuses the same account and client profile", async () => {
  const { sqlite, db } = createFixture();

  try {
    const uid = "firebase-repeat-registration";

    const request = new Request("https://test.local/register", {
      headers: {
        Authorization: `Bearer test:${uid}:client`,
      },
    });

    const env = {
      FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
      PACKAGES_AUTH_TEST_MODE: "true",
    };

    const registration = {
      name: "Existing Client",
      phone: "0500000007",
    };

    const first = await ensureClientAccount(
      db,
      "main",
      env,
      request,
      registration
    );

    const second = await ensureClientAccount(
      db,
      "main",
      env,
      request,
      registration
    );

    assert.equal(
      first.user.id,
      second.user.id,
      "Repeated registration must reuse the Core account"
    );

    assert.equal(
      first.client.id,
      second.client.id,
      "Repeated registration must reuse the client profile"
    );

    const accounts = sqlite.prepare(
      "SELECT id, firebase_uid FROM app_users"
    ).all();

    const clients = sqlite.prepare(
      "SELECT id, firebase_uid FROM clients"
    ).all();

    assert.equal(accounts.length, 1);
    assert.equal(clients.length, 1);

    assert.equal(accounts[0].firebase_uid, uid);
    assert.equal(clients[0].firebase_uid, uid);

    const aliases = sqlite.prepare(
      "SELECT * FROM client_aliases WHERE alias_id = ?"
    ).all(uid);

    assert.equal(aliases.length, 1);
    assert.equal(aliases[0].canonical_client_id, clients[0].id);
  } finally {
    sqlite.close();
  }
});
test("existing Firebase client must survive a separate legacy phone record", async () => {
  const { sqlite, db } = createFixture();

  try {
    const uid = "firebase-existing-owner";

    const request = new Request("https://test.local/register", {
      headers: {
        Authorization: `Bearer test:${uid}:client`,
      },
    });

    const env = {
      FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
      PACKAGES_AUTH_TEST_MODE: "true",
    };

    // First, establish a legitimate, already-linked client account.
    const original = await ensureClientAccount(
      db,
      "main",
      env,
      request,
      { name: "Existing Owner" }
    );

    // A separate legacy profile holds the owner's phone.
    sqlite.exec(`
      INSERT INTO clients
        (id, salon_id, name, phone_normalized)
      VALUES
        ('legacy-phone-record', 'main', 'Legacy Record', '0500000008');
    `);

    // Re-registering the established Firebase identity must not
    // take ownership of or merge the legacy client automatically.
    const result = await ensureClientAccount(
      db,
      "main",
      env,
      request,
      {
        name: "Existing Owner",
        phone: "0500000008",
      }
    );

    assert.equal(result.user.id, original.user.id);
    assert.equal(result.client.id, original.client.id);

    const legacy = sqlite.prepare(
      "SELECT firebase_uid FROM clients WHERE id = ?"
    ).get("legacy-phone-record");

    assert.equal(legacy.firebase_uid, null);

    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM app_users").get().count,
      1
    );

    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM clients").get().count,
      2
    );
  } finally {
    sqlite.close();
  }
});
test("established account must reject duplicate Firebase client identities", async () => {
  const { sqlite, db } = createFixture();

  try {
    const uid = "firebase-duplicate-identity";

    const request = new Request("https://test.local/register", {
      headers: {
        Authorization: `Bearer test:${uid}:client`,
      },
    });

    const env = {
      FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
      PACKAGES_AUTH_TEST_MODE: "true",
    };

    await ensureClientAccount(
      db,
      "main",
      env,
      request,
      { name: "Existing Owner" }
    );

    sqlite.prepare(`
      INSERT INTO clients
        (id, salon_id, name, firebase_uid)
      VALUES (?, ?, ?, ?)
    `).run(
      "duplicate-firebase-client",
      "main",
      "Duplicate Identity",
      uid
    );

    sqlite.prepare(`
      INSERT INTO clients
        (id, salon_id, name, phone_normalized)
      VALUES (?, ?, ?, ?)
    `).run(
      "separate-legacy-phone",
      "main",
      "Legacy Phone",
      "0500000009"
    );

    const before = sqlite.prepare(
      "SELECT total_changes() AS count"
    ).get().count;

    await assert.rejects(
      () => ensureClientAccount(
        db,
        "main",
        env,
        request,
        {
          name: "Existing Owner",
          phone: "0500000009",
        }
      ),
      (error) => {
        assert.equal(error.status, 409);
        return true;
      }
    );

    const after = sqlite.prepare(
      "SELECT total_changes() AS count"
    ).get().count;

    assert.equal(after, before);
  } finally {
    sqlite.close();
  }
});