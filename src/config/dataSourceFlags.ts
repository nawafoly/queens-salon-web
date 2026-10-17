function envValue(name: string): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {};
  return String(env[name] ?? "").trim();
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function requireCoreWorkerUrl(): string {
  const coreWorkerUrl = normalizeBaseUrl(envValue("VITE_CORE_WORKER_URL"));
  if (!coreWorkerUrl) {
    throw new Error("CORE_D1_CONFIG_ERROR: VITE_CORE_WORKER_URL is required.");
  }
  return coreWorkerUrl;
}
