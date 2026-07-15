import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { __test } from "./packages/index.js";

const { toFirestoreFields, fromFirestoreFields, expireClientPackages } = __test;

class FakeFirestoreRest {
  constructor() {
    this.docs = new Map();
    this.failNextCommit = false;
  }

  seed(path, data) {
    this.docs.set(path, toFirestoreFields(data));
  }

  data(path) {
    const fields = this.docs.get(path);
    return fields ? fromFirestoreFields(fields) : null;
  }

  patch(path, data) {
    this.seed(path, { ...(this.data(path) || {}), ...data });
  }

  paths(prefix) {
    return [...this.docs.keys()].filter((path) => path.startsWith(prefix));
  }

  response(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  pathFromResource(name) {
    const marker = "/documents/";
    return decodeURIComponent(String(name).split(marker)[1] || "");
  }

  resource(path) {
    return `projects/waves-hotel-dashboard/databases/(default)/documents/${path}`;
  }

  docResponse(path) {
    const fields = this.docs.get(path);
    if (!fields) return { missing: this.resource(path) };
    return { found: { name: this.resource(path), fields } };
  }

  matchesWhere(data, where) {
    if (!where) return true;
    if (where.compositeFilter) {
      return where.compositeFilter.filters.every((filter) => this.matchesWhere(data, filter));
    }
    const filter = where.fieldFilter;
    const field = filter?.field?.fieldPath;
    const op = filter?.op;
    const value = fromFirestoreFields({ value: filter?.value }).value;
    if (op === "EQUAL") return data?.[field] === value;
    if (op === "LESS_THAN") return data?.[field] < value;
    return true;
  }

  query(parentPath, collectionId, structuredQuery) {
    const prefix = parentPath ? `${parentPath}/${collectionId}/` : `${collectionId}/`;
    const parentSegments = prefix.split("/").length;
    const rows = [];
    for (const [path, fields] of this.docs.entries()) {
      if (!path.startsWith(prefix)) continue;
      if (path.split("/").length !== parentSegments) continue;
      const data = fromFirestoreFields(fields);
      if (!this.matchesWhere(data, structuredQuery.where)) continue;
      rows.push({ document: { name: this.resource(path), fields } });
    }
    const offset = Number(structuredQuery.offset || 0);
    const limit = Number(structuredQuery.limit || rows.length);
    return rows.slice(offset, offset + limit);
  }

  applyWrite(write) {
    if (write.delete) {
      this.docs.delete(this.pathFromResource(write.delete));
      return;
    }
    const path = this.pathFromResource(write.update.name);
    const exists = this.docs.has(path);
    if (write.currentDocument?.exists === false && exists) {
      throw new Error("ALREADY_EXISTS");
    }
    if (write.currentDocument?.exists === true && !exists) {
      throw new Error("NOT_FOUND");
    }
    if (write.updateMask) {
      const prior = this.docs.get(path) || {};
      this.docs.set(path, { ...prior, ...write.update.fields });
    } else {
      this.docs.set(path, write.update.fields || {});
    }
  }

  fetch = async (url, init = {}) => {
    const textUrl = String(url);
    if (textUrl.endsWith(":beginTransaction")) {
      return this.response({ transaction: "fake-transaction" });
    }
    if (textUrl.endsWith(":rollback")) {
      return this.response({});
    }
    if (textUrl.endsWith(":batchGet")) {
      const body = JSON.parse(init.body || "{}");
      return this.response((body.documents || []).map((name) => this.docResponse(this.pathFromResource(name))));
    }
    if (textUrl.includes(":runQuery")) {
      const body = JSON.parse(init.body || "{}");
      const parentRaw = decodeURIComponent((new URL(textUrl).pathname.split("/documents/")[1] || "").replace(":runQuery", ""));
      const collectionId = body.structuredQuery?.from?.[0]?.collectionId;
      return this.response(this.query(parentRaw, collectionId, body.structuredQuery || {}));
    }
    if (textUrl.endsWith(":commit")) {
      if (this.failNextCommit) {
        this.failNextCommit = false;
        return this.response({ error: { message: "forced commit failure" } }, 500);
      }
      const body = JSON.parse(init.body || "{}");
      try {
        (body.writes || []).forEach((write) => this.applyWrite(write));
      } catch (error) {
        return this.response({ error: { message: error.message } }, 409);
      }
      return this.response({ writeResults: [] });
    }
    return this.response({ error: { message: `unexpected fetch ${textUrl}` } }, 500);
  };
}

function env() {
  return {
    FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
    FIRESTORE_EMULATOR_HOST: "firestore.test",
    PACKAGES_AUTH_TEST_MODE: "true",
    SALON_ID: "main",
    ALLOWED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5174,https://queens-salon-web.vercel.app,https://queens-salon-web-gnxk.vercel.app",
  };
}

function request(path, { method = "POST", token = "test:owner1:owner", body, origin = "http://127.0.0.1:5174" } = {}) {
  return new Request(`http://worker.test${path}`, {
    method,
    headers: {
      Origin: origin,
      Authorization: token ? `Bearer ${token}` : "",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(body || {}) : undefined,
  });
}

function seedBase(fake) {
  fake.seed("salons/main/users/owner1", { role: "owner", active: true });
  fake.seed("salons/main/users/client1", { role: "client", active: true, clientId: "client-a" });
  fake.seed("salons/main/clients/client-a", { clientId: "client-a", authUid: "client1", name: "Client A", phone: "0500000001" });
  fake.seed("salons/main/clients/client-b", { clientId: "client-b", name: "Client B", phone: "0500000002" });
  fake.seed("salons/main/packages_catalog/blowdry-10", {
    name: "Blowdry 10",
    sessionsCount: 10,
    price: 300,
    validityDays: 365,
    allowedServiceIds: ["svc-a", "svc-b"],
    active: true,
  });
  fake.seed("salons/main/services/svc-a", { name: "Service A", price: 60, durationMin: 30, active: true });
  fake.seed("salons/main/services/svc-b", { name: "Service B", price: 80, durationMin: 45, active: true });
  fake.seed("salons/main/staff_public/staff-a", {
    name: "Staff A",
    active: true,
    isActive: true,
    employmentStatus: "active",
    serviceIds: ["svc-a", "svc-b"],
  });
  fake.seed("salons/main/settings/app", {
    booking: {
      slotStepMin: 30,
      bufferMin: 0,
      businessHours: {
        sun: { enabled: true, start: "09:00", end: "22:00" },
        mon: { enabled: true, start: "09:00", end: "22:00" },
        tue: { enabled: true, start: "09:00", end: "22:00" },
        wed: { enabled: true, start: "09:00", end: "22:00" },
        thu: { enabled: true, start: "09:00", end: "22:00" },
        fri: { enabled: true, start: "09:00", end: "22:00" },
        sat: { enabled: true, start: "09:00", end: "22:00" },
      },
    },
  });
  fake.seed("salons/main/settings/finance", { taxRate: 15 });
  fake.seed("salons/main/settings/package_subscriptions", {
    lateCancellationWindowMinutes: 0,
    lateCancellationConsumesSession: false,
    noShowConsumesSession: true,
  });
  fake.seed("salons/main/counters/invoices", { next: 10000 });
  fake.seed("salons/main/counters/bookings", { next: 10000 });
}

async function withFakeFirestore(fn) {
  const fake = new FakeFirestoreRest();
  seedBase(fake);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    return await fn(fake);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function json(response) {
  return response.json();
}

async function purchase(fake, invoiceId = "invoice-1") {
  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "client-a",
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId,
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  return body.data;
}

async function redeem(clientPackageId, operationId = "booking-1", time = "10:00") {
  const response = await worker.fetch(request("/api/packages/redeem", {
    body: {
      salonId: "main",
      clientId: "client-a",
      clientPackageId,
      serviceId: "svc-a",
      employeeId: "staff-a",
      date: "2027-05-15",
      time,
      operationId,
      cartItemId: `cart-${operationId}`,
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.data;
}

test("rejects missing and invalid tokens", async () => {
  const missing = await worker.fetch(request("/api/packages/purchase", { token: "", body: {} }), env());
  assert.equal(missing.status, 401);

  const invalid = await worker.fetch(request("/api/packages/purchase", { token: "invalid-token", body: {} }), env());
  assert.equal(invalid.status, 401);
});

test("package worker allows both production dashboard origins", async () => {
  for (const origin of ["https://queens-salon-web.vercel.app", "https://queens-salon-web-gnxk.vercel.app"]) {
    const response = await worker.fetch(new Request("http://worker.test/api/packages/client-wallet", {
      method: "OPTIONS",
      headers: { Origin: origin },
    }), env());
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  }
});

test("rejects unauthorized role before package sale", async () => withFakeFirestore(async () => {
  const response = await worker.fetch(request("/api/packages/purchase", {
    token: "test:client1:client",
    body: {
      salonId: "main",
      clientId: "client-a",
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "forbidden-sale",
    },
  }), env());
  assert.equal(response.status, 403);
}));

test("sells package idempotently and writes invoice, ledger and balance", async () => withFakeFirestore(async (fake) => {
  const sale = await purchase(fake, "sale-idem-1");
  const clientPackage = fake.data(`salons/main/client_packages/${sale.clientPackageId}`);
  assert.equal(clientPackage.remainingSessions, 10);
  assert.equal(clientPackage.reservedSessions, 0);
  assert.equal(fake.paths("salons/main/invoices/").length, 1);
  assert.equal(fake.paths("salons/main/client_package_transactions/purchase:").length, 1);

  const repeated = await purchase(fake, "sale-idem-1");
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.clientPackageId, sale.clientPackageId);
  assert.equal(fake.paths("salons/main/client_packages/").length, 1);
}));

test("purchase resolves client when document id differs from auth uid", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/client-doc-not-uid", {
    clientId: "client-canonical-c",
    authUid: "firebase-uid-c",
    customerId: "customer-c",
    name: "Client C",
    phone: "0500000003",
  });

  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "firebase-uid-c",
      clientLookup: {
        id: "firebase-uid-c",
        uid: "firebase-uid-c",
        authUid: "firebase-uid-c",
        customerId: "customer-c",
        phone: "0500000003",
      },
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "sale-doc-id-diff-uid",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "client-canonical-c");
  const clientPackage = fake.data(`salons/main/client_packages/${body.data.clientPackageId}`);
  assert.equal(clientPackage.clientId, "client-canonical-c");
  assert.equal(clientPackage.legacyClientDocId, "client-doc-not-uid");
  const ledgerPath = fake.paths("salons/main/client_package_transactions/purchase:")[0];
  const ledger = fake.data(ledgerPath);
  assert.equal(ledger.requestedClientId, "firebase-uid-c");
  assert.equal(ledger.clientId, "client-canonical-c");
}));

test("purchase prefers direct document id over duplicate phone matches", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/direct-doc-client", {
    clientId: "direct-canonical",
    name: "Direct Client",
    phone: "0500000099",
  });
  fake.seed("salons/main/clients/other-same-phone-client", {
    clientId: "other-same-phone",
    name: "Other Same Phone",
    phone: "0500000099",
  });

  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "direct-doc-client",
      clientLookup: { phone: "0500000099" },
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "sale-direct-doc-priority",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "direct-canonical");
}));

