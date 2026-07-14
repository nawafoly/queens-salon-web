import test from "node:test";
import assert from "node:assert/strict";
import type * as admin from "firebase-admin";
import { buildPackageSubscriptionHandlers } from "./packageSubscriptionFunctions.js";
import { transactionId } from "./packageSubscriptionDomain.js";
import { buildBookingSlotId } from "./packageRedemptionBookingDomain.js";

type Row = Record<string, any>;

class FakeDocRef {
  constructor(readonly store: FakeFirestore, readonly path: string) {}
  get id() {
    const parts = this.path.split("/");
    return parts[parts.length - 1] || "";
  }
  collection(name: string) {
    return new FakeCollectionRef(this.store, `${this.path}/${name}`);
  }
}

class FakeDocSnapshot {
  readonly exists: boolean;
  constructor(readonly ref: FakeDocRef, private readonly value: Row | undefined) {
    this.exists = value !== undefined;
  }
  get id() {
    return this.ref.id;
  }
  data() {
    return this.value;
  }
}

class FakeQuery {
  constructor(
    readonly store: FakeFirestore,
    readonly path: string,
    readonly field: string,
    readonly value: unknown
  ) {}
  limit() {
    return this;
  }
}

class FakeCollectionRef {
  constructor(readonly store: FakeFirestore, readonly path: string) {}
  doc(id?: string) {
    const resolved = id || `auto-${++this.store.autoId}`;
    return new FakeDocRef(this.store, `${this.path}/${resolved}`);
  }
  where(field: string, operator: string, value: unknown) {
    assert.equal(operator, "==");
    return new FakeQuery(this.store, this.path, field, value);
  }
}

type StagedWrite =
  | { kind: "create"; ref: FakeDocRef; value: Row }
  | { kind: "set"; ref: FakeDocRef; value: Row }
  | { kind: "update"; ref: FakeDocRef; value: Row };

class FakeTransaction {
  readonly writes: StagedWrite[] = [];
  constructor(private readonly store: FakeFirestore) {}
  async get(ref: FakeDocRef | FakeQuery): Promise<any> {
    if (ref instanceof FakeQuery) {
      const prefix = `${ref.path}/`;
      const docs = [...this.store.rows.entries()]
        .filter(([path, value]) => {
          const suffix = path.slice(prefix.length);
          return path.startsWith(prefix) && !suffix.includes("/") && value[ref.field] === ref.value;
        })
        .map(([path, value]) => new FakeDocSnapshot(new FakeDocRef(this.store, path), value));
      return { docs, empty: docs.length === 0, size: docs.length };
    }
    return new FakeDocSnapshot(ref, this.store.rows.get(ref.path));
  }
  create(ref: FakeDocRef, value: Row) {
    this.writes.push({ kind: "create", ref, value });
  }
  set(ref: FakeDocRef, value: Row) {
    this.writes.push({ kind: "set", ref, value });
  }
  update(ref: FakeDocRef, value: Row) {
    this.writes.push({ kind: "update", ref, value });
  }
  commit() {
    this.writes.forEach((write) => {
      const existing = this.store.rows.get(write.ref.path);
      if (write.kind === "create" && existing) throw new Error(`already exists: ${write.ref.path}`);
      if (write.kind === "update" && !existing) throw new Error(`missing: ${write.ref.path}`);
      this.store.rows.set(
        write.ref.path,
        write.kind === "update" ? { ...existing, ...write.value } : { ...write.value }
      );
    });
  }
}

class FakeFirestore {
  readonly rows = new Map<string, Row>();
  autoId = 0;
  private queue = Promise.resolve();

  collection(name: string) {
    return new FakeCollectionRef(this, name);
  }
  seed(path: string, value: Row) {
    this.rows.set(path, { ...value });
  }
  read(path: string) {
    return this.rows.get(path);
  }
  async runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const prior = this.queue;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    } finally {
      release();
    }
  }
}

function request(data: Row) {
  return { auth: { uid: "owner-1", token: { role: "owner" } }, data };
}

