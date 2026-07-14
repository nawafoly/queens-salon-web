import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as admin from "firebase-admin";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { expireClientPackagesInBatches } from "./packageExpiration.js";

const projectId = process.env.GCLOUD_PROJECT || "waves-hotel-dashboard";
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
let rulesEnv: RulesTestEnvironment;
let adminApp: admin.app.App;
let adminDb: admin.firestore.Firestore;

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "FIRESTORE_EMULATOR_HOST is required");
  rulesEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(":").pop() || 8080),
      rules: readFileSync(
        existsSync(resolve(process.cwd(), "firestore.rules"))
          ? resolve(process.cwd(), "firestore.rules")
          : resolve(process.cwd(), "../firestore.rules"),
        "utf8"
      ),
    },
  });
  adminApp = admin.initializeApp({ projectId }, `package-emulator-${Date.now()}`);
  adminDb = adminApp.firestore();
});

after(async () => {
  await rulesEnv?.cleanup();
  if (adminApp) await adminApp.delete();
});

beforeEach(async () => {
  await rulesEnv.clearFirestore();
});

test("security rules reject direct balance and ledger writes for every client role", async () => {
  const unauth = rulesEnv.unauthenticatedContext().firestore();
  const owner = rulesEnv.authenticatedContext("owner-rules", { role: "owner" }).firestore();
  const client = rulesEnv.authenticatedContext("client-rules", { role: "client" }).firestore();
  await assertFails(setDoc(doc(unauth, "salons/main/client_packages/pkg-1"), { remainingSessions: 99 }));
  await assertFails(setDoc(doc(owner, "salons/main/client_packages/pkg-1"), { remainingSessions: 99 }));
  await assertFails(setDoc(doc(owner, "salons/main/client_package_transactions/tx-1"), { type: "reserve" }));
  await assertFails(getDoc(doc(client, "salons/main/client_packages/pkg-1")));

  await rulesEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "salons/main/client_packages/pkg-1"), {
      clientId: "client-1",
      remainingSessions: 1,
    });
  });
  await assertSucceeds(getDoc(doc(owner, "salons/main/client_packages/pkg-1")));
});

test("scheduled expiry query paginates active packages and preserves reserved balances", async () => {
  const packages = adminDb.collection("salons/main/client_packages");
  const past = admin.firestore.Timestamp.fromMillis(Date.now() - 60_000);
  const future = admin.firestore.Timestamp.fromMillis(Date.now() + 60_000);
  await Promise.all([
    packages.doc("expiry-a").set({ status: "active", expiresAt: past, totalSessions: 1, remainingSessions: 1, reservedSessions: 0, usedSessions: 0 }),
    packages.doc("expiry-b").set({ status: "active", expiresAt: past, totalSessions: 1, remainingSessions: 0, reservedSessions: 1, usedSessions: 0 }),
    packages.doc("expiry-future").set({ status: "active", expiresAt: future, totalSessions: 1, remainingSessions: 1, reservedSessions: 0, usedSessions: 0 }),
  ]);
  const result = await expireClientPackagesInBatches({ db: adminDb, salonId: "main", pageSize: 1 });
  assert.equal(result.expiredCount, 2);
  assert.equal((await packages.doc("expiry-a").get()).data()?.status, "expired");
  const reserved = (await packages.doc("expiry-b").get()).data();
  assert.equal(reserved?.status, "expired");
  assert.equal(reserved?.reservedSessions, 1);
  assert.equal((await packages.doc("expiry-future").get()).data()?.status, "active");
});

async function createAuthUser(uid: string, role: string) {
  await adminApp.auth().createUser({ uid, email: `${uid}@example.test`, password: "Test123456!" });
  await adminApp.auth().setCustomUserClaims(uid, { role });
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${uid}@example.test`, password: "Test123456!", returnSecureToken: true }),
    }
  );
  const body = await response.json() as { idToken?: string; error?: unknown };
  assert.equal(response.ok, true, JSON.stringify(body));
  assert.ok(body.idToken);
  return body.idToken;
}

async function callFunction(name: string, data: Record<string, unknown>, token?: string) {
  const response = await fetch(`http://${functionsHost}/${projectId}/us-central1/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const body = await response.json() as { result?: any; data?: any; error?: { status?: string; message?: string } };
  return { response, body, result: body.result ?? body.data };
}