test("purchase ignores document id value sent inside phone lookup fields", async () => withFakeFirestore(async (fake) => {
  const idLikeValue = "AbCdEfGhIjKlMnOpQrSt";
  fake.seed("salons/main/clients/id-like-phone-doc", {
    clientId: "id-like-canonical",
    authUid: idLikeValue,
    name: "ID Like Client",
    phone: "0500000061",
  });

  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: idLikeValue,
      clientLookup: {
        authUid: idLikeValue,
        clientPhone: idLikeValue,
        phoneNumber: idLikeValue,
      },
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "sale-ignore-id-as-phone",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "id-like-canonical");
}));

test("purchase counts same document matched by uid and clientId once", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/multi-field-client", {
    clientId: "multi-canonical",
    uid: "multi-uid",
    authUid: "multi-uid",
    name: "Multi Field Client",
    phone: "0500000062",
  });

  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "missing-strong-id",
      clientLookup: {
        clientId: "multi-canonical",
        uid: "multi-uid",
      },
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "sale-same-doc-multi-fields",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "multi-canonical");
}));

test("purchase returns duplicate identity when phone-only lookup matches two clients", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/phone-duplicate-a", {
    clientId: "phone-duplicate-a",
    name: "Phone Duplicate A",
    phone: "0500000077",
  });
  fake.seed("salons/main/clients/phone-duplicate-b", {
    clientId: "phone-duplicate-b",
    name: "Phone Duplicate B",
    phone: "0500000077",
  });

  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "missing-phone-only",
      clientLookup: { phone: "0500000077" },
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "sale-phone-duplicate",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, "packages_client:duplicate_identity");
}));

