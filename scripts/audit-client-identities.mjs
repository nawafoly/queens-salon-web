import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const args = new Set(process.argv.slice(2));
const projectId = process.env.FIREBASE_PROJECT_ID || "waves-hotel-dashboard";
const salonId = process.env.SALON_ID || "main";

if (!process.env.FIRESTORE_EMULATOR_HOST && !args.has("--prod-read")) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}

const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
const db = admin.firestore(app);
const salon = db.collection("salons").doc(salonId);

const RELATION_COLLECTIONS = [
  "client_packages",
  "client_package_transactions",
  "bookings",
  "booking_tracks",
  "invoices",
  "income",
  "payments",
  "loyalty_points",
  "client_notes",
  "client_wallet_transactions",
];

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/\s+/g, " ");
}

function normalizePhone(value) {
  const raw = clean(value);
  if (!raw || /[A-Za-z]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return "";
}

function pickName(raw) {
  return clean(raw.name || raw.fullName || raw.clientName || raw.displayName);
}

function pickPhone(raw) {
  return clean(raw.phone || raw.mobile || raw.clientPhone || raw.phoneNumber);
}

function addGroup(map, key, item) {
  if (!key) return;
  const list = map.get(key) || [];
  list.push(item);
  map.set(key, list);
}

async function readCollection(ref) {
  try {
    const snap = await ref.get();
    return snap.docs.map((doc) => ({ id: doc.id, path: doc.ref.path, data: doc.data() || {} }));
  } catch (error) {
    return { error: clean(error?.message || error), rows: [] };
  }
}

function canonicalScore(client, packageCounts) {
  const data = client.data || {};
  const id = clean(client.id);
  const clientId = clean(data.clientId);
  let score = 0;
  if (id && id === clientId) score += 1000;
  if (clientId) score += 400;
  if (clean(data.authUid || data.uid || data.userId || data.firebaseUid)) score += 250;
  score += Math.min(200, Number(packageCounts.get(clientId || id) || 0) * 20);
  if (clean(data.identityStatus) === "merged") score -= 10000;
  if (clean(data.role) === "owner") score -= 50;
  return score;
}

function chooseCanonical(clients, packageCounts) {
  return [...clients].sort((a, b) => {
    const scoreDiff = canonicalScore(b, packageCounts) - canonicalScore(a, packageCounts);
    if (scoreDiff !== 0) return scoreDiff;
    return clean(a.id).localeCompare(clean(b.id));
  })[0];
}

function summarizeClient(row) {
  const data = row.data || {};
  return {
    id: row.id,
    path: row.path,
    clientId: clean(data.clientId),
    authUid: clean(data.authUid || data.uid || data.userId || data.firebaseUid),
    name: pickName(data),
    phoneNormalized: normalizePhone(pickPhone(data) || data.phoneNormalized || data.normalizedPhone),
    role: clean(data.role),
    identityStatus: clean(data.identityStatus),
  };
}

function groupToReport(key, rows, packageCounts) {
  const canonical = chooseCanonical(rows, packageCounts);
  return {
    key,
    count: rows.length,
    canonicalSuggestion: summarizeClient(canonical),
    records: rows.map(summarizeClient),
  };
}

const clientsRaw = await readCollection(salon.collection("clients"));
const usersRaw = await readCollection(salon.collection("users"));
const rootUsersRaw = await readCollection(db.collection("users"));
const clients = Array.isArray(clientsRaw) ? clientsRaw : [];
const users = Array.isArray(usersRaw) ? usersRaw : [];
const rootUsers = Array.isArray(rootUsersRaw) ? rootUsersRaw : [];

const relationData = {};
for (const collectionName of RELATION_COLLECTIONS) {
  const result = await readCollection(salon.collection(collectionName));
  relationData[collectionName] = Array.isArray(result) ? result : [];
}

const packageCounts = new Map();
for (const row of relationData.client_packages || []) {
  const clientId = clean(row.data?.clientId);
  if (!clientId) continue;
  packageCounts.set(clientId, Number(packageCounts.get(clientId) || 0) + 1);
}

const byPhone = new Map();
const byNormalizedPhone = new Map();
const byAuth = new Map();
const byClientId = new Map();
const byNamePhone = new Map();

for (const row of clients) {
  const data = row.data || {};
  const phoneRaw = pickPhone(data);
  const phoneNormalized = normalizePhone(phoneRaw || data.phoneNormalized || data.normalizedPhone);
  addGroup(byPhone, clean(phoneRaw), row);
  addGroup(byNormalizedPhone, phoneNormalized, row);
  addGroup(byAuth, clean(data.authUid || data.uid || data.userId || data.firebaseUid), row);
  addGroup(byClientId, clean(data.clientId), row);
  addGroup(byNamePhone, `${normalizeName(pickName(data))}|${phoneNormalized}`, row);
}

const duplicatePhones = [...byPhone.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => groupToReport(key, rows, packageCounts));
const duplicateNormalizedPhones = [...byNormalizedPhone.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => groupToReport(key, rows, packageCounts));
const duplicateAuth = [...byAuth.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => groupToReport(key, rows, packageCounts));
const duplicateClientIds = [...byClientId.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => groupToReport(key, rows, packageCounts));
const duplicateNamePhone = [...byNamePhone.entries()].filter(([key, rows]) => key !== "|" && rows.length > 1).map(([key, rows]) => groupToReport(key, rows, packageCounts));

const clientByAnyId = new Map();
for (const row of clients) {
  const data = row.data || {};
  [row.id, data.clientId, data.legacyClientDocId, data.authUid, data.uid, data.userId, data.firebaseUid, data.customerId]
    .map(clean)
    .filter(Boolean)
    .forEach((id) => {
      if (!clientByAnyId.has(id)) clientByAnyId.set(id, []);
      const rows = clientByAnyId.get(id);
      if (!rows.some((existing) => existing.path === row.path)) rows.push(row);
    });
}

function relationIssues(collectionName) {
  return (relationData[collectionName] || [])
    .map((row) => {
      const clientId = clean(row.data?.clientId);
      if (!clientId) return { path: row.path, issue: "missing_clientId" };
      const matches = clientByAnyId.get(clientId) || [];
      if (!matches.length) return { path: row.path, clientId, issue: "client_not_found" };
      if (matches.length > 1) return { path: row.path, clientId, issue: "ambiguous_client_identity", matches: matches.map((m) => m.path) };
      const canonical = chooseCanonical(matches, packageCounts);
      const canonicalId = clean(canonical.data?.clientId || canonical.id);
      if (canonicalId && canonicalId !== clientId) {
        return { path: row.path, clientId, issue: "non_canonical_clientId", canonicalClientId: canonicalId };
      }
      return null;
    })
    .filter(Boolean);
}

const usersClientsConflicts = [...users, ...rootUsers].flatMap((user) => {
  const data = user.data || {};
  const role = clean(data.role);
  const phone = normalizePhone(pickPhone(data) || data.phoneNormalized || data.normalizedPhone);
  const authUid = clean(data.uid || data.authUid || user.id);
  const linkedClientId = clean(data.clientId);
  const matchingClients = [
    ...(authUid ? (byAuth.get(authUid) || []) : []),
    ...(linkedClientId ? (byClientId.get(linkedClientId) || []) : []),
    ...(phone ? (byNormalizedPhone.get(phone) || []) : []),
  ];
  const unique = new Map(matchingClients.map((row) => [row.path, row]));
  if (!unique.size) return [];
  return [{
    userPath: user.path,
    role,
    authUid,
    linkedClientId,
    phoneNormalized: phone,
    matchedClients: [...unique.values()].map(summarizeClient),
    warning: role && role !== "client" ? "non_client_role_shares_identity_fields_do_not_auto_merge" : undefined,
  }];
});

const report = {
  ok: true,
  dryRun: true,
  projectId,
  salonId,
  firestoreHost: process.env.FIRESTORE_EMULATOR_HOST || "production-read",
  counts: {
    clients: clients.length,
    salonUsers: users.length,
    rootUsers: rootUsers.length,
    duplicatePhoneGroups: duplicatePhones.length,
    duplicateNormalizedPhoneGroups: duplicateNormalizedPhones.length,
    duplicateAuthGroups: duplicateAuth.length,
    duplicateClientIdGroups: duplicateClientIds.length,
    duplicateNamePhoneGroups: duplicateNamePhone.length,
    clientsWithoutClientId: clients.filter((row) => !clean(row.data?.clientId)).length,
    affectedRelations: Object.fromEntries(RELATION_COLLECTIONS.map((name) => [name, relationIssues(name).length])),
  },
  duplicatePhones,
  duplicateNormalizedPhones,
  duplicateAuth,
  duplicateClientIds,
  duplicateNamePhone,
  clientsWithoutClientId: clients.filter((row) => !clean(row.data?.clientId)).map(summarizeClient),
  relationIssues: Object.fromEntries(RELATION_COLLECTIONS.map((name) => [name, relationIssues(name)])),
  usersClientsConflicts,
  creationHotspots: [
    "src/components/packages/AdminPackageFlow.tsx:createClientProfile",
    "src/pages/DashboardClients.tsx:clients management",
    "functions/src/packageSubscriptionFunctions.ts:legacy Firebase Functions identity linking",
    "functions/src/index.ts:user/staff account creation paths",
    "scripts/seed-session-packages-emulator.mjs:test data seeding",
  ],
  mergePolicy: {
    automaticMergeAllowedOnlyFor: ["same canonicalClientId", "same authUid/uid", "same clientId"],
    phoneOnly: "manual_review_required; do not merge owner and client automatically by shared phone",
    legacyRecords: "mark duplicate clients with identityStatus=merged and mergedIntoClientId after relations are relinked",
  },
};

console.log(JSON.stringify(report, null, 2));