async function seedCallableData() {
  const salon = adminDb.collection("salons").doc("main");
  await Promise.all([
    salon.collection("clients").doc("0555000000").set({ name: "Legacy Client", phone: "0555000000" }),
    salon.collection("packages_catalog").doc("catalog-emulator").set({
      name: "Single session",
      sessionsCount: 1,
      price: 120,
      allowedServiceIds: ["service-emulator"],
      validityDays: 30,
      active: true,
    }),
    salon.collection("services").doc("service-emulator").set({
      name: "Service",
      price: 120,
      durationMin: 30,
      active: true,
    }),
    salon.collection("staff_public").doc("employee-emulator").set({
      name: "Employee",
      active: true,
      isActive: true,
      employmentStatus: "active",
      serviceIds: ["service-emulator"],
    }),
    salon.collection("settings").doc("app").set({
      booking: {
        slotStepMin: 30,
        bufferMin: 0,
        businessHours: Object.fromEntries(
          ["sat", "sun", "mon", "tue", "wed", "thu", "fri"].map((day) => [
            day,
            { enabled: true, start: "09:00", end: "22:00" },
          ])
        ),
      },
    }),
    salon.collection("settings").doc("finance").set({ taxRate: 15, paymentMethods: ["كاش", "شبكة", "تحويل"] }),
    salon.collection("counters").doc("bookings").set({ next: 10000 }),
    salon.collection("counters").doc("invoices").set({ next: 10000 }),
  ]);
}

test("callable auth, purchase idempotency, atomic booking and real transaction concurrency", async () => {
  await seedCallableData();
  const ownerToken = await createAuthUser("owner-emulator", "owner");
  const clientToken = await createAuthUser("client-emulator", "client");

  const anonymous = await callFunction("purchaseClientPackage", {
    clientId: "0555000000", packageCatalogId: "catalog-emulator", invoiceId: "emu-anon",
  });
  assert.equal(anonymous.body.error?.status, "UNAUTHENTICATED");

  const forbidden = await callFunction("purchaseClientPackage", {
    clientId: "0555000000", packageCatalogId: "catalog-emulator", invoiceId: "emu-client",
  }, clientToken);
  assert.equal(forbidden.body.error?.status, "PERMISSION_DENIED");

  const purchase = await callFunction("purchaseClientPackage", {
    clientId: "0555000000",
    packageCatalogId: "catalog-emulator",
    invoiceId: "provider/invoice/emulator/1",
    paymentMethod: "cash",
  }, ownerToken);
  assert.equal(purchase.body.error, undefined, JSON.stringify(purchase.body));
  assert.equal(purchase.result?.idempotent, false);
  const repeated = await callFunction("purchaseClientPackage", {
    clientId: "0555000000",
    packageCatalogId: "catalog-emulator",
    invoiceId: "provider/invoice/emulator/1",
    paymentMethod: "cash",
  }, ownerToken);
  assert.equal(repeated.result?.idempotent, true);
  assert.equal(repeated.result?.clientPackageId, purchase.result?.clientPackageId);

  const purchaseTwo = await callFunction("purchaseClientPackage", {
    clientId: purchase.result.clientId,
    packageCatalogId: "catalog-emulator",
    invoiceId: "provider/invoice/emulator/2",
    paymentMethod: "card",
  }, ownerToken);
  assert.equal(purchaseTwo.body.error, undefined, JSON.stringify(purchaseTwo.body));

  const bookingData = {
    clientId: purchase.result.clientId,
    clientPackageId: purchase.result.clientPackageId,
    serviceId: "service-emulator",
    employeeId: "employee-emulator",
    date: "2026-07-20",
    time: "10:00",
    operationId: "emulator/device/booking/1",
  };
  const booking = await callFunction("createPackageRedemptionBooking", bookingData, ownerToken);
  assert.equal(booking.body.error, undefined, JSON.stringify(booking.body));
  const bookingDoc = await adminDb.doc(`salons/main/bookings/${booking.result.bookingId}`).get();
  const invoiceDoc = await adminDb.doc(`salons/main/invoices/${booking.result.bookingId}`).get();
  assert.equal(bookingDoc.data()?.lineType, "package_redemption");
  assert.equal(invoiceDoc.data()?.total, 0);
  const zeroIncome = await adminDb.collection("salons/main/income").where("bookingId", "==", booking.result.bookingId).get();
  assert.equal(zeroIncome.empty, true);

  const raceBase = {
    clientId: purchaseTwo.result.clientId,
    clientPackageId: purchaseTwo.result.clientPackageId,
    serviceId: "service-emulator",
    employeeId: "employee-emulator",
    date: "2026-07-20",
  };
  const race = await Promise.all([
    callFunction("createPackageRedemptionBooking", { ...raceBase, time: "12:00", operationId: "race/emulator/1" }, ownerToken),
    callFunction("createPackageRedemptionBooking", { ...raceBase, time: "13:00", operationId: "race/emulator/2" }, ownerToken),
  ]);
  assert.equal(race.filter((item) => !item.body.error).length, 1);
  assert.equal(race.filter((item) => item.body.error?.status === "FAILED_PRECONDITION").length, 1);
  const finalPackage = await adminDb.doc(`salons/main/client_packages/${purchaseTwo.result.clientPackageId}`).get();
  assert.equal(finalPackage.data()?.remainingSessions, 0);
  assert.equal(finalPackage.data()?.reservedSessions, 1);
});