test("client wallet resolves canonical identity and includes package linked to legacy client id", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/canonical-wallet-client", {
    clientId: "canonical-wallet-client",
    legacyClientDocId: "legacy-wallet-client",
    authUid: "wallet-auth-uid",
    name: "Wallet Client",
    phone: "0500000088",
  });
  fake.seed("salons/main/client_packages/legacy-linked-package", {
    clientId: "legacy-wallet-client",
    packageNameSnapshot: "Legacy Linked Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 10,
    remainingSessions: 10,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: {
      salonId: "main",
      clientId: "wallet-auth-uid",
      clientLookup: { authUid: "wallet-auth-uid" },
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.canonicalClientId, "canonical-wallet-client");
  assert.equal(body.data.activePackages, 1);
  assert.equal(body.data.totalRemainingSessions, 10);
  assert.equal(body.data.totalUsedSessions, 0);
  assert.equal(body.data.totalReservedSessions, 0);
  assert.deepEqual(body.data.packages.map((p) => p.id), ["legacy-linked-package"]);
  assert.equal(body.data.packages[0].legacyClientId, "legacy-wallet-client");
}));

test("redemption uses canonical client id and relinks legacy package id", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/canonical-redeem-client", {
    clientId: "canonical-redeem-client",
    legacyClientDocId: "legacy-redeem-client",
    authUid: "redeem-auth-uid",
    name: "Redeem Client",
    phone: "0500000089",
  });
  fake.seed("salons/main/client_packages/legacy-redeem-package", {
    clientId: "legacy-redeem-client",
    packageNameSnapshot: "Legacy Redeem Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 1,
    remainingSessions: 1,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/redeem", {
    body: {
      salonId: "main",
      clientId: "redeem-auth-uid",
      clientLookup: { authUid: "redeem-auth-uid" },
      serviceId: "svc-a",
      employeeId: "staff-a",
      date: "2027-05-16",
      time: "12:00",
      operationId: "legacy-redeem-op",
      cartItemId: "legacy-cart-item",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "canonical-redeem-client");
  assert.equal(body.data.canonicalClientId, "canonical-redeem-client");
  assert.equal(body.data.clientPackageId, "legacy-redeem-package");
  assert.equal(body.data.packageDocumentId, "legacy-redeem-package");
  assert.equal(body.data.beforeRemaining, 1);
  assert.equal(body.data.afterRemaining, 0);
  assert.equal(body.data.redeemedServiceId, "svc-a");
  assert.equal(body.data.cartItemId, "legacy-cart-item");
  const packageDoc = fake.data("salons/main/client_packages/legacy-redeem-package");
  assert.equal(packageDoc.clientId, "canonical-redeem-client");
  assert.equal(packageDoc.legacyClientId, "legacy-redeem-client");
  assert.equal(packageDoc.remainingSessions, 0);
  assert.equal(packageDoc.reservedSessions, 1);
  const booking = fake.data(`salons/main/bookings/${body.data.bookingId}`);
  assert.equal(booking.clientId, "canonical-redeem-client");
}));

