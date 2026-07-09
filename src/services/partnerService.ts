import type {
  CreatePartnerContractInput,
  CreatePartnerInput,
  CreatePartnerMemberInput,
  CreateRentalResourceInput,
  Partner,
  PartnerContract,
  PartnerMember,
  RentalResource,
  UpdatePartnerContractInput,
  UpdatePartnerInput,
  UpdatePartnerMemberInput,
  UpdateRentalResourceInput,
} from "../types/partner";
import { auth } from "./firebase";
import {
  PARTNER_API_PATHS,
  PARTNER_SALON_ID,
  getPartnersWorkerBaseUrl,
} from "./partnerCollections";

type ApiErrorPayload = {
  ok?: false;
  error?: string;
  message?: string;
  requestId?: string;
};

type ApiSuccessPayload<T> = {
  ok: true;
  data: T;
  requestId?: string;
};

function requireText(value: unknown, fieldName: string) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`partner_validation:${fieldName}_required`);
  return text;
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

async function readJson(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function partnerApiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("partner_auth:login_required");

  const token = await currentUser.getIdToken();
  const baseUrl = getPartnersWorkerBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  const payload = (await readJson(response)) as
    | ApiSuccessPayload<T>
    | ApiErrorPayload
    | null;

  if (!response.ok) {
    const errorCode = payload && "error" in payload ? payload.error : undefined;
    const errorMessage = payload && "message" in payload ? payload.message : undefined;
    throw new Error(errorCode || errorMessage || `partner_api:http_${response.status}`);
  }

  if (!payload || !("ok" in payload) || payload.ok !== true) {
    throw new Error("partner_api:invalid_response");
  }

  return payload.data;
}

function withSalon(path: string, salonId: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}salonId=${encodeURIComponent(salonId)}`;
}

function sortPartners(items: Partner[]) {
  return [...items].sort((a, b) => a.displayName.localeCompare(b.displayName, "ar"));
}

function sortResources(items: RentalResource[]) {
  return [...items].sort((a, b) => a.code.localeCompare(b.code, "en"));
}

function sortContracts(items: PartnerContract[]) {
  return [...items].sort((a, b) => b.startDate.localeCompare(a.startDate, "en"));
}

function sortMembers(items: PartnerMember[]) {
  return [...items].sort((a, b) => a.displayName.localeCompare(b.displayName, "ar"));
}

export const PartnerService = {
  async listPartners(salonId: string = PARTNER_SALON_ID): Promise<Partner[]> {
    const items = await partnerApiRequest<Partner[]>(
      withSalon(PARTNER_API_PATHS.partners, salonId)
    );
    return sortPartners(items);
  },

  async getPartner(id: string, salonId: string = PARTNER_SALON_ID) {
    const normalizedId = requireText(id, "id");
    return partnerApiRequest<Partner | null>(
      withSalon(`${PARTNER_API_PATHS.partners}/${encodeURIComponent(normalizedId)}`, salonId)
    );
  },

  async createPartner(
    input: CreatePartnerInput,
    _actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const result = await partnerApiRequest<{ id: string }>(PARTNER_API_PATHS.partners, {
      method: "POST",
      body: JSON.stringify({ salonId, partner: stripUndefined(input as unknown as Record<string, unknown>) }),
    });
    return result.id;
  },

  async createPartnerWithOwnerMember(
    input: CreatePartnerInput,
    _actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const result = await partnerApiRequest<{ id: string }>(
      `${PARTNER_API_PATHS.partners}/with-owner`,
      {
        method: "POST",
        body: JSON.stringify({
          salonId,
          partner: stripUndefined(input as unknown as Record<string, unknown>),
        }),
      }
    );
    return result.id;
  },

  async updatePartner(
    id: string,
    patch: UpdatePartnerInput,
    _actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const normalizedId = requireText(id, "id");
    await partnerApiRequest<{ id: string }>(
      `${PARTNER_API_PATHS.partners}/${encodeURIComponent(normalizedId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ salonId, patch }),
      }
    );
  },

  async listRentalResources(
    salonId: string = PARTNER_SALON_ID
  ): Promise<RentalResource[]> {
    const items = await partnerApiRequest<RentalResource[]>(
      withSalon(PARTNER_API_PATHS.rentalResources, salonId)
    );
    return sortResources(items);
  },

  async createRentalResource(
    input: CreateRentalResourceInput,
    _actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const result = await partnerApiRequest<{ id: string }>(
      PARTNER_API_PATHS.rentalResources,
      {
        method: "POST",
        body: JSON.stringify({ salonId, resource: input }),
      }
    );
    return result.id;
  },

  async updateRentalResource(
    id: string,
    patch: UpdateRentalResourceInput,
    _actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const normalizedId = requireText(id, "id");
    await partnerApiRequest<{ id: string }>(
      `${PARTNER_API_PATHS.rentalResources}/${encodeURIComponent(normalizedId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ salonId, patch }),
      }
    );
  },

  async listPartnerContracts(
    salonId: string = PARTNER_SALON_ID
  ): Promise<PartnerContract[]> {
    const items = await partnerApiRequest<PartnerContract[]>(
      withSalon(PARTNER_API_PATHS.partnerContracts, salonId)
    );
    return sortContracts(items);
  },

  async createPartnerContract(
    input: CreatePartnerContractInput,
    _actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const result = await partnerApiRequest<{ id: string }>(
      PARTNER_API_PATHS.partnerContracts,
      {
        method: "POST",
        body: JSON.stringify({ salonId, contract: input }),
      }
    );
    return result.id;
  },

  async updatePartnerContract(
    id: string,
    patch: UpdatePartnerContractInput,
    _actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const normalizedId = requireText(id, "id");
    await partnerApiRequest<{ id: string }>(
      `${PARTNER_API_PATHS.partnerContracts}/${encodeURIComponent(normalizedId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ salonId, patch }),
      }
    );
  },

  async listPartnerMembers(
    salonId: string = PARTNER_SALON_ID
  ): Promise<PartnerMember[]> {
    const items = await partnerApiRequest<PartnerMember[]>(
      withSalon(PARTNER_API_PATHS.partnerMembers, salonId)
    );
    return sortMembers(items);
  },

  async createPartnerMember(
    input: CreatePartnerMemberInput,
    _actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const result = await partnerApiRequest<{ id: string }>(
      PARTNER_API_PATHS.partnerMembers,
      {
        method: "POST",
        body: JSON.stringify({ salonId, member: input }),
      }
    );
    return result.id;
  },

  async updatePartnerMember(
    id: string,
    patch: UpdatePartnerMemberInput,
    _actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const normalizedId = requireText(id, "id");
    await partnerApiRequest<{ id: string }>(
      `${PARTNER_API_PATHS.partnerMembers}/${encodeURIComponent(normalizedId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ salonId, patch }),
      }
    );
  },
};