function buildHarness() {
  const store = new FakeFirestore();
  const handlers = buildPackageSubscriptionHandlers({
    db: store as unknown as admin.firestore.Firestore,
    resolveCallerRole: async () => "owner",
    defaultSalonId: "main",
  });
  return { store, handlers };
}

async function purchaseOneSessionPackage() {
  const harness = buildHarness();
  harness.store.seed("salons/main/clients/client-1", { name: "Client" });
  harness.store.seed("salons/main/packages_catalog/catalog-1", {
    name: "One visit",
    sessionsCount: 1,
    price: 80,
    allowedServiceIds: ["service-1"],
    validityDays: 30,
    active: true,
  });
  const result = await harness.handlers.purchaseClientPackage(
    request({ clientId: "client-1", packageCatalogId: "catalog-1", invoiceId: "invoice-1" })
  );
  return {
    ...harness,
    clientPackageId: String((result as any).clientPackageId),
    clientId: String((result as any).clientId),
  };
}

test("purchase is atomic and idempotent for the same invoice", async () => {
  const { store, handlers, clientPackageId } = await purchaseOneSessionPackage();
  const repeated = await handlers.purchaseClientPackage(
    request({ clientId: "client-1", packageCatalogId: "catalog-1", invoiceId: "invoice-1" })
  );
  assert.equal((repeated as any).idempotent, true);
  assert.equal((repeated as any).clientPackageId, clientPackageId);
  assert.equal(
    [...store.rows.keys()].filter((path) => path.startsWith("salons/main/client_packages/")).length,
    1
  );
  const invoiceDocumentId = transactionId("purchase", "invoice-1").replace(/^purchase:/, "invoice_");
  assert.equal(store.read(`salons/main/invoices/${invoiceDocumentId}`)?.total, 80);
  assert.equal(
    store.read(`salons/main/client_package_transactions/${transactionId("purchase", "invoice-1")}`)?.sessionsDelta,
    1
  );
});

test("purchase ignores client supplied price and session count and trusts the catalog", async () => {
  const { store, handlers, clientPackageId } = await purchaseOneSessionPackage();
  const packageDoc = store.read(`salons/main/client_packages/${clientPackageId}`);
  assert.equal(packageDoc?.purchasePrice, 80);
  assert.equal(packageDoc?.totalSessions, 1);

  const second = await handlers.purchaseClientPackage(request({
    clientId: "client-1",
    packageCatalogId: "catalog-1",
    invoiceId: "invoice-untrusted-values",
    price: 0.01,
    sessionsCount: 999,
  }));
  const secondPackage = store.read(`salons/main/client_packages/${String((second as any).clientPackageId)}`);
  assert.equal(secondPackage?.purchasePrice, 80);
  assert.equal(secondPackage?.totalSessions, 1);
});

test("rejects path injection, oversized operation ids and unsafe adjustments before writes", async () => {
  const { store, handlers, clientPackageId, clientId } = await purchaseOneSessionPackage();
  seedRedemptionDependencies(store);
  await assert.rejects(() => handlers.createPackageRedemptionBooking(request({
    clientId,
    clientPackageId,
    serviceId: "services/other",
    employeeId: "employee-1",
    date: "2026-07-20",
    time: "10:00",
    operationId: "safe",
  })));
  await assert.rejects(() => handlers.createPackageRedemptionBooking(request({
    clientId,
    clientPackageId,
    serviceId: "service-1",
    employeeId: "employee-1",
    date: "2026-07-20",
    time: "10:00",
    operationId: "x".repeat(257),
  })));
  await assert.rejects(() => handlers.adjustClientPackageBalance(request({
    clientPackageId,
    operationId: "adjust-too-large",
    sessionsDelta: 1001,
    reason: "invalid",
  })));
  assert.equal(store.read(`salons/main/client_packages/${clientPackageId}`)?.remainingSessions, 1);
});