function futureDate(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Riyadh",
  });
}

async function purchaseFor(token: string, invoiceId: string, extra: Record<string, unknown> = {}) {
  const result = await callFunction("purchaseClientPackage", {
    clientId: "0555000000",
    packageCatalogId: "catalog-emulator",
    invoiceId,
    paymentMethod: "cash",
    ...extra,
  }, token);
  assert.equal(result.body.error, undefined, JSON.stringify(result.body));
  return result.result;
}

test("purchase trusts catalog values, preserves snapshots and keeps UUID identity after phone changes", async () => {
  await seedCallableData();
  const token = await createAuthUser("owner-catalog-security", "owner");
  const first = await purchaseFor(token, "security/catalog/1", { price: 0.01, sessionsCount: 999 });
  const packageRef = adminDb.doc(`salons/main/client_packages/${first.clientPackageId}`);
  const firstPackage = (await packageRef.get()).data();
  assert.equal(firstPackage?.purchasePrice, 120);
  assert.equal(firstPackage?.totalSessions, 1);

  await adminDb.doc("salons/main/packages_catalog/catalog-emulator").update({
    name: "Changed package",
    price: 999,
    sessionsCount: 9,
  });
  await adminDb.doc("salons/main/clients/0555000000").update({ phone: "0555999999" });
  const secondCall = await callFunction("purchaseClientPackage", {
    clientId: first.clientId,
    packageCatalogId: "catalog-emulator",
    invoiceId: "security/catalog/2",
  }, token);
  assert.equal(secondCall.body.error, undefined, JSON.stringify(secondCall.body));
  assert.equal(secondCall.result.clientId, first.clientId);
  assert.equal((await packageRef.get()).data()?.packageNameSnapshot, "Single session");
  assert.equal((await packageRef.get()).data()?.purchasePrice, 120);
});

test("redemption rejects excluded services and unavailable employees without partial writes", async () => {
  await seedCallableData();
  const token = await createAuthUser("owner-redemption-security", "owner");
  const purchase = await purchaseFor(token, "security/redemption/1");
  await adminDb.doc("salons/main/services/service-other").set({
    name: "Other service", price: 50, durationMin: 30, active: true,
  });
  await adminDb.doc("salons/main/staff_public/employee-emulator").update({
    serviceIds: ["service-emulator", "service-other"],
  });
  const base = {
    clientId: purchase.clientId,
    clientPackageId: purchase.clientPackageId,
    employeeId: "employee-emulator",
    date: futureDate(),
    time: "10:00",
  };
  const excluded = await callFunction("createPackageRedemptionBooking", {
    ...base, serviceId: "service-other", operationId: "security/excluded",
  }, token);
  assert.equal(excluded.body.error?.status, "FAILED_PRECONDITION");

  await adminDb.doc("salons/main/staff_public/employee-emulator").update({ active: false });
  const unavailable = await callFunction("createPackageRedemptionBooking", {
    ...base, serviceId: "service-emulator", operationId: "security/unavailable",
  }, token);
  assert.equal(unavailable.body.error?.status, "FAILED_PRECONDITION");
  const packageDoc = (await adminDb.doc(`salons/main/client_packages/${purchase.clientPackageId}`).get()).data();
  assert.equal(packageDoc?.remainingSessions, 1);
  assert.equal(packageDoc?.reservedSessions, 0);
  assert.equal((await adminDb.collection("salons/main/bookings").get()).empty, true);
});

