export const PARTNER_SALON_ID = "main" as const;

export const PARTNER_API_PATHS = {
  partners: "/api/partners",
  rentalResources: "/api/resources",
  partnerContracts: "/api/contracts",
  partnerMembers: "/api/members",
} as const;

const DEFAULT_PARTNERS_WORKER_URL =
  "https://queens-salon-partners-api.maedin.workers.dev";

export function getPartnersWorkerBaseUrl() {
  const configured = String(import.meta.env.VITE_PARTNERS_WORKER_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");

  // During local development, keep the relative /api paths so Vite can proxy
  // them to the local Wrangler process. Production must never fall back to
  // the Vercel origin because Vercel does not host the partners API routes.
  if (import.meta.env.DEV) return "";

  return DEFAULT_PARTNERS_WORKER_URL;
}
