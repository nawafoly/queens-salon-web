import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

const projectId = "waves-hotel-dashboard";
const salonId = "main";
const ownerUid = "test-owner-packages";
const clientUid = "test-client-auth-001";
const clientId = "test-client-session-001";
const clientPhone = "0500000001";
const staffId = "test-staff-blowdry";
const serviceIds = ["test-blowdry-short", "test-blowdry-long"];
const packageCatalogId = "test-package-blowdry-10";

const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
const db = admin.firestore(app);
const auth = admin.auth(app);
const salon = db.collection("salons").doc(salonId);

async function upsertAuthUser({ uid, email, password, displayName, role }) {
  try {
    await auth.updateUser(uid, { email, password, displayName, disabled: false });
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    await auth.createUser({ uid, email, password, displayName, disabled: false });
  }
  await auth.setCustomUserClaims(uid, { role });
}

async function deleteQuery(querySnapshot) {
  const refs = querySnapshot.docs.map((doc) => doc.ref);
  for (let i = 0; i < refs.length; i += 450) {
    const batch = db.batch();
    refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

async function cleanupTestRun() {
  await Promise.all([
    deleteQuery(await salon.collection("client_packages").where("clientId", "==", clientId).get()),
    deleteQuery(await salon.collection("client_package_transactions").where("clientId", "==", clientId).get()),
    deleteQuery(await salon.collection("bookings").where("clientId", "==", clientId).get()),
    deleteQuery(await salon.collection("booking_tracks").where("clientId", "==", clientId).get()),
    deleteQuery(await salon.collection("booking_slots").where("clientId", "==", clientId).get()),
    deleteQuery(await salon.collection("invoices").where("clientId", "==", clientId).get()),
    deleteQuery(await salon.collection("income").where("clientPhone", "==", clientPhone).get()),
  ]);
}

await cleanupTestRun();

await Promise.all([
  upsertAuthUser({
    uid: ownerUid,
    email: "owner.packages@test.local",
    password: "TestOwner123!",
    displayName: "مالك اختبار الباقات",
    role: "owner",
  }),
  upsertAuthUser({
    uid: clientUid,
    email: "client.packages@test.local",
    password: "TestClient123!",
    displayName: "عميلة اختبار الباقات",
    role: "client",
  }),
]);

const allDays = Object.fromEntries(
  ["sat", "sun", "mon", "tue", "wed", "thu", "fri"].map((day) => [
    day,
    { enabled: true, start: "09:00", end: "22:00" },
  ])
);

await Promise.all([
  salon.collection("users").doc(ownerUid).set({
    uid: ownerUid,
    email: "owner.packages@test.local",
    name: "مالك اختبار الباقات",
    displayName: "مالك اختبار الباقات",
    role: "owner",
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
  salon.collection("users").doc(clientUid).set({
    uid: clientUid,
    email: "client.packages@test.local",
    name: "عميلة اختبار الباقات",
    displayName: "عميلة اختبار الباقات",
    phone: clientPhone,
    clientId,
    role: "client",
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
  salon.collection("clients").doc(clientId).set({
    clientId,
    authUid: clientUid,
    name: "عميلة اختبار الباقات",
    phone: clientPhone,
    normalizedPhone: clientPhone,
    source: "emulator-test",
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
  salon.collection("service_sections").doc("test-hair").set({
    name: "اختبار - الشعر",
    title: "اختبار - الشعر",
    active: true,
    order: 1,
  }, { merge: true }),
  salon.collection("service_categories").doc("test-blowdry").set({
    name: "اختبار - الاستشوار",
    title: "اختبار - الاستشوار",
    sectionId: "test-hair",
    active: true,
    order: 1,
  }, { merge: true }),
  salon.collection("services").doc("test-blowdry-short").set({
    name: "اختبار - استشوار قصير",
    title: "اختبار - استشوار قصير",
    sectionId: "test-hair",
    categoryId: "test-blowdry",
    price: 60,
    durationMin: 30,
    active: true,
    order: 1,
  }, { merge: true }),
  salon.collection("services").doc("test-blowdry-long").set({
    name: "اختبار - استشوار طويل",
    title: "اختبار - استشوار طويل",
    sectionId: "test-hair",
    categoryId: "test-blowdry",
    price: 80,
    durationMin: 45,
    active: true,
    order: 2,
  }, { merge: true }),
  salon.collection("packages_catalog").doc(packageCatalogId).set({
    name: "باقة استشوار تجريبية",
    description: "10 جلسات استشوار للاختبار المحلي",
    sessionsCount: 10,
    price: 300,
    validityDays: 365,
    serviceIds,
    allowedServiceIds: serviceIds,
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
  salon.collection("staff_public").doc(staffId).set({
    name: "موظفة اختبار الاستشوار",
    active: true,
    isActive: true,
    showOnBooking: true,
    employmentStatus: "active",
    serviceIds,
    specialties: serviceIds,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
  salon.collection("settings").doc("app").set({
    booking: { slotStepMin: 30, bufferMin: 0, businessHours: allDays },
  }, { merge: true }),
  salon.collection("settings").doc("finance").set({
    taxRate: 15,
    paymentMethods: ["كاش", "شبكة", "تحويل"],
  }, { merge: true }),
  salon.collection("settings").doc("package_subscriptions").set({
    active: true,
    cancellationConsumesSession: false,
    lateCancellationConsumesSession: false,
    noShowConsumesSession: true,
    lateCancellationWindowHours: 0,
  }, { merge: true }),
  salon.collection("counters").doc("bookings").set({ next: 10000 }, { merge: true }),
  salon.collection("counters").doc("invoices").set({ next: 10000 }, { merge: true }),
]);

console.log(JSON.stringify({
  ok: true,
  owner: "owner.packages@test.local / TestOwner123!",
  client: "client.packages@test.local / TestClient123!",
  clientId,
  clientPhone,
  packageCatalogId,
  services: serviceIds,
  staffId,
}, null, 2));
