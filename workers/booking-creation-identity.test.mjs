import assert from "node:assert/strict";
import test from "node:test";

import {
  newBookingCreationIntent,
  getOrCreateBookingIdentity,
  clearConfirmedBookingIdentity
} from "../src/services/bookingCreationIdentity.ts";

function memoryStorage(initial = []) {
  const values = new Map(initial);

  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

function scope(overrides = {}) {
  return {
    salonId: "main",
    actorUid: "client-a",
    channel: "client",
    intentId: "intent-a",
    ...overrides
  };
}

test("same booking intent always restores the original identity", () => {
  const storage = memoryStorage();

  const first = getOrCreateBookingIdentity(scope(), storage);

  for (let i = 0; i < 20; i++) {
    assert.equal(
      getOrCreateBookingIdentity(scope(), storage),
      first
    );
  }

  assert.equal(storage.values.size, 1);
});

test("page reload preserves the identity of an unresolved booking", () => {
  const initial = memoryStorage();

  const first = getOrCreateBookingIdentity(scope(), initial);

  const restored = memoryStorage(initial.values.entries());

  assert.equal(
    getOrCreateBookingIdentity(scope(), restored),
    first
  );
});

test("an explicitly new booking intent receives a distinct identity", () => {
  const storage = memoryStorage();

  const first = getOrCreateBookingIdentity(scope(), storage);

  const second = getOrCreateBookingIdentity(
    scope({ intentId: newBookingCreationIntent() }),
    storage
  );

  assert.notEqual(first, second);
});

test("booking identity is isolated between tenants", () => {
  const storage = memoryStorage();

  assert.notEqual(
    getOrCreateBookingIdentity(scope(), storage),
    getOrCreateBookingIdentity(
      scope({ salonId: "other" }),
      storage
    )
  );
});

test("booking identity is isolated between actors", () => {
  const storage = memoryStorage();

  assert.notEqual(
    getOrCreateBookingIdentity(scope(), storage),
    getOrCreateBookingIdentity(
      scope({ actorUid: "client-b" }),
      storage
    )
  );
});

test("internal and client operations cannot share an identity", () => {
  const storage = memoryStorage();

  assert.notEqual(
    getOrCreateBookingIdentity(scope(), storage),
    getOrCreateBookingIdentity(
      scope({ channel: "internal" }),
      storage
    )
  );
});

test("missing actor tenant or intent fails closed", () => {
  const storage = memoryStorage();

  for (const invalid of [
    { actorUid: "" },
    { salonId: "" },
    { intentId: "" },
    { channel: "unknown" }
  ]) {
    assert.throws(() =>
      getOrCreateBookingIdentity(scope(invalid), storage)
    );
  }

  assert.equal(storage.values.size, 0);
});

test("storage failure prevents allocation of an untracked identity", () => {
  const storage = memoryStorage();

  storage.setItem = () => {
    throw new Error("storage unavailable");
  };

  assert.throws(() =>
    getOrCreateBookingIdentity(scope(), storage)
  );

  assert.equal(storage.values.size, 0);
});

test("silent storage failure is detected before submission", () => {
  const storage = memoryStorage();

  storage.setItem = () => {};

  assert.throws(
    () => getOrCreateBookingIdentity(scope(), storage),
    /core_booking:identity_persistence_failed/
  );
});

test("corrupted stored identity cannot generate a silent replacement", () => {
  const storage = memoryStorage();

  getOrCreateBookingIdentity(scope(), storage);

  const [key] = storage.values.keys();

  storage.values.set(key, "invalid/identity");

  assert.throws(
    () => getOrCreateBookingIdentity(scope(), storage),
    /core_booking:stored_identity_invalid/
  );

  assert.equal(storage.values.get(key), "invalid/identity");
});

test("unconfirmed identities survive failed or unrelated confirmations", () => {
  const storage = memoryStorage();

  const first = getOrCreateBookingIdentity(scope(), storage);

  assert.equal(
    clearConfirmedBookingIdentity(
      scope(),
      "another-booking",
      storage
    ),
    false
  );

  assert.equal(
    getOrCreateBookingIdentity(scope(), storage),
    first
  );
});

test("confirmed operation clears only its own stored identity", () => {
  const storage = memoryStorage();

  const first = getOrCreateBookingIdentity(scope(), storage);

  const otherScope = scope({ intentId: "intent-b" });

  const other = getOrCreateBookingIdentity(otherScope, storage);

  assert.equal(
    clearConfirmedBookingIdentity(scope(), first, storage),
    true
  );

  assert.equal(storage.values.size, 1);

  assert.equal(
    getOrCreateBookingIdentity(otherScope, storage),
    other
  );
});

test("creation storage contains identity metadata rather than booking payloads", () => {
  const storage = memoryStorage();

  const id = getOrCreateBookingIdentity(scope(), storage);

  assert.deepEqual(
    Array.from(storage.values.values()),
    [id]
  );

  assert.match(
    id,
    /^[A-Za-z0-9_-]{1,128}$/
  );
});

test("explicit booking identity is preserved without allocating another ID", async () => {
  const { resolveBookingCreationIdentity } = await import(
    "../src/services/bookingCreationIdentity.ts"
  );

  const storage = memoryStorage();

  assert.equal(
    resolveBookingCreationIdentity({ id: "booking-a" }, storage),
    "booking-a"
  );

  assert.equal(storage.values.size, 0);
});

test("data source identity contract restores the persisted booking operation", async () => {
  const { resolveBookingCreationIdentity } = await import(
    "../src/services/bookingCreationIdentity.ts"
  );

  const storage = memoryStorage();

  const first = resolveBookingCreationIdentity({
    creationScope: scope()
  }, storage);

  const second = resolveBookingCreationIdentity({
    creationScope: scope()
  }, storage);

  assert.equal(first, second);

  assert.equal(
    resolveBookingCreationIdentity({
      id: first,
      creationScope: scope()
    }, storage),
    first
  );
});

test("explicit and persisted identities must agree", async () => {
  const { resolveBookingCreationIdentity } = await import(
    "../src/services/bookingCreationIdentity.ts"
  );

  const storage = memoryStorage();

  const persisted = getOrCreateBookingIdentity(scope(), storage);

  assert.throws(
    () => resolveBookingCreationIdentity({
      id: "conflicting-id",
      creationScope: scope()
    }, storage),
    /core_booking:creation_identity_conflict/
  );

  assert.equal(
    getOrCreateBookingIdentity(scope(), storage),
    persisted
  );
});

test("invalid explicit identity never falls back to a random booking", async () => {
  const { resolveBookingCreationIdentity } = await import(
    "../src/services/bookingCreationIdentity.ts"
  );

  const storage = memoryStorage();

  for (const invalid of ["", " ", "a/b", "x".repeat(129)]) {
    assert.throws(
      () => resolveBookingCreationIdentity({
        id: invalid,
        creationScope: scope()
      }, storage),
      /core_booking:invalid_creation_identity/
    );
  }

  assert.equal(storage.values.size, 0);
});

test("strict identity resolver rejects absent operation identity", async () => {
  const { resolveBookingCreationIdentity } = await import(
    "../src/services/bookingCreationIdentity.ts"
  );

  const storage = memoryStorage();

  assert.throws(
    () => resolveBookingCreationIdentity({}, storage),
    /core_booking:stable_creation_identity_required/
  );

  assert.equal(storage.values.size, 0);
});

test("active checkout intent survives a page reload with its original booking identity", async () => {
  const {
    getOrCreateActiveBookingIntent,
    getOrCreateBookingIdentity
  } = await import("../src/services/bookingCreationIdentity.ts");

  const initial = memoryStorage();

  const owner = {
    salonId: "main",
    actorUid: "client-a",
    channel: "client"
  };

  const first = getOrCreateActiveBookingIntent(
    owner, "checkout", initial
  );

  const bookingId = getOrCreateBookingIdentity(first, initial);

  const restored = memoryStorage(initial.values.entries());

  const replay = getOrCreateActiveBookingIntent(
    owner, "checkout", restored
  );

  assert.equal(replay.intentId, first.intentId);

  assert.equal(
    getOrCreateBookingIdentity(replay, restored),
    bookingId
  );
});

test("active booking intents are isolated by booking flow and actor", async () => {
  const {
    getOrCreateActiveBookingIntent
  } = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  const owner = {
    salonId: "main",
    actorUid: "client-a",
    channel: "client"
  };

  const identities = [
    getOrCreateActiveBookingIntent(owner, "checkout", storage),
    getOrCreateActiveBookingIntent(owner, "booking", storage),
    getOrCreateActiveBookingIntent({
      ...owner,
      actorUid: "client-b"
    }, "checkout", storage),
    getOrCreateActiveBookingIntent({
      ...owner,
      salonId: "other"
    }, "checkout", storage)
  ].map(row => row.intentId);

  assert.equal(new Set(identities).size, 4);
});

test("unconfirmed checkout cannot silently rotate its intent", async () => {
  const {
    getOrCreateActiveBookingIntent,
    getOrCreateBookingIdentity,
    finishActiveBookingIntent
  } = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  const owner = {
    salonId: "main",
    actorUid: "client-a",
    channel: "client"
  };

  const original = getOrCreateActiveBookingIntent(
    owner, "checkout", storage
  );

  const bookingId = getOrCreateBookingIdentity(original, storage);

  assert.equal(
    finishActiveBookingIntent(
      original,
      "checkout",
      "different-booking",
      storage
    ),
    false
  );

  const replay = getOrCreateActiveBookingIntent(
    owner, "checkout", storage
  );

  assert.equal(replay.intentId, original.intentId);

  assert.equal(
    getOrCreateBookingIdentity(replay, storage),
    bookingId
  );
});

test("confirmed checkout permits a distinct subsequent booking intent", async () => {
  const {
    getOrCreateActiveBookingIntent,
    getOrCreateBookingIdentity,
    finishActiveBookingIntent
  } = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  const owner = {
    salonId: "main",
    actorUid: "client-a",
    channel: "client"
  };

  const original = getOrCreateActiveBookingIntent(
    owner, "checkout", storage
  );

  const bookingId = getOrCreateBookingIdentity(original, storage);

  assert.equal(
    finishActiveBookingIntent(
      original, "checkout", bookingId, storage
    ),
    true
  );

  const next = getOrCreateActiveBookingIntent(
    owner, "checkout", storage
  );

  assert.notEqual(next.intentId, original.intentId);

  assert.notEqual(
    getOrCreateBookingIdentity(next, storage),
    bookingId
  );

  assert.equal(
    finishActiveBookingIntent(
      original, "checkout", bookingId, storage
    ),
    false
  );
});

test("corrupt active checkout intent fails closed", async () => {
  const {
    getOrCreateActiveBookingIntent
  } = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  const owner = {
    salonId: "main",
    actorUid: "client-a",
    channel: "client"
  };

  getOrCreateActiveBookingIntent(owner, "checkout", storage);

  const [key] = storage.values.keys();

  storage.values.set(key, "invalid/intent");

  assert.throws(
    () => getOrCreateActiveBookingIntent(
      owner, "checkout", storage
    ),
    /core_booking:stored_intent_invalid/
  );
});

test("public booking children retain distinct identities within the same intent", async () => {
  const {
    getOrCreateActiveBookingIntent,
    getBookingChildCreationIdentity
  } = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  const owner = {
    salonId: "main",
    actorUid: "client-a",
    channel: "client"
  };

  const intent = getOrCreateActiveBookingIntent(
    owner,
    "public-booking",
    storage
  );

  const keys = [
    "sequence:cart-a",
    "package:run-a",
    "service:cart-a",
    "service:cart-b"
  ];

  const ids = keys.map(key =>
    getBookingChildCreationIdentity(intent, key, storage)
  );

  assert.equal(new Set(ids).size, keys.length);

  for (let i = 0; i < keys.length; i++) {
    assert.equal(
      getBookingChildCreationIdentity(intent, keys[i], storage),
      ids[i]
    );
  }
});

test("partial public booking retry preserves every allocated child identity", async () => {
  const {
    getOrCreateActiveBookingIntent,
    getBookingChildCreationIdentity
  } = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  const owner = {
    salonId: "main",
    actorUid: "client-a",
    channel: "client"
  };

  const first = getOrCreateActiveBookingIntent(
    owner,
    "public-booking",
    storage
  );

  const firstId = getBookingChildCreationIdentity(
    first,
    "service:cart-a",
    storage
  );

  const secondId = getBookingChildCreationIdentity(
    first,
    "package:run-b",
    storage
  );

  const restored = memoryStorage(storage.values.entries());

  const retry = getOrCreateActiveBookingIntent(
    owner,
    "public-booking",
    restored
  );

  assert.equal(first.intentId, retry.intentId);

  assert.equal(
    getBookingChildCreationIdentity(
      retry,
      "service:cart-a",
      restored
    ),
    firstId
  );

  assert.equal(
    getBookingChildCreationIdentity(
      retry,
      "package:run-b",
      restored
    ),
    secondId
  );
});

test("booking child identities do not leak across actors or tenants", async () => {
  const {
    getBookingChildCreationIdentity
  } = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  const key = "service:cart-a";

  const ids = [
    scope(),
    scope({ actorUid: "client-b" }),
    scope({ salonId: "other" }),
    scope({ channel: "internal" }),
    scope({ intentId: "another-intent" })
  ].map(value =>
    getBookingChildCreationIdentity(value, key, storage)
  );

  assert.equal(new Set(ids).size, ids.length);
});

test("different public booking intents do not reuse child identities", async () => {
  const {
    getBookingChildCreationIdentity
  } = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  assert.notEqual(
    getBookingChildCreationIdentity(
      scope(),
      "service:cart-a",
      storage
    ),
    getBookingChildCreationIdentity(
      scope({ intentId: "another-intent" }),
      "service:cart-a",
      storage
    )
  );
});

test("empty child identity key fails closed", async () => {
  const {
    getBookingChildCreationIdentity
  } = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  assert.throws(
    () => getBookingChildCreationIdentity(scope(), "", storage),
    /core_booking:invalid_creation_scope/
  );

  assert.equal(storage.values.size, 0);
});

test("internal party identities survive reload and preserve operator isolation", async () => {
  const {
    getOrCreateActiveBookingIntent,
    getBookingChildCreationIdentity
  } = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  const owner = {
    salonId: "main",
    actorUid: "staff-a",
    channel: "internal"
  };

  const first = getOrCreateActiveBookingIntent(
    owner, "internal-booking-v2", storage
  );

  const keys = [
    "party",
    "member:client-a",
    "member:client-b"
  ];

  const ids = keys.map(key =>
    getBookingChildCreationIdentity(first, key, storage)
  );

  assert.equal(new Set(ids).size, 3);

  const restored = memoryStorage(storage.values.entries());

  const retry = getOrCreateActiveBookingIntent(
    owner, "internal-booking-v2", restored
  );

  assert.equal(retry.intentId, first.intentId);

  for (let i = keys.length - 1; i >= 0; i--) {
    assert.equal(
      getBookingChildCreationIdentity(retry, keys[i], restored),
      ids[i]
    );
  }

  const anotherOperator = getOrCreateActiveBookingIntent({
    ...owner,
    actorUid: "staff-b"
  }, "internal-booking-v2", storage);

  assert.notEqual(
    getBookingChildCreationIdentity(
      anotherOperator, "member:client-a", storage
    ),
    ids[1]
  );
});

test("internal booking imports the shared salon identity", async () => {
  const { readFileSync } = await import("node:fs");

  const source = readFileSync(
    "src/features/internal-booking-v2/BookingInternalV2.tsx",
    "utf8"
  );

  assert.match(
    source,
    /import \{ SALON_ID \} from "\.\.\/\.\.\/helpers\/bookingSharedConstants"/
  );

  assert.match(source, /salonId: SALON_ID/);
});

test("internal booking persists party and member identities before submission", async () => {
  const { readFileSync } = await import("node:fs");

  const source = readFileSync(
    "src/features/internal-booking-v2/BookingInternalV2.tsx",
    "utf8"
  );

  assert.match(
    source,
    /getBookingPartyIdentity\(internalCreationScope\)/
  );

  assert.match(
    source,
    /parent\.id = memberCreationId;\s*const created = await bookingDataSource\.createBookingGroup\(\{ parent, items: itemRows \}\)/
  );

  assert.match(source, /bookingId !== memberCreationId/);
});

test("internal creation fails closed without verified actor or party member identity", async () => {
  const { readFileSync } = await import("node:fs");

  const source = readFileSync(
    "src/features/internal-booking-v2/BookingInternalV2.tsx",
    "utf8"
  );

  assert.match(source, /core_booking:verified_actor_required/);
  assert.match(source, /core_booking:invalid_party_member_identity/);

  assert.ok(
    !source.includes('authUser?.uid || "internal_staff"')
  );
});

async function manifestFixture() {
  const api = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  const owner = {
    salonId: "main",
    actorUid: "staff-a",
    channel: "internal"
  };

  const flow = "internal-booking-v2";

  const intent = api.getOrCreateActiveBookingIntent(
    owner,
    flow,
    storage
  );

  const keys = ["member:a", "member:b"];

  const children = api.registerBookingIntentManifest(
    intent,
    flow,
    keys,
    storage
  );

  return { api, storage, owner, flow, intent, keys, children };
}

test("booking intent manifest survives reload and processing order changes", async () => {
  const f = await manifestFixture();

  const restored = memoryStorage(f.storage.values.entries());

  const next = f.api.getOrCreateActiveBookingIntent(
    f.owner,
    f.flow,
    restored
  );

  assert.equal(next.intentId, f.intent.intentId);

  assert.deepEqual(
    f.api.registerBookingIntentManifest(
      next,
      f.flow,
      [...f.keys].reverse(),
      restored
    ),
    f.children
  );
});

test("pending manifest cannot silently add remove or replace booking members", async () => {
  const f = await manifestFixture();

  for (const keys of [
    ["member:a"],
    ["member:a", "member:b", "member:c"],
    ["member:a", "member:c"]
  ]) {
    assert.throws(
      () => f.api.registerBookingIntentManifest(
        f.intent, f.flow, keys, f.storage
      ),
      /core_booking:intent_manifest_conflict/
    );
  }

  assert.deepEqual(
    f.api.registerBookingIntentManifest(
      f.intent, f.flow, f.keys, f.storage
    ),
    f.children
  );
});

test("partial booking confirmation cannot close an active intent", async () => {
  const f = await manifestFixture();

  assert.equal(
    f.api.finishBookingIntentManifest(
      f.intent,
      f.flow,
      [f.children["member:a"]],
      f.storage
    ),
    false
  );

  assert.equal(
    f.api.getOrCreateActiveBookingIntent(
      f.owner, f.flow, f.storage
    ).intentId,
    f.intent.intentId
  );
});

test("foreign duplicate or additional confirmations cannot close an intent", async () => {
  const f = await manifestFixture();

  const ids = Object.values(f.children);

  for (const confirmed of [
    [ids[0], "foreign-booking"],
    [ids[0], ids[0]],
    [...ids, "extra-booking"],
    []
  ]) {
    assert.equal(
      f.api.finishBookingIntentManifest(
        f.intent, f.flow, confirmed, f.storage
      ),
      false
    );
  }
});

test("complete manifest confirmation allows a new legitimate booking", async () => {
  const f = await manifestFixture();

  const ids = Object.values(f.children);

  assert.equal(
    f.api.finishBookingIntentManifest(
      f.intent, f.flow, [...ids].reverse(), f.storage
    ),
    true
  );

  const next = f.api.getOrCreateActiveBookingIntent(
    f.owner, f.flow, f.storage
  );

  assert.notEqual(next.intentId, f.intent.intentId);

  const nextChildren = f.api.registerBookingIntentManifest(
    next, f.flow, f.keys, f.storage
  );

  for (const id of Object.values(nextChildren)) {
    assert.ok(!ids.includes(id));
  }

  assert.equal(
    f.api.finishBookingIntentManifest(
      f.intent, f.flow, ids, f.storage
    ),
    false
  );
});

test("completed manifest retains historical identity evidence", async () => {
  const f = await manifestFixture();

  assert.equal(
    f.api.finishBookingIntentManifest(
      f.intent,
      f.flow,
      Object.values(f.children),
      f.storage
    ),
    true
  );

  for (const [key, id] of Object.entries(f.children)) {
    assert.equal(
      f.api.getBookingChildCreationIdentity(
        f.intent, key, f.storage
      ),
      id
    );
  }

  assert.ok(
    Array.from(f.storage.values.keys())
      .some(key => key.endsWith(":manifest"))
  );
});

test("empty or duplicate manifest children fail closed", async () => {
  const f = await manifestFixture();

  for (const keys of [
    [],
    ["member:a", "member:a"],
    ["member:a", " member:a "],
    [""]
  ]) {
    assert.throws(
      () => f.api.registerBookingIntentManifest(
        f.intent, f.flow, keys, f.storage
      )
    );
  }
});

test("manifest corruption cannot rotate the pending operation", async () => {
  const f = await manifestFixture();

  const key = Array.from(f.storage.values.keys())
    .find(key => key.endsWith(":manifest"));

  f.storage.values.set(key, "{invalid-json");

  assert.throws(
    () => f.api.registerBookingIntentManifest(
      f.intent, f.flow, f.keys, f.storage
    ),
    /core_booking:invalid_stored_manifest/
  );

  assert.throws(
    () => f.api.finishBookingIntentManifest(
      f.intent, f.flow, Object.values(f.children), f.storage
    ),
    /core_booking:invalid_stored_manifest/
  );

  assert.equal(
    f.api.getOrCreateActiveBookingIntent(
      f.owner, f.flow, f.storage
    ).intentId,
    f.intent.intentId
  );
});

test("missing child evidence cannot silently recreate a manifest identity", async () => {
  const f = await manifestFixture();

  const target = f.children["member:a"];

  const childKey = Array.from(f.storage.values.entries())
    .find(([, value]) => value === target)[0];

  f.storage.values.delete(childKey);

  assert.throws(
    () => f.api.registerBookingIntentManifest(
      f.intent, f.flow, f.keys, f.storage
    ),
    /core_booking:manifest_identity_mismatch/
  );

  assert.throws(
    () => f.api.finishBookingIntentManifest(
      f.intent, f.flow, Object.values(f.children), f.storage
    ),
    /core_booking:manifest_identity_mismatch/
  );
});

test("inactive intent cannot register a replacement manifest", async () => {
  const f = await manifestFixture();

  assert.equal(
    f.api.finishBookingIntentManifest(
      f.intent, f.flow, Object.values(f.children), f.storage
    ),
    true
  );

  assert.throws(
    () => f.api.registerBookingIntentManifest(
      f.intent, f.flow, f.keys, f.storage
    ),
    /core_booking:inactive_creation_intent/
  );
});

test("booking creation alone cannot close an intent with unknown settlement", async () => {
  const f = await manifestFixture();

  const evidence = Object.values(f.children).map(bookingId => ({
    bookingId,
    bookingConfirmed: true,
    settlement: "unknown"
  }));

  assert.equal(
    f.api.finishVerifiedBookingIntent(
      f.intent, f.flow, evidence, f.storage
    ),
    false
  );

  assert.equal(
    f.api.getOrCreateActiveBookingIntent(
      f.owner, f.flow, f.storage
    ).intentId,
    f.intent.intentId
  );
});

test("failed settlement preserves the active booking operation", async () => {
  const f = await manifestFixture();

  const evidence = Object.values(f.children).map(bookingId => ({
    bookingId,
    bookingConfirmed: true,
    settlement: "confirmed"
  }));

  evidence[1].settlement = "failed";

  assert.equal(
    f.api.finishVerifiedBookingIntent(
      f.intent, f.flow, evidence, f.storage
    ),
    false
  );
});

test("unconfirmed bookings cannot close an otherwise settled manifest", async () => {
  const f = await manifestFixture();

  const evidence = Object.values(f.children).map(bookingId => ({
    bookingId,
    bookingConfirmed: true,
    settlement: "confirmed"
  }));

  evidence[0].bookingConfirmed = false;

  assert.equal(
    f.api.finishVerifiedBookingIntent(
      f.intent, f.flow, evidence, f.storage
    ),
    false
  );
});

test("confirmed payments and explicitly unpaid bookings can close together", async () => {
  const f = await manifestFixture();

  const ids = Object.values(f.children);

  const evidence = [
    {
      bookingId: ids[0],
      bookingConfirmed: true,
      settlement: "confirmed"
    },
    {
      bookingId: ids[1],
      bookingConfirmed: true,
      settlement: "not_required"
    }
  ];

  assert.equal(
    f.api.finishVerifiedBookingIntent(
      f.intent, f.flow, evidence, f.storage
    ),
    true
  );

  const next = f.api.getOrCreateActiveBookingIntent(
    f.owner, f.flow, f.storage
  );

  assert.notEqual(next.intentId, f.intent.intentId);
});

test("foreign duplicate and malformed settlement evidence fails closed", async () => {
  const f = await manifestFixture();

  const ids = Object.values(f.children);

  const valid = ids.map(bookingId => ({
    bookingId,
    bookingConfirmed: true,
    settlement: "confirmed"
  }));

  for (const evidence of [
    [valid[0], valid[0]],
    [valid[0], {
      ...valid[1],
      bookingId: "foreign-booking"
    }],
    [valid[0], {
      ...valid[1],
      settlement: "pending"
    }],
    [valid[0], null],
    [valid[0]]
  ]) {
    assert.equal(
      f.api.finishVerifiedBookingIntent(
        f.intent, f.flow, evidence, f.storage
      ),
      false
    );
  }
});

test("lost response and partial party retry retain the original booking identities", async () => {
  const f = await manifestFixture();

  // Synthetic transport fixture, not a real Worker or D1 database.
  const committed = new Map();
  let writes = 0;

  async function create(id, loseResponse = false) {
    if (!committed.has(id)) {
      committed.set(id, {
        bookingId: id,
        bookingConfirmed: true,
        settlement: "not_required"
      });

      writes++;
    }

    if (loseResponse) {
      throw new Error("write_outcome_unknown");
    }

    return committed.get(id);
  }

  const ids = Object.values(f.children);

  await assert.rejects(
    create(ids[0], true),
    /write_outcome_unknown/
  );

  assert.equal(writes, 1);

  assert.equal(
    f.api.finishVerifiedBookingIntent(
      f.intent, f.flow, [], f.storage
    ),
    false
  );

  const restored = memoryStorage(f.storage.values.entries());

  const resumed = f.api.getOrCreateActiveBookingIntent(
    f.owner, f.flow, restored
  );

  const resumedManifest = f.api.registerBookingIntentManifest(
    resumed, f.flow, f.keys, restored
  );

  assert.deepEqual(resumedManifest, f.children);

  const evidence = [];

  for (const id of Object.values(resumedManifest)) {
    evidence.push(await create(id));
  }

  assert.equal(writes, 2);
  assert.equal(committed.size, 2);

  assert.equal(
    f.api.finishVerifiedBookingIntent(
      resumed, f.flow, evidence, restored
    ),
    true
  );

  const next = f.api.getOrCreateActiveBookingIntent(
    f.owner, f.flow, restored
  );

  assert.notEqual(next.intentId, resumed.intentId);

  const fresh = f.api.registerBookingIntentManifest(
    next, f.flow, f.keys, restored
  );

  for (const id of Object.values(fresh)) {
    assert.ok(!ids.includes(id));
  }
});

test("settlement evidence cannot close a newer active booking intent", async () => {
  const f = await manifestFixture();

  const evidence = Object.values(f.children).map(bookingId => ({
    bookingId,
    bookingConfirmed: true,
    settlement: "confirmed"
  }));

  assert.equal(
    f.api.finishVerifiedBookingIntent(
      f.intent, f.flow, evidence, f.storage
    ),
    true
  );

  const next = f.api.getOrCreateActiveBookingIntent(
    f.owner, f.flow, f.storage
  );

  f.api.registerBookingIntentManifest(
    next, f.flow, f.keys, f.storage
  );

  assert.equal(
    f.api.finishVerifiedBookingIntent(
      f.intent, f.flow, evidence, f.storage
    ),
    false
  );

  assert.equal(
    f.api.finishVerifiedBookingIntent(
      next, f.flow, evidence, f.storage
    ),
    false
  );
});

test("registered manifest child cannot regenerate a lost identity", async () => {
  const f = await manifestFixture();

  const expected = f.children["member:a"];

  const entry = [...f.storage.values.entries()]
    .find(([, value]) => value === expected);

  assert.ok(entry);

  f.storage.values.delete(entry[0]);

  assert.throws(
    () => f.api.getBookingChildCreationIdentity(
      f.intent,
      "member:a",
      f.storage
    ),
    /core_booking:manifest_identity_mismatch/
  );

  assert.equal(f.storage.values.has(entry[0]), false);
});

test("registered manifest child rejects replaced identity evidence", async () => {
  const f = await manifestFixture();

  const expected = f.children["member:a"];

  const entry = [...f.storage.values.entries()]
    .find(([, value]) => value === expected);

  assert.ok(entry);

  f.storage.values.set(entry[0], "different-valid-id");

  assert.throws(
    () => f.api.getBookingChildCreationIdentity(
      f.intent,
      "member:a",
      f.storage
    ),
    /core_booking:manifest_identity_mismatch/
  );

  assert.equal(
    f.storage.values.get(entry[0]),
    "different-valid-id"
  );
});

test("registered manifest rejects allocation of an additional child", async () => {
  const f = await manifestFixture();

  const originalSize = f.storage.values.size;

  assert.throws(
    () => f.api.getBookingChildCreationIdentity(
      f.intent,
      "member:c",
      f.storage
    ),
    /core_booking:intent_manifest_conflict/
  );

  assert.equal(f.storage.values.size, originalSize);
});

test("manifest child recovery never accepts inherited object properties", async () => {
  const f = await manifestFixture();

  for (const key of [
    "__proto__",
    "constructor",
    "toString"
  ]) {
    assert.throws(
      () => f.api.getBookingChildCreationIdentity(
        f.intent,
        key,
        f.storage
      ),
      /core_booking:intent_manifest_conflict/
    );
  }
});

test("registered child identities remain immutable across successful completion", async () => {
  const f = await manifestFixture();

  const evidence = Object.values(f.children).map(bookingId => ({
    bookingId,
    bookingConfirmed: true,
    settlement: "not_required"
  }));

  assert.equal(
    f.api.finishVerifiedBookingIntent(
      f.intent,
      f.flow,
      evidence,
      f.storage
    ),
    true
  );

  for (const [key, id] of Object.entries(f.children)) {
    assert.equal(
      f.api.getBookingChildCreationIdentity(
        f.intent,
        key,
        f.storage
      ),
      id
    );
  }

  assert.throws(
    () => f.api.getBookingChildCreationIdentity(
      f.intent,
      "member:new",
      f.storage
    ),
    /core_booking:intent_manifest_conflict/
  );
});

test("internal booking timestamp survives repeated attempts and reload", async () => {
  const api = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();
  const intent = scope({ channel: "internal" });

  const first = api.getBookingIntentTimestamp(intent, storage);

  assert.equal(
    api.getBookingIntentTimestamp(intent, storage),
    first
  );

  const restored = memoryStorage(storage.values.entries());

  assert.equal(
    api.getBookingIntentTimestamp(intent, restored),
    first
  );

  assert.equal(new Date(first).toISOString(), first);
});

test("invalid persisted booking timestamp fails closed", async () => {
  const api = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();
  const intent = scope({ channel: "internal" });

  api.getBookingIntentTimestamp(intent, storage);

  const key = [...storage.values.keys()]
    .find(key => key.endsWith(":timestamp"));

  storage.values.set(key, "invalid-date");

  assert.throws(
    () => api.getBookingIntentTimestamp(intent, storage),
    /core_booking:invalid_intent_timestamp/
  );

  assert.equal(storage.values.get(key), "invalid-date");
});

test("registered booking manifest cannot replace a missing timestamp", async () => {
  const f = await manifestFixture();

  assert.throws(
    () => f.api.getBookingIntentTimestamp(
      f.intent,
      f.storage
    ),
    /core_booking:missing_intent_timestamp/
  );
});

test("booking timestamp must be persisted before being used", async () => {
  const api = await import("../src/services/bookingCreationIdentity.ts");

  const storage = memoryStorage();

  storage.setItem = () => {};

  assert.throws(
    () => api.getBookingIntentTimestamp(scope(), storage),
    /core_booking:timestamp_persistence_failed/
  );
});

test("internal booking uses stable timestamps for booking and payment submission", async () => {
  const { readFileSync } = await import("node:fs");

  const source = readFileSync(
    "src/features/internal-booking-v2/BookingInternalV2.tsx",
    "utf8"
  );

  assert.match(
    source,
    /getBookingIntentTimestamp\(internalCreationScope\)/
  );

  assert.match(source, /paidAt: creationTimestampMs/);
  assert.match(source, /paidAt: creationTimestamp,/);
});

test("internal booking registers the expected member manifest before creation", async () => {
  const { readFileSync } = await import("node:fs");

  const source = readFileSync(
    "src/features/internal-booking-v2/BookingInternalV2.tsx",
    "utf8"
  );

  const register = source.indexOf(
    "registerBookingIntentManifest("
  );

  const create = source.indexOf(
    "const created = await bookingDataSource.createBookingGroup"
  );

  assert.ok(register >= 0);
  assert.ok(create > register);

  assert.match(source, /memberPlans\.map/);
});

test("internal booking retains draft when financial posting or completion fails", async () => {
  const { readFileSync } = await import("node:fs");

  const source = readFileSync(
    "src/features/internal-booking-v2/BookingInternalV2.tsx",
    "utf8"
  );

  assert.match(
    source,
    /financialPostingSucceeded &&\s*bookingCompletionSucceeded &&\s*finishVerifiedBookingIntent/
  );

  assert.match(
    source,
    /catch \(completionError\) \{\s*bookingCompletionSucceeded = false/
  );

  assert.match(
    source,
    /if \(bookingIntentCompleted && activeDraftId\)/
  );
});
test("party metadata identity survives a member-only manifest without becoming a booking child", async () => {
  const api = await import("../src/services/bookingCreationIdentity.ts");
  const storage = memoryStorage();
  const owner = { salonId: "main", actorUid: "staff-a", channel: "internal" };
  const flow = "internal-booking-v2";
  const intent = api.getOrCreateActiveBookingIntent(owner, flow, storage);
  const party = api.getBookingPartyIdentity(intent, storage);
  const children = api.registerBookingIntentManifest(intent, flow, ["member:a", "member:b"], storage);
  const restored = memoryStorage(storage.values.entries());
  assert.equal(api.getBookingPartyIdentity(intent, restored), party);
  assert.ok(!Object.values(children).includes(party));
  const entry = [...restored.values.entries()].find(([, value]) => value === party);
  assert.ok(entry);
  restored.values.delete(entry[0]);
  assert.throws(() => api.getBookingPartyIdentity(intent, restored), /core_booking:manifest_identity_mismatch/);
});

test("booking creation requires a non-placeholder actor identity", async () => {
  const api = await import("../src/services/bookingCreationIdentity.ts");

  assert.equal(
    api.requireBookingCreationActor("firebase-uid-a"),
    "firebase-uid-a"
  );

  for (const value of [
    undefined,
    null,
    "",
    " ",
    "guest",
    "internal_staff",
    123,
    {},
    "x".repeat(513)
  ]) {
    assert.throws(
      () => api.requireBookingCreationActor(value),
      /core_booking:verified_actor_required/
    );
  }
});

test("booking confirmation accepts the exact persisted identity only", async () => {
  const api = await import("../src/services/bookingCreationIdentity.ts");

  assert.equal(
    api.assertBookingCreationConfirmation("booking-a", "booking-a"),
    "booking-a"
  );

  for (const confirmed of [
    null,
    undefined,
    "",
    "booking-b",
    " booking-a ",
    123
  ]) {
    assert.throws(
      () => api.assertBookingCreationConfirmation(
        "booking-a",
        confirmed
      ),
      /core_booking:creation_confirmation_mismatch/
    );
  }
});

test("malformed expected booking identity cannot be confirmed", async () => {
  const api = await import("../src/services/bookingCreationIdentity.ts");

  for (const value of ["", " ", "a/b", "x".repeat(129)]) {
    assert.throws(
      () => api.assertBookingCreationConfirmation(value, value),
      /core_booking:creation_confirmation_mismatch/
    );
  }
});

test("public booking verifies every returned creation identity", async () => {
  const { readFileSync } = await import("node:fs");

  const source = readFileSync("src/pages/Booking.tsx", "utf8");

  assert.match(
    source,
    /assertBookingCreationConfirmation\(sequenceCreationId, groupRes\.parentId\)/
  );

  assert.match(
    source,
    /assertBookingCreationConfirmation\(packageCreationId, groupRes\.parentId\)/
  );

  assert.match(
    source,
    /assertBookingCreationConfirmation\(serviceCreationId, res\.id\)/
  );
});

test("public booking storage no longer uses a shared guest identity", async () => {
  const { readFileSync } = await import("node:fs");
  const ts = await import("typescript");

  const source = readFileSync("src/pages/Booking.tsx", "utf8");

  const tree = ts.createSourceFile(
    "Booking.tsx", source, ts.ScriptTarget.Latest,
    true, ts.ScriptKind.TSX
  );

  const actorBindings = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "getOrCreateActiveBookingIntent" &&
      node.arguments[1]?.getText(tree) === '"public-booking"'
    ) {
      const owner = node.arguments[0];

      assert.ok(ts.isObjectLiteralExpression(owner));

      const actor = owner.properties.find(property =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(tree) === "actorUid"
      );

      assert.ok(actor, "Missing actor identity");

      assert.equal(
        actor.initializer.getText(tree),
        "requireBookingCreationActor(uid)"
      );

      actorBindings.push(actor);
    }

    ts.forEachChild(node, visit);
  }

  visit(tree);

  assert.equal(actorBindings.length, 4);
  assert.ok(!source.includes('actorUid: uid || "guest"'));
});


