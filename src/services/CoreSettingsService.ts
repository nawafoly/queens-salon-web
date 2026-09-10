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

const SETTINGS_READ_TTL_MS = 60_000;

type CachedSetting = {
  value: CoreSetting<unknown> | null;
  fetchedAt: number;
};

const settingCache = new Map<string, CachedSetting>();
const settingRequests = new Map<string, Promise<CoreSetting<unknown> | null>>();

function cacheCanServeStale() {
  const pageIsInactive =
    typeof document !== "undefined" && document.visibilityState !== "visible";
  const browserIsOffline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  return pageIsInactive || browserIsOffline;
}

function readCachedSetting<T>(key: string): CoreSetting<T> | null | undefined {
  const cached = settingCache.get(key);
  if (!cached) return undefined;
  const isFresh = Date.now() - cached.fetchedAt < SETTINGS_READ_TTL_MS;
  if (!isFresh && !cacheCanServeStale()) return undefined;
  return cached.value as CoreSetting<T> | null;
}

function cacheSetting<T>(key: string, value: CoreSetting<T> | null) {
  settingCache.set(key, {
    value: value as CoreSetting<unknown> | null,
    fetchedAt: Date.now(),
  });
}

export const CoreSettingsService = {
  list(prefix?: string) {
    return coreApiRequest<CoreSetting[]>("/api/core/settings", { query: { prefix } });
  },
  get<T>(key: string): Promise<CoreSetting<T> | null> {
    const normalizedKey = String(key || "").trim();
    const cached = readCachedSetting<T>(normalizedKey);
    if (cached !== undefined) return Promise.resolve(cached);

    const existing = settingRequests.get(normalizedKey);
    if (existing) return existing as Promise<CoreSetting<T> | null>;

    const request = coreApiRequest<CoreSetting<T> | null>(
      `/api/core/settings/${encodeURIComponent(normalizedKey)}`
    )
      .then((value) => {
        cacheSetting(normalizedKey, value);
        return value;
      })
      .finally(() => {
        settingRequests.delete(normalizedKey);
      });

    settingRequests.set(
      normalizedKey,
      request as Promise<CoreSetting<unknown> | null>
    );
    return request;
  },
  save<T>(key: string, value: T, visibility: "public" | "private" = "private") {
    const normalizedKey = String(key || "").trim();
    return coreApiRequest<CoreSetting<T>>(
      `/api/core/settings/${encodeURIComponent(normalizedKey)}`,
      { method: "PATCH", body: { value, visibility } }
    ).then((saved) => {
      cacheSetting(normalizedKey, saved);
      return saved;
    });
  },
  invalidate(key?: string) {
    const normalizedKey = String(key || "").trim();
    if (normalizedKey) {
      settingCache.delete(normalizedKey);
      return;
    }
    settingCache.clear();
  },
};