test("same-slot race and repeated booking leave one lock and consistent balances", async () => {
  await seedCallableData();
  const token = await createAuthUser("owner-slot-race", "owner");
  const first = await purchaseFor(token, "security/slot/1");
  const second = await purchaseFor(token, "security/slot/2");
  const date = futureDate();
  const base = {
    clientId: first.clientId,
    serviceId: "service-emulator",
    employeeId: "employee-emulator",
    date,
    time: "11:00",
  };
  const race = await Promise.all([
    callFunction("createPackageRedemptionBooking", {
      ...base, clientPackageId: first.clientPackageId, operationId: "security/slot-race/1",
    }, token),
    callFunction("createPackageRedemptionBooking", {
      ...base, clientPackageId: second.clientPackageId, operationId: "security/slot-race/2",
    }, token),
  ]);
  assert.equal(race.filter((item) => !item.body.error).length, 1);
  assert.equal(race.filter((item) => item.body.error?.status === "ALREADY_EXISTS").length, 1);
  const winner = race.find((item) => !item.body.error)!;
  const repeated = await callFunction("createPackageRedemptionBooking", {
    ...base,
    clientPackageId: winner.result.clientPackageId,
    operationId: winner.result.clientPackageId === first.clientPackageId
      ? "security/slot-race/1"
      : "security/slot-race/2",
  }, token);
  assert.equal(repeated.result?.idempotent, true);
  assert.equal((await adminDb.collection("salons/main/booking_slots").get()).size, 1);
  const packageDocs = await Promise.all([
    adminDb.doc(`salons/main/client_packages/${first.clientPackageId}`).get(),
    adminDb.doc(`salons/main/client_packages/${second.clientPackageId}`).get(),
  ]);
  assert.equal(packageDocs.reduce((sum, item) => sum + Number(item.data()?.reservedSessions || 0), 0), 1);
  assert.equal(packageDocs.reduce((sum, item) => sum + Number(item.data()?.remainingSessions || 0), 0), 1);
});

