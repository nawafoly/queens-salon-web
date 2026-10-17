export type DataSourceFlags = {
  useR2Files: boolean;
  coreWorkerUrl: string;
};

function envValue(name: string): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {};
  return String(env[name] ?? "").trim();
}

function envFlag(name: string): boolean {
  return envValue(name).toLowerCase() === "true";
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getDataSourceFlags(): DataSourceFlags {
  return {
    useR2Files: envFlag("VITE_USE_R2_FILES"),
    coreWorkerUrl: normalizeBaseUrl(envValue("VITE_CORE_WORKER_URL")),
  };
}

export function requireCoreWorkerUrl(): string {
  const flags = getDataSourceFlags();
  if (!flags.coreWorkerUrl) {
    throw new Error("CORE_D1_CONFIG_ERROR: VITE_CORE_WORKER_URL is required.");
  }
  return flags.coreWorkerUrl;
}
