// CORE D1 ONLY — do not add Firestore fallback.
import { coreApiRequest } from "./coreApiClient";

export type CoreSetting<T = unknown> = {
  salon_id: string;
  setting_key: string;
  value_json: string;
  visibility: "public" | "private" | string;
  updated_by_uid?: string | null;
  updated_at: string;
  value: T;
};

export const CoreSettingsService = {
  list(prefix?: string) {
    return coreApiRequest<CoreSetting[]>("/api/core/settings", { query: { prefix } });
  },
  get<T>(key: string) {
    return coreApiRequest<CoreSetting<T> | null>(`/api/core/settings/${encodeURIComponent(key)}`);
  },
  save<T>(key: string, value: T, visibility: "public" | "private" = "private") {
    return coreApiRequest<CoreSetting<T>>(`/api/core/settings/${encodeURIComponent(key)}`, { method: "PATCH", body: { value, visibility } });
  },
};