test("consume, cancellation, no-show and administrative restore are idempotent", async () => {
  await seedCallableData();
  const token = await createAuthUser("owner-lifecycle", "owner");
  const date = futureDate();

  const consumedPurchase = await purchaseFor(token, "security/lifecycle/consume");
  const consumedBooking = await callFunction("createPackageRedemptionBooking", {
    clientId: consumedPurchase.clientId,
    clientPackageId: consumedPurchase.clientPackageId,
    serviceId: "service-emulator",
    employeeId: "employee-emulator",
    date,
    time: "12:00",
    operationId: "security/lifecycle/consume-booking",
  }, token);
  await adminDb.doc(`salons/main/bookings/${consumedBooking.result.bookingId}`).update({ status: "completed" });
  const consumeOne = await callFunction("consumeReservedPackageSession", {
    bookingId: consumedBooking.result.bookingId,
  }, token);
  const consumeTwo = await callFunction("consumeReservedPackageSession", {
    bookingId: consumedBooking.result.bookingId,
  }, token);
  assert.equal(consumeOne.result?.idempotent, false);
  assert.equal(consumeTwo.result?.idempotent, true);

  const restoreOne = await callFunction("adminRestoreConsumedPackageSession", {
    bookingId: consumedBooking.result.bookingId,
    operationId: "security/lifecycle/admin-restore",
    reason: "verified correction",
  }, token);
  const restoreTwo = await callFunction("adminRestoreConsumedPackageSession", {
    bookingId: consumedBooking.result.bookingId,
    operationId: "security/lifecycle/admin-restore",
    reason: "verified correction",
  }, token);
  assert.equal(restoreOne.result?.idempotent, false);
  assert.equal(restoreTwo.result?.idempotent, true);

  const cancelPurchase = await purchaseFor(token, "security/lifecycle/cancel");
  const cancelBooking = await callFunction("createPackageRedemptionBooking", {
    clientId: cancelPurchase.clientId,
    clientPackageId: cancelPurchase.clientPackageId,
    serviceId: "service-emulator",
    employeeId: "employee-emulator",
    date,
    time: "14:00",
    operationId: "security/lifecycle/cancel-booking",
  }, token);
  const cancelOne = await callFunction("cancelPackageRedemptionBooking", {
    bookingId: cancelBooking.result.bookingId,
    reason: "client request",
  }, token);
  const cancelTwo = await callFunction("cancelPackageRedemptionBooking", {
    bookingId: cancelBooking.result.bookingId,
    reason: "client request",
  }, token);
  assert.equal(cancelOne.result?.idempotent, false);
  assert.equal(cancelTwo.result?.idempotent, true);

  const noShowPurchase = await purchaseFor(token, "security/lifecycle/no-show");
  const noShowBooking = await callFunction("createPackageRedemptionBooking", {
    clientId: noShowPurchase.clientId,
    clientPackageId: noShowPurchase.clientPackageId,
    serviceId: "service-emulator",
    employeeId: "employee-emulator",
    date,
    time: "16:00",
    operationId: "security/lifecycle/no-show-booking",
  }, token);
  const noShowOne = await callFunction("markPackageRedemptionNoShow", {
    bookingId: noShowBooking.result.bookingId,
    reason: "did not attend",
  }, token);
  const noShowTwo = await callFunction("markPackageRedemptionNoShow", {
    bookingId: noShowBooking.result.bookingId,
    reason: "did not attend",
  }, token);
  assert.equal(noShowOne.result?.action, "consume");
  assert.equal(noShowTwo.result?.idempotent, true);
});

test("late cancellation consumes and a valid reservation can complete after package expiry", async () => {
  await seedCallableData();
  const token = await createAuthUser("owner-expiry-policy", "owner");
  const date = futureDate(6);
  await adminDb.doc("salons/main/settings/package_subscriptions").set({
    lateCancellationWindowMinutes: 7 * 24 * 60,
    lateCancellationConsumesSession: true,
    noShowConsumesSession: true,
  });

  const latePurchase = await purchaseFor(token, "security/policy/late");
  const lateBooking = await callFunction("createPackageRedemptionBooking", {
    clientId: latePurchase.clientId,
    clientPackageId: latePurchase.clientPackageId,
    serviceId: "service-emulator",
    employeeId: "employee-emulator",
    date,
    time: "10:00",
    operationId: "security/policy/late-booking",
  }, token);
  const lateCancel = await callFunction("cancelPackageRedemptionBooking", {
    bookingId: lateBooking.result.bookingId,
    reason: "inside configured late window",
  }, token);
  assert.equal(lateCancel.result?.action, "consume");

  const expiryPurchase = await purchaseFor(token, "security/policy/expiry");
  const expiryBooking = await callFunction("createPackageRedemptionBooking", {
    clientId: expiryPurchase.clientId,
    clientPackageId: expiryPurchase.clientPackageId,
    serviceId: "service-emulator",
    employeeId: "employee-emulator",
    date,
    time: "12:00",
    operationId: "security/policy/expiry-booking",
  }, token);
  assert.equal(expiryBooking.body.error, undefined, JSON.stringify(expiryBooking.body));
  await adminDb.doc(`salons/main/client_packages/${expiryPurchase.clientPackageId}`).update({
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60_000),
    status: "expired",
  });
  await adminDb.doc(`salons/main/bookings/${expiryBooking.result.bookingId}`).update({ status: "completed" });
  const completion = await callFunction("consumeReservedPackageSession", {
    bookingId: expiryBooking.result.bookingId,
  }, token);
  assert.equal(completion.body.error, undefined, JSON.stringify(completion.body));
  const expiredPackage = (await adminDb.doc(
    `salons/main/client_packages/${expiryPurchase.clientPackageId}`
  ).get()).data();
  assert.equal(expiredPackage?.status, "expired");
  assert.equal(expiredPackage?.reservedSessions, 0);
  assert.equal(expiredPackage?.usedSessions, 1);
});
