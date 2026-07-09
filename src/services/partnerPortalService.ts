import { auth } from "./firebase";
import { getPartnersWorkerBaseUrl } from "./partnerCollections";
import type {
  PartnerPortalOverview,
  PartnerPortalSession,
} from "../types/partner";

type ApiPayload<T> =
  | { ok: true; data: T; requestId?: string }
  | { ok: false; error?: string; message?: string; requestId?: string };

async function request<T>(path: string): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("partner_auth:login_required");

  const token = await user.getIdToken();
  const response = await fetch(`${getPartnersWorkerBaseUrl()}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  let payload: ApiPayload<T> | null = null;
  try {
    payload = (await response.json()) as ApiPayload<T>;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload || payload.ok !== true) {
    const errorCode = payload && "error" in payload ? payload.error : undefined;
    const message = payload && "message" in payload ? payload.message : undefined;
    throw new Error(errorCode || message || `partner_api:http_${response.status}`);
  }

  return payload.data;
}

export const PartnerPortalService = {
  getSession() {
    return request<PartnerPortalSession>("/api/session");
  },

  getOverview() {
    return request<PartnerPortalOverview>("/api/portal/overview");
  },
};
