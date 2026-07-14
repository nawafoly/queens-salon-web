import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

const projectId = "waves-hotel-dashboard";
const salonId = "main";
const authHost = "127.0.0.1:9099";
const functionsHost = "127.0.0.1:5001";
const clientId = "test-client-session-001";
const serviceId = "test-blowdry-short";
const employeeId = "test-staff-blowdry";
const packageCatalogId = "test-package-blowdry-10";

const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
const db = admin.firestore(app);
const salon = db.collection("salons").doc(salonId);

function tomorrowISO() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

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
  if (!response.ok) throw new Error(`signIn failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function callFunction(name, data, token) {
  const response = await fetch(`http://${functionsHost}/${projectId}/us-central1/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`${name} failed: ${JSON.stringify(body)}`);
  }
  return body.result ?? body.data;
}

function readBalances(raw) {
  return {
    remaining: Number(raw?.remainingSessions || 0),
    reserved: Number(raw?.reservedSessions || 0),
    used: Number(raw?.usedSessions || 0),
    status: String(raw?.status || ""),
  };
}

async function packageBalances(clientPackageId) {
  const snap = await salon.collection("client_packages").doc(clientPackageId).get();
  if (!snap.exists) throw new Error(`client package missing: ${clientPackageId}`);
  return readBalances(snap.data());
}

const token = await signIn("owner.packages@test.local", "TestOwner123!");
const date = tomorrowISO();

const purchase = await callFunction("purchaseClientPackage", {
  salonId,
  clientId,
  packageCatalogId,
  paymentMethod: "cash",
  invoiceId: "verify-package-sale-001",
}, token);
const clientPackageId = purchase.clientPackageId;

const afterPurchase = await packageBalances(clientPackageId);

const firstBooking = await callFunction("createPackageRedemptionBooking", {
  salonId,
  clientId,
  clientPackageId,
  serviceId,
  employeeId,
  date,
  time: "10:00",
  operationId: "verify-package-booking-001",
}, token);
const afterFirstReserve = await packageBalances(clientPackageId);

await salon.collection("bookings").doc(firstBooking.bookingId).update({
  status: "completed",
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
});
await callFunction("consumeReservedPackageSession", {
  salonId,
  bookingId: firstBooking.bookingId,
}, token);
const afterFirstConsume = await packageBalances(clientPackageId);

const secondBooking = await callFunction("createPackageRedemptionBooking", {
  salonId,
  clientId,
  clientPackageId,
  serviceId,
  employeeId,
  date,
  time: "11:00",
  operationId: "verify-package-booking-002",
}, token);
const afterSecondReserve = await packageBalances(clientPackageId);

await callFunction("cancelPackageRedemptionBooking", {
  salonId,
  bookingId: secondBooking.bookingId,
  reason: "manual_verification_cancel",
}, token);
const afterSecondCancel = await packageBalances(clientPackageId);

console.log(JSON.stringify({
  ok: true,
  clientPackageId,
  invoiceNumber: purchase.invoiceNumber,
  firstBookingId: firstBooking.bookingId,
  secondBookingId: secondBooking.bookingId,
  balances: {
    afterPurchase,
    afterFirstReserve,
    afterFirstConsume,
    afterSecondReserve,
    afterSecondCancel,
  },
}, null, 2));