test("public booking registers a manifest before entering its creation loop", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/pages/Booking.tsx", "utf8");

  const manifest = source.indexOf(
    "const publicCreationManifest = registerBookingIntentManifest("
  );

  const loop = source.indexOf(
    "for (let idx = 0; idx < items.length; idx++) {",
    manifest
  );

  assert.ok(manifest >= 0);
  assert.ok(loop > manifest);
});

test("public booking tracks all three confirmed creation paths", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/pages/Booking.tsx", "utf8");

  for (const name of [
    "sequenceCreationId",
    "packageCreationId",
    "serviceCreationId"
  ]) {
    assert.ok(
      source.includes(
        "confirmedPublicBookingIds.push(" + name + ");"
      )
    );
  }
});

test("public manifest completeness precedes offer usage and success state", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/pages/Booking.tsx", "utf8");

  const complete = source.indexOf(
    'throw new Error("core_booking:public_manifest_incomplete")'
  );

  const offer = source.indexOf(
    "await incrementOfferUsage(",
    complete
  );

  const success = source.indexOf(
    'localStorage.setItem("booking_success_mode", "created");',
    complete
  );

  assert.ok(complete >= 0);
  assert.ok(offer > complete);
  assert.ok(success > offer);
});

test("public booking clears the successful draft only after intent completion", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/pages/Booking.tsx", "utf8");

  const complete = source.indexOf(
    "const publicIntentCompleted = finishVerifiedBookingIntent("
  );

  const success = source.indexOf(
    'localStorage.setItem("booking_success_mode", "created");',
    complete
  );

  const clear = source.indexOf(
    'localStorage.removeItem("bookingDraft");',
    success
  );

  assert.ok(complete >= 0);
  assert.ok(success > complete);
  assert.ok(clear > success);
  assert.match(source, /if \(!publicIntentCompleted\)/);
});
