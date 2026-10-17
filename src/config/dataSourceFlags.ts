export type BookingDataSourceKind = "firestore" | "d1";

export type DataSourceFlags = {
  useCoreD1: boolean;
  useR2Files: boolean;
  coreWorkerUrl: string;
  coreWorkerUrlConfigured: boolean;
};

export type DataSourceDiagnostics = {
  coreSource: BookingDataSourceKind;
  coreWorkerUrlConfigured: boolean;
  filesSource: "firebase" | "r2";
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
  const coreWorkerUrl = normalizeBaseUrl(envValue("VITE_CORE_WORKER_URL"));

  return {
    useCoreD1: envFlag("VITE_USE_CORE_D1"),
    useR2Files: envFlag("VITE_USE_R2_FILES"),
    coreWorkerUrl,
    coreWorkerUrlConfigured: Boolean(coreWorkerUrl),
  };
}

export function requireCoreWorkerUrl(): string {
  const flags = getDataSourceFlags();
  if (!flags.coreWorkerUrl) {
    throw new Error(
      "CORE_D1_CONFIG_ERROR: VITE_USE_CORE_D1=true requires VITE_CORE_WORKER_URL."
    );
  }
  return flags.coreWorkerUrl;
}

export function getDataSourceDiagnostics(): DataSourceDiagnostics {
  const flags = getDataSourceFlags();
  return {
    coreSource: flags.useCoreD1 ? "d1" : "firestore",
    coreWorkerUrlConfigured: flags.coreWorkerUrlConfigured,
    filesSource: flags.useR2Files ? "r2" : "firebase",
  };
}
