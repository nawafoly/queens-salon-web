import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const argv = process.argv.slice(2);
const args = new Set(argv);

function readArg(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || "").trim() : "";
}

const apply = args.has("--apply");
const prodWrite = args.has("--prod-write");
const projectId = process.env.FIREBASE_PROJECT_ID || "waves-hotel-dashboard";
const salonId = process.env.SALON_ID || "main";
const canonicalClientId = readArg("--canonical");
const mergeClientIds = readArg("--merge")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (!process.env.FIRESTORE_EMULATOR_HOST && !prodWrite) {
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

function usage() {
  return {
    command:
      "node scripts/repair-client-identities.mjs --canonical <canonicalClientId> --merge <oldClientId[,oldClientId2]> [--apply] [--prod-write]",
    defaults: {
      dryRun: true,
      firestoreHost: process.env.FIRESTORE_EMULATOR_HOST || "production",
    },
    safety: [
      "No documents are deleted.",
      "No automatic merge is performed from phone-only matches.",
      "Writes require --apply.",
      "Production writes additionally require --prod-write.",
    ],
  };
}

function clean(value) {
  return String(value ?? "").trim();
}

function safeId(value, fieldName) {
  const normalized = clean(value);
  if (!normalized || normalized.includes("/") || normalized === "." || normalized === "..") {
    throw new Error(`${fieldName}:invalid_document_id`);
  }
  return normalized;
}

async function getClientByAnyId(id) {
  const direct = await salon.collection("clients").doc(id).get();
  if (direct.exists) return direct;

  const rows = await salon.collection("clients").where("clientId", "==", id).limit(2).get();
  if (rows.size === 1) return rows.docs[0];
  if (rows.size > 1) throw new Error(`client_identity:ambiguous_clientId:${id}`);

  return null;
}

async function queryRelationsByClientId(collectionName, oldClientId) {
  const snap = await salon.collection(collectionName).where("clientId", "==", oldClientId).get();
  return snap.docs;
}

async function commitChunks(operations) {
  const chunks = [];
  for (let i = 0; i < operations.length; i += 400) chunks.push(operations.slice(i, i + 400));
  for (const chunk of chunks) {
    const batch = db.batch();
    for (const op of chunk) {
      batch.set(op.ref, op.data, { merge: true });
    }
    await batch.commit();
  }
  return chunks.length;
}

const report = {
  ok: false,
  dryRun: !apply,
  projectId,
  salonId,
  firestoreHost: process.env.FIRESTORE_EMULATOR_HOST || "production-write",
  canonicalClientId,
  mergeClientIds,
  plannedRelationUpdates: {},
  plannedClientMarks: [],
  notes: [],
};

try {
  if (!canonicalClientId || !mergeClientIds.length) {
    report.ok = true;
    report.notes.push("Missing --canonical or --merge. No write attempted.");
    report.usage = usage();
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  safeId(canonicalClientId, "canonical");
  mergeClientIds.forEach((id) => safeId(id, "merge"));

  if (mergeClientIds.includes(canonicalClientId)) {
    throw new Error("client_identity:canonical_cannot_merge_into_itself");
  }
  if (apply && !process.env.FIRESTORE_EMULATOR_HOST && !prodWrite) {
    throw new Error("client_identity:production_write_requires_prod_write");
  }

  const canonicalSnap = await getClientByAnyId(canonicalClientId);
  if (!canonicalSnap?.exists) throw new Error("client_identity:canonical_not_found");
  const canonicalData = canonicalSnap.data() || {};
  const stableCanonicalId = clean(canonicalData.clientId || canonicalSnap.id);

  const operations = [];
  for (const oldId of mergeClientIds) {
    const oldSnap = await getClientByAnyId(oldId);
    if (!oldSnap?.exists) {
      report.plannedClientMarks.push({ oldId, status: "missing_skip" });
      continue;
    }

    const oldData = oldSnap.data() || {};
    const actualOldId = clean(oldData.clientId || oldSnap.id || oldId);
    const aliases = [...new Set([oldId, actualOldId, oldSnap.id].map(clean).filter(Boolean))];

    for (const collectionName of RELATION_COLLECTIONS) {
      for (const alias of aliases) {
        const docs = await queryRelationsByClientId(collectionName, alias);
        for (const doc of docs) {
          const key = `${collectionName}:${doc.ref.path}`;
          if (operations.some((op) => op.key === key)) continue;
          const patch = {
            clientId: stableCanonicalId,
            legacyClientId: alias,
            identityRepairedAt: admin.firestore.FieldValue.serverTimestamp(),
            identityRepairedBy: process.env.USERNAME || process.env.USER || "repair-client-identities",
          };
          operations.push({ key, ref: doc.ref, data: patch });
          report.plannedRelationUpdates[collectionName] = Number(report.plannedRelationUpdates[collectionName] || 0) + 1;
        }
      }
    }

    const mark = {
      identityStatus: "merged",
      mergedIntoClientId: stableCanonicalId,
      mergedAt: admin.firestore.FieldValue.serverTimestamp(),
      mergedBy: process.env.USERNAME || process.env.USER || "repair-client-identities",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    operations.push({ key: `client:${oldSnap.ref.path}`, ref: oldSnap.ref, data: mark });
    report.plannedClientMarks.push({
      oldId,
      oldPath: oldSnap.ref.path,
      oldClientId: actualOldId,
      mergedIntoClientId: stableCanonicalId,
    });
  }

  report.plannedWrites = operations.length;
  if (apply) {
    report.committedBatches = await commitChunks(operations);
    report.applied = true;
  } else {
    report.notes.push("Dry-run only. Re-run with --apply after reviewing the audit report and canonical choice.");
    report.applied = false;
  }
  report.ok = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.ok = false;
  report.error = clean(error?.message || error);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
