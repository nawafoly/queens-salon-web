import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

const projectId = "waves-hotel-dashboard";
const salonId = "main";
const workerBase = process.env.PACKAGES_WORKER_LOCAL_URL || "http://127.0.0.1:8797";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const serviceId = "test-blowdry-short";
const employeeId = "test-staff-blowdry";
const clientId = "test-client-session-001";
const packageCatalogId = "test-package-blowdry-10";

const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
const db = admin.firestore(app);
const salon = db.collection("salons").doc(salonId);

async function signIn(email, password) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.idToken;
}

async function api(path, { token, method = "POST", body } = {}) {
  const response = await fetch(`${workerBase}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      origin: "http://127.0.0.1:5174",
    },
    ...(method === "POST" ? { body: JSON.stringify({ salonId, ...(body || {}) }) } : {}),
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { response, body: parsed };
}

async function ok(path, options) {
  const result = await api(path, options);
  assert.equal(result.response.ok, true, `${path} failed: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.ok, true, `${path} returned non-ok: ${JSON.stringify(result.body)}`);
  return result.body.data;
}

async function expectFail(path, options, statuses) {
  const result = await api(path, options);
  assert.equal(statuses.includes(result.response.status), true, `${path} expected ${statuses}, got ${result.response.status}: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.ok, false);
  return result;
}

async function packageDoc(id) {
  const snap = await salon.collection("client_packages").doc(id).get();
  assert.equal(snap.exists, true, `client package missing: ${id}`);
  return snap.data();
}

function balances(raw) {
  return {
    remaining: Number(raw.remainingSessions || 0),
    reserved: Number(raw.reservedSessions || 0),
    used: Number(raw.usedSessions || 0),
    status: String(raw.status || ""),
  };
}

async function countBookingsByOperation(operationId) {
  const reserveId = await transactionId("reserve", operationId);
  const bookingId = reserveId.replace(/^reserve:/, "pkg_");
  const snap = await salon.collection("bookings").doc(bookingId).get();
  return snap.exists ? 1 : 0;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function transactionId(type, entityId) {
  const safe = String(entityId).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "source";
  const hash = (await sha256Hex(String(entityId))).slice(0, 20);
  return `${type}:${safe}:${hash}`;
}

async function main() {
  const ownerToken = await signIn("owner.packages@test.local", "TestOwner123!");
  const clientToken = await signIn("client.packages@test.local", "TestClient123!");

  await expectFail("/api/packages/purchase", { body: {} }, [401]);
  await expectFail("/api/packages/purchase", {
    token: clientToken,
    body: { clientId, packageCatalogId, paymentMethod: "cash", invoiceId: "worker-forbidden-sale" },
  }, [403]);

  const sale = await ok("/api/packages/purchase", {
    token: ownerToken,
    body: { clientId, packageCatalogId, paymentMethod: "cash", invoiceId: "worker-integration-sale-1" },
  });
  assert.deepEqual(balances(await packageDoc(sale.clientPackageId)), {
    remaining: 10,
    reserved: 0,
    used: 0,
    status: "active",
  });

  const repeatedSale = await ok("/api/packages/purchase", {
    token: ownerToken,
    body: { clientId, packageCatalogId, paymentMethod: "cash", invoiceId: "worker-integration-sale-1" },
  });
  assert.equal(repeatedSale.idempotent, true);
  assert.equal(repeatedSale.clientPackageId, sale.clientPackageId);

  const firstBooking = await ok("/api/packages/redemption/create", {
    token: ownerToken,
    body: {
      clientId,
      clientPackageId: sale.clientPackageId,
      serviceId,
      employeeId,
      date: "2027-05-15",
      time: "10:00",
      operationId: "worker-booking-1",
    },
  });
  assert.deepEqual(balances(await packageDoc(sale.clientPackageId)), {
    remaining: 9,
    reserved: 1,
    used: 0,
    status: "active",
  });

  await salon.collection("bookings").doc(firstBooking.bookingId).update({ status: "completed" });
  await ok("/api/packages/redemption/consume", {
    token: ownerToken,
    body: { bookingId: firstBooking.bookingId },
  });
  assert.deepEqual(balances(await packageDoc(sale.clientPackageId)), {
    remaining: 9,
    reserved: 0,
    used: 1,
    status: "active",
  });

  const cancelBooking = await ok("/api/packages/redemption/create", {
    token: ownerToken,
    body: {
      clientId,
      clientPackageId: sale.clientPackageId,
      serviceId,
      employeeId,
      date: "2027-05-15",
      time: "11:00",
      operationId: "worker-booking-cancel",
    },
  });
  await ok("/api/packages/redemption/cancel", {
    token: ownerToken,
    body: { bookingId: cancelBooking.bookingId, reason: "integration cancel" },
  });
  assert.deepEqual(balances(await packageDoc(sale.clientPackageId)), {
    remaining: 9,
    reserved: 0,
    used: 1,
    status: "active",
  });

  await ok("/api/packages/redemption/create", {
    token: ownerToken,
    body: {
      clientId,
      clientPackageId: sale.clientPackageId,
      serviceId,
      employeeId,
      date: "2027-05-15",
      time: "13:00",
      operationId: "worker-slot-owner",
    },
  });
  await expectFail("/api/packages/redemption/create", {
    token: ownerToken,
    body: {
      clientId,
      clientPackageId: sale.clientPackageId,
      serviceId,
      employeeId,
      date: "2027-05-15",
      time: "13:00",
      operationId: "worker-slot-conflict",
    },
  }, [409]);
  assert.equal(await countBookingsByOperation("worker-slot-conflict"), 0);

  const lastSale = await ok("/api/packages/purchase", {
    token: ownerToken,
    body: { clientId, packageCatalogId, paymentMethod: "cash", invoiceId: "worker-last-session-sale" },
  });
  await ok("/api/packages/adjust", {
    token: ownerToken,
    body: {
      clientPackageId: lastSale.clientPackageId,
      operationId: "worker-last-session-adjust",
      sessionsDelta: -9,
      reason: "integration last session setup",
    },
  });
  assert.equal((await packageDoc(lastSale.clientPackageId)).remainingSessions, 1);

  const concurrent = await Promise.allSettled([
    api("/api/packages/redemption/create", {
      token: ownerToken,
      body: {
        clientId,
        clientPackageId: lastSale.clientPackageId,
        serviceId,
        employeeId,
        date: "2027-05-16",
        time: "14:00",
        operationId: "worker-last-a",
      },
    }),
    api("/api/packages/redemption/create", {
      token: ownerToken,
      body: {
        clientId,
        clientPackageId: lastSale.clientPackageId,
        serviceId,
        employeeId,
        date: "2027-05-16",
        time: "14:30",
        operationId: "worker-last-b",
      },
    }),
  ]);
  const responses = concurrent.map((item) => {
    assert.equal(item.status, "fulfilled");
    return item.value;
  });
  const successes = responses.filter((item) => item.response.ok);
  const failures = responses.filter((item) => !item.response.ok);
  assert.equal(successes.length, 1, JSON.stringify(responses.map((r) => ({ status: r.response.status, body: r.body }))));
  assert.equal(failures.length, 1);
  assert.deepEqual(balances(await packageDoc(lastSale.clientPackageId)), {
    remaining: 0,
    reserved: 1,
    used: 0,
    status: "active",
  });

  const wallet = await ok("/api/packages/my-wallet?salonId=main&clientId=client-b", {
    method: "GET",
    token: clientToken,
  });
  assert.equal(wallet.clientId, clientId);
  assert.equal(wallet.packages.some((p) => p.id === sale.clientPackageId), true);
  assert.equal(wallet.packages.some((p) => p.clientId === "client-b"), false);

  const expiredId = "worker-expired-package";
  await salon.collection("client_packages").doc(expiredId).set({
    clientId,
    allowedServiceIdsSnapshot: [serviceId],
    totalSessions: 1,
    remainingSessions: 1,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    expiresAt: admin.firestore.Timestamp.fromDate(new Date("2024-01-01T00:00:00.000Z")),
  });
  const cronResponse = await fetch(`${workerBase}/__scheduled`, { method: "POST" });
  assert.equal([200, 202, 204].includes(cronResponse.status), true, `scheduled status ${cronResponse.status}: ${await cronResponse.text()}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal((await packageDoc(expiredId)).status, "expired");

  console.log(JSON.stringify({
    ok: true,
    salePackage: sale.clientPackageId,
    firstBooking: firstBooking.bookingId,
    lastSession: {
      successStatus: successes[0].response.status,
      failureStatus: failures[0].response.status,
      balances: balances(await packageDoc(lastSale.clientPackageId)),
    },
    cronExpiredPackage: expiredId,
  }, null, 2));
}

await main();