test("legacy reserve rejects a booking belonging to a different client", async () => {
  const { store, handlers, clientPackageId, clientId } = await purchaseOneSessionPackage();
  store.seed("salons/main/bookings/booking-other-client", {
    clientId: "another-client",
    serviceId: "service-1",
    status: "pending",
    date: "2026-07-20",
    time: "10:00",
  });
  await assert.rejects(() => handlers.reservePackageSession(request({
    clientId,
    clientPackageId,
    bookingId: "booking-other-client",
  })));
  assert.equal(store.read(`salons/main/client_packages/${clientPackageId}`)?.remainingSessions, 1);
});

test("two concurrent reserve calls cannot reserve the same last session", async () => {
  const { store, handlers, clientPackageId, clientId } = await purchaseOneSessionPackage();
  store.seed("salons/main/bookings/booking-1", {
    clientId,
    serviceId: "service-1",
    status: "pending",
    date: "2026-07-20",
    time: "10:00",
  });
  store.seed("salons/main/bookings/booking-2", {
    clientId,
    serviceId: "service-1",
    status: "pending",
    date: "2026-07-20",
    time: "11:00",
  });

  const results = await Promise.allSettled([
    handlers.reservePackageSession(
      request({ clientId, clientPackageId, bookingId: "booking-1" })
    ),
    handlers.reservePackageSession(
      request({ clientId, clientPackageId, bookingId: "booking-2" })
    ),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  const pkg = store.read(`salons/main/client_packages/${clientPackageId}`);
  assert.equal(pkg?.remainingSessions, 0);
  assert.equal(pkg?.reservedSessions, 1);
});

test("consume is idempotent after booking completion", async () => {
  const { store, handlers, clientPackageId, clientId } = await purchaseOneSessionPackage();
  store.seed("salons/main/bookings/booking-1", { serviceId: "service-1", status: "pending", date: "2026-07-20", time: "10:00" });
  await handlers.reservePackageSession(
    request({ clientId, clientPackageId, bookingId: "booking-1" })
  );
  store.seed("salons/main/bookings/booking-1", {
    ...store.read("salons/main/bookings/booking-1"),
    status: "completed",
  });
  const first = await handlers.consumeReservedPackageSession(request({ bookingId: "booking-1" }));
  const second = await handlers.consumeReservedPackageSession(request({ bookingId: "booking-1" }));
  assert.equal((first as any).idempotent, false);
  assert.equal((second as any).idempotent, true);
  const pkg = store.read(`salons/main/client_packages/${clientPackageId}`);
  assert.equal(pkg?.reservedSessions, 0);
  assert.equal(pkg?.usedSessions, 1);
});

test("restore is idempotent after booking cancellation", async () => {
  const { store, handlers, clientPackageId, clientId } = await purchaseOneSessionPackage();
  store.seed("salons/main/bookings/booking-1", { serviceId: "service-1", status: "pending", date: "2026-07-20", time: "10:00" });
  await handlers.reservePackageSession(
    request({ clientId, clientPackageId, bookingId: "booking-1" })
  );
  store.seed("salons/main/bookings/booking-1", {
    ...store.read("salons/main/bookings/booking-1"),
    status: "cancelled",
  });
  const first = await handlers.restoreReservedPackageSession(
    request({ bookingId: "booking-1", reason: "allowed cancellation" })
  );
  const second = await handlers.restoreReservedPackageSession(
    request({ bookingId: "booking-1", reason: "allowed cancellation" })
  );
  assert.equal((first as any).idempotent, false);
  assert.equal((second as any).idempotent, true);
  const pkg = store.read(`salons/main/client_packages/${clientPackageId}`);
  assert.equal(pkg?.remainingSessions, 1);
  assert.equal(pkg?.reservedSessions, 0);
});

function seedRedemptionDependencies(store: FakeFirestore) {
  store.seed("salons/main/services/service-1", {
    name: "Hair service",
    durationMin: 60,
    price: 100,
    active: true,
  });
  store.seed("salons/main/staff_public/employee-1", {
    name: "Employee",
    active: true,
    isActive: true,
    employmentStatus: "active",
    serviceIds: ["service-1"],
  });
  store.seed("salons/main/settings/app", {
    booking: {
      slotStepMin: 30,
      bufferMin: 0,
      businessHours: {
        mon: { enabled: true, start: "10:00", end: "22:00" },
      },
    },
  });
  store.seed("salons/main/counters/bookings", { next: 10000 });
}

test("create redemption booking locks slots, reserves balance and creates zero invoice atomically", async () => {
  const { store, handlers, clientPackageId, clientId } = await purchaseOneSessionPackage();
  seedRedemptionDependencies(store);
  const result = await handlers.createPackageRedemptionBooking(request({
    clientId,
    clientPackageId,
    serviceId: "service-1",
    employeeId: "employee-1",
    date: "2026-07-20",
    time: "10:00",
    operationId: "device/checkout/1",
  }));
  const bookingId = String((result as any).bookingId);
  const booking = store.read(`salons/main/bookings/${bookingId}`);
  const pkg = store.read(`salons/main/client_packages/${clientPackageId}`);
  assert.equal(booking?.lineType, "package_redemption");
  assert.equal(booking?.total, 0);
  assert.equal(pkg?.remainingSessions, 0);
  assert.equal(pkg?.reservedSessions, 1);
  assert.equal(store.read(`salons/main/invoices/${bookingId}`)?.total, 0);
  assert.ok(store.read(`salons/main/booking_slots/${buildBookingSlotId("main", "2026-07-20", "10:00", "employee-1")}`));
  assert.equal([...store.rows.values()].some((row) => row?.bookingId === bookingId && row?.source === "booking"), false);
});

test("slot conflict leaves package balance unchanged and creates no booking", async () => {
  const { store, handlers, clientPackageId, clientId } = await purchaseOneSessionPackage();
  seedRedemptionDependencies(store);
  const slotId = buildBookingSlotId("main", "2026-07-20", "10:00", "employee-1");
  store.seed(`salons/main/booking_slots/${slotId}`, { bookingId: "another" });
  await assert.rejects(() => handlers.createPackageRedemptionBooking(request({
    clientId,
    clientPackageId,
    serviceId: "service-1",
    employeeId: "employee-1",
    date: "2026-07-20",
    time: "10:00",
    operationId: "conflict/1",
  })));
  const pkg = store.read(`salons/main/client_packages/${clientPackageId}`);
  assert.equal(pkg?.remainingSessions, 1);
  assert.equal(pkg?.reservedSessions, 0);
  assert.equal([...store.rows.keys()].filter((path) => path.includes("/bookings/pkg_")).length, 0);
});

test("two atomic redemption bookings racing for the last session allow one only", async () => {
  const { store, handlers, clientPackageId, clientId } = await purchaseOneSessionPackage();
  seedRedemptionDependencies(store);
  const base = { clientId, clientPackageId, serviceId: "service-1", employeeId: "employee-1", date: "2026-07-20" };
  const results = await Promise.allSettled([
    handlers.createPackageRedemptionBooking(request({ ...base, time: "10:00", operationId: "race/1" })),
    handlers.createPackageRedemptionBooking(request({ ...base, time: "12:00", operationId: "race/2" })),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.equal(store.read(`salons/main/client_packages/${clientPackageId}`)?.reservedSessions, 1);
});

test("appointment after package expiry is rejected without side effects", async () => {
  const { store, handlers, clientPackageId, clientId } = await purchaseOneSessionPackage();
  seedRedemptionDependencies(store);
  store.seed(`salons/main/client_packages/${clientPackageId}`, {
    ...store.read(`salons/main/client_packages/${clientPackageId}`),
    expiresAt: { toMillis: () => Date.parse("2026-07-19T23:59:00+03:00") },
  });
  await assert.rejects(() => handlers.createPackageRedemptionBooking(request({
    clientId,
    clientPackageId,
    serviceId: "service-1",
    employeeId: "employee-1",
    date: "2026-07-20",
    time: "10:00",
    operationId: "expired/1",
  })));
  assert.equal(store.read(`salons/main/client_packages/${clientPackageId}`)?.remainingSessions, 1);
});
