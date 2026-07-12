export const PARTNER_SALON_ID = "main" as const;

export const PARTNER_API_PATHS = {
  partners: "/api/partners",
  rentalResources: "/api/resources",
  partnerContracts: "/api/contracts",
  partnerMembers: "/api/members",
} as const;

export function getPartnersWorkerBaseUrl() {
  const configured = String(import.meta.env.VITE_PARTNERS_WORKER_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return "";
}