test("redemption rejects phone-only client lookup", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/client_packages/phone-only-package", {
    clientId: "client-a",
    packageNameSnapshot: "Phone Only Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 3,
    remainingSessions: 3,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/redeem", {
    body: {
      salonId: "main",
      clientId: "missing-client-id",
      clientLookup: { phone: "0500000001" },
      clientPackageId: "phone-only-package",
      serviceId: "svc-a",
      employeeId: "staff-a",
      date: "2027-05-16",
      time: "13:00",
      operationId: "phone-only-redeem",
      cartItemId: "phone-only-cart",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 404, JSON.stringify(body));
  assert.equal(body.error, "packages_client:not_found");
  const packageDoc = fake.data("salons/main/client_packages/phone-only-package");
  assert.equal(packageDoc.remainingSessions, 3);
  assert.equal(packageDoc.reservedSessions, 0);
}));

test("creates package redemption, prevents slot conflict, consumes and cancels reservation", async () => withFakeFirestore(async (fake) => {
  const sale = await purchase(fake, "sale-flow-1");
  const first = await redeem(sale.clientPackageId, "op-flow-1", "10:00");
  assert.equal(first.canonicalClientId, "client-a");
  assert.equal(first.packageDocumentId, sale.clientPackageId);
  assert.equal(first.beforeRemaining, 10);
  assert.equal(first.afterRemaining, 9);
  assert.equal(first.redeemedServiceId, "svc-a");
  assert.equal(first.cartItemId, "cart-op-flow-1");
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).remainingSessions, 9);
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).reservedSessions, 1);
  assert.equal(fake.paths("salons/main/booking_slots/").length, 1);

  const conflict = await worker.fetch(request("/api/packages/redemption/create", {
    body: {
      salonId: "main",
      clientId: "client-a",
      clientPackageId: sale.clientPackageId,
      serviceId: "svc-a",
      employeeId: "staff-a",
      date: "2027-05-15",
      time: "10:00",
      operationId: "op-conflict",
    },
  }), env());
  assert.equal(conflict.status, 409);

  fake.patch(`salons/main/bookings/${first.bookingId}`, { status: "completed" });
  const consume = await worker.fetch(request("/api/packages/redemption/consume", {
    body: { salonId: "main", bookingId: first.bookingId },
  }), env());
  assert.equal(consume.status, 200, await consume.text());
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).remainingSessions, 9);
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).reservedSessions, 0);
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).usedSessions, 1);

  const second = await redeem(sale.clientPackageId, "op-flow-2", "11:00");
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).remainingSessions, 8);
  const cancel = await worker.fetch(request("/api/packages/redemption/cancel", {
    body: { salonId: "main", bookingId: second.bookingId, reason: "test cancel" },
  }), env());
  assert.equal(cancel.status, 200, await cancel.text());
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).remainingSessions, 9);
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).reservedSessions, 0);
}));

