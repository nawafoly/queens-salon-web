import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  "src/services/bookingDataSources/coreD1BookingDataSource.ts",
  "utf8"
);

const start = source.indexOf(
  "async function resolveClientId("
);

const end = source.indexOf(
  "function generatedBookingId(",
  start
);

assert.ok(start >= 0, "resolveClientId must exist");
assert.ok(end > start, "resolver boundary must exist");

const implementation = source.slice(start, end);

const compiled = ts.transpileModule(implementation, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
  reportDiagnostics: true,
});

const errors = (compiled.diagnostics || []).filter(
  (diagnostic) =>
    diagnostic.category === ts.DiagnosticCategory.Error
);

assert.equal(
  errors.length,
  0,
  "resolver TypeScript compilation must succeed"
);

function createHarness() {
  const calls = [];

  const clients = {
    async get(id) {
      calls.push(["get", id]);

      return {
        id,
        firebaseUid: null,
      };
    },

    async create(input) {
      calls.push(["create", input]);

      return {
        id: "new-guest-client",
        ...input,
      };
    },

    async patch(id, input) {
      calls.push(["patch", id, input]);

      throw new Error("BOOKING_MUST_NOT_PATCH_CLIENT_IDENTITY");
    },
  };

  const api = async (path) => {
    calls.push(["api", path]);

    assert.equal(path, "/api/core/client/me");

    return {
      id: "verified-client-id",
    };
  };

  const normalizePhone = (value) => {
    const digits = String(value || "").replace(/\D/g, "");

    if (digits.startsWith("9665") && digits.length === 12) {
      return `0${digits.slice(3)}`;
    }

    if (digits.startsWith("5") && digits.length === 9) {
      return `0${digits}`;
    }

    return digits;
  };

  const readGuest = (booking) => {
    const guest = booking.guestParticipant;

    if (!guest?.id || !guest?.name) {
      return null;
    }

    return guest;
  };

  const factory = new Function(
    "CoreClientService",
    "coreApiRequest",
    "normalizePhone",
    "readBookingGuestParticipant",
    `${compiled.outputText}\nreturn resolveClientId;`
  );

  const resolve = factory(
    clients,
    api,
    normalizePhone,
    readGuest
  );

  return {
    resolve,
    calls,
  };
}

test("signed-in booking uses verified Core client profile", async () => {
  const { resolve, calls } = createHarness();

  const id = await resolve({
    channel: "client",
    userId: "firebase-client-uid",
    clientName: "Existing Client",
    clientPhone: "0500000000",
    clientFirebaseUid: "untrusted-browser-uid",
  });

  assert.equal(id, "verified-client-id");

  assert.deepEqual(calls, [
    ["api", "/api/core/client/me"],
  ]);
});

test("guest booking creates a client without Firebase linking", async () => {
  const { resolve, calls } = createHarness();

  const id = await resolve({
    channel: "client",
    userId: null,
    clientName: "Guest Client",
    clientPhone: "966512345678",
    clientFirebaseUid: "untrusted-browser-uid",
  });

  assert.equal(id, "new-guest-client");

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "create");
  assert.equal(calls[0][1].phone, "0512345678");

  assert.equal(
    Object.hasOwn(calls[0][1], "firebaseUid"),
    false
  );
});

test("internal booking uses selected client without changing identity", async () => {
  const { resolve, calls } = createHarness();

  const id = await resolve({
    channel: "internal",
    userId: "staff-firebase-uid",
    clientId: "selected-client-id",
    clientFirebaseUid: "staff-firebase-uid",
  });

  assert.equal(id, "selected-client-id");

  assert.deepEqual(calls, [
    ["get", "selected-client-id"],
  ]);
});

test("group participant preserves explicitly assigned participant", async () => {
  const { resolve, calls } = createHarness();

  const id = await resolve({
    channel: "client",
    userId: "firebase-client-uid",
    guestParticipant: {
      id: "group-participant-id",
      name: "Guest Participant",
    },
  });

  assert.equal(id, "group-participant-id");
  assert.deepEqual(calls, []);
});

test("group parent uses the verified client profile", async () => {
  const { resolve, calls } = createHarness();

  const id = await resolve({
    channel: "client",
    userId: "firebase-client-uid",
    clientName: "Group Parent",
    clientPhone: "0500000000",
  });

  assert.equal(id, "verified-client-id");

  assert.deepEqual(calls, [
    ["api", "/api/core/client/me"],
  ]);
});