const DEFAULT_CORE_WORKER_URL = "https://queens-salon-core-api.maedin.workers.dev";

const DISPLAY_FIELDS = [
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
];

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    console.error(`${name} is required.`);
    process.exit(1);
  }
  return value;
}

function baseUrl() {
  return String(
    process.env.CORE_WORKER_URL ||
    process.env.VITE_CORE_WORKER_URL ||
    DEFAULT_CORE_WORKER_URL
  ).trim().replace(/\/+$/, "");
}

function publicRow(row) {
  return Object.fromEntries(DISPLAY_FIELDS.map((field) => [field, row?.[field] ?? ""]));
}

const token = requiredEnv("FIREBASE_ID_TOKEN");
const url = new URL(`${baseUrl()}/api/core/packages/admin/list-client-packages`);
const salonId = String(process.env.SALON_ID || "").trim();
if (salonId) url.searchParams.set("salonId", salonId);

const response = await fetch(url, {
  method: "GET",
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

const body = await response.json().catch(() => ({}));
if (!response.ok || body?.ok === false) {
  const message = body?.message || body?.error || `HTTP ${response.status}`;
  throw new Error(`list-client-packages failed: ${message}`);
}

const rows = (Array.isArray(body?.data) ? body.data : []).map(publicRow);
console.table(rows);