test("client wallet is derived from token identity and ignores requested clientId", async () => withFakeFirestore(async (fake) => {
  const sale = await purchase(fake, "wallet-sale-1");
  fake.seed("salons/main/client_packages/other-package", {
    clientId: "client-b",
    packageNameSnapshot: "Other",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 2,
    remainingSessions: 2,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
  });

  const response = await worker.fetch(request(`/api/packages/my-wallet?salonId=main&clientId=client-b`, {
    method: "GET",
    token: "test:client1:client",
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "client-a");
  assert.deepEqual(body.data.packages.map((p) => p.id), [sale.clientPackageId]);
}));

test("admin client package list is restricted to owner and admin roles", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/users/admin1", { role: "admin", active: true });

  const client = await worker.fetch(request("/api/packages/admin/list-client-packages?salonId=main", {
    method: "GET",
    token: "test:client1:client",
  }), env());
  assert.equal(client.status, 403);

  const admin = await worker.fetch(request("/api/packages/admin/list-client-packages?salonId=main", {
    method: "GET",
    token: "test:admin1:admin",
  }), env());
  const body = await json(admin);
  assert.equal(admin.status, 200, JSON.stringify(body));
  assert.deepEqual(body.data, []);
}));

test("admin client package list returns only safe active package fields", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/legacy-client-doc", {
    clientId: "canonical-legacy-client",
    legacyClientDocId: "legacy-client-id",
    name: "Legacy Client",
    phone: "0500000090",
    refreshToken: "do-not-return",
  });
  fake.seed("salons/main/client_packages/visible-package", {
    clientId: "legacy-client-id",
    packageNameSnapshot: "VIP Sessions",
    totalSessions: 5,
    remainingSessions: 3,
    reservedSessions: 1,
    usedSessions: 1,
    status: "active",
    expiresAt: "2099-01-01T00:00:00.000Z",
    token: "do-not-return",
  });
  fake.seed("salons/main/client_packages/expired-package", {
    clientId: "client-a",
    packageNameSnapshot: "Expired Sessions",
    totalSessions: 2,
    remainingSessions: 2,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    expiresAt: "2024-01-01T00:00:00.000Z",
  });
  fake.seed("salons/main/client_packages/cancelled-package", {
    clientId: "client-a",
    packageNameSnapshot: "Cancelled Sessions",
    totalSessions: 2,
    remainingSessions: 2,
    reservedSessions: 0,
    usedSessions: 0,
    status: "cancelled",
  });
  const before = JSON.stringify([...fake.docs.entries()]);

  const response = await worker.fetch(request("/api/packages/admin/list-client-packages?salonId=main", {
    method: "GET",
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.deepEqual(body.data, [{
    clientName: "Legacy Client",
    phone: "0500000090",
    canonicalClientId: "canonical-legacy-client",
    packageName: "VIP Sessions",
    totalSessions: 5,
    remainingSessions: 3,
    usedSessions: 1,
    reservedSessions: 1,
    status: "active",
    expiresAt: "2099-01-01T00:00:00.000Z",
  }]);
  assert.deepEqual(Object.keys(body.data[0]), [
    "clientName",
    "phone",
    "canonicalClientId",
    "packageName",
    "totalSessions",
    "remainingSessions",
    "usedSessions",
    "reservedSessions",
    "status",
    "expiresAt",
  ]);
  assert.equal(JSON.stringify([...fake.docs.entries()]), before);
}));

test("failed Firestore commit does not leave partial purchase docs in fake store", async () => withFakeFirestore(async (fake) => {
  fake.failNextCommit = true;
  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "client-a",
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "commit-fail",
    },
  }), env());
  assert.equal(response.status, 500);
  assert.equal(fake.paths("salons/main/client_packages/").length, 0);
  assert.equal(fake.paths("salons/main/invoices/").length, 0);
}));

test("cron expires active packages without touching future packages", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/client_packages/expired-package", {
    clientId: "client-a",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 1,
    remainingSessions: 1,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    expiresAt: "2024-01-01T00:00:00.000Z",
  });
  fake.seed("salons/main/client_packages/future-package", {
    clientId: "client-a",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 1,
    remainingSessions: 1,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  const result = await expireClientPackages(env());
  assert.equal(result.ok, true);
  assert.equal(fake.data("salons/main/client_packages/expired-package").status, "expired");
  assert.equal(fake.data("salons/main/client_packages/future-package").status, "active");
}));
