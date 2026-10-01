import { coreApiRequest } from "./coreApiClient";

export type CoreInternalBookingDraft<T = Record<string, unknown>> = {
  id: string;
  salon_id: string;
  created_by_uid: string;
  title?: string | null;
  current_step: number;
  draft_json: string;
  draft: T;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export const CoreInternalBookingDraftService = {
  list<T = Record<string, unknown>>() {
    return coreApiRequest<CoreInternalBookingDraft<T>[]>(
      "/api/core/internal-booking-drafts"
    );
  },

  save<T = Record<string, unknown>>(input: {
    id?: string;
    title?: string;
    currentStep: number;
    draft: T;
  }) {
    const id = String(input.id || "").trim();
    return coreApiRequest<CoreInternalBookingDraft<T>>(
      id
        ? `/api/core/internal-booking-drafts/${encodeURIComponent(id)}`
        : "/api/core/internal-booking-drafts",
      {
        method: id ? "PATCH" : "POST",
        body: {
          ...(id ? { id } : {}),
          title: input.title || "",
          currentStep: input.currentStep,
          draft: input.draft as unknown as Record<string, unknown>,
        },
      }
    );
  },

  remove(id: string) {
    return coreApiRequest<{ id: string; deleted: boolean }>(
      `/api/core/internal-booking-drafts/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
  },
};
