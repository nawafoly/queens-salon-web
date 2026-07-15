export type BookingDataSourceKind = "firestore" | "d1";
export type PackagesDataSourceKind = "legacy-worker" | "d1";

export type DataSourceFlags = {
  useCoreD1: boolean;
  usePackagesD1: boolean;
  coreWorkerUrl: string;
  packagesWorkerUrl: string;
  coreWorkerUrlConfigured: boolean;
  packagesWorkerUrlConfigured: boolean;
};

export type DataSourceDiagnostics = {
  coreSource: BookingDataSourceKind;
  packagesSource: PackagesDataSourceKind;
  coreWorkerUrlConfigured: boolean;
  packagesWorkerUrlConfigured: boolean;
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
  const packagesWorkerUrl = normalizeBaseUrl(envValue("VITE_PACKAGES_WORKER_URL"));

  return {
    useCoreD1: envFlag("VITE_USE_CORE_D1"),
    usePackagesD1: envFlag("VITE_USE_PACKAGES_D1"),
    coreWorkerUrl,
    packagesWorkerUrl,
    coreWorkerUrlConfigured: Boolean(coreWorkerUrl),
    packagesWorkerUrlConfigured: Boolean(packagesWorkerUrl),
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

export function requirePackagesWorkerUrl(): string {
  const flags = getDataSourceFlags();
  if (!flags.packagesWorkerUrl) {
    throw new Error(
      "PACKAGES_D1_CONFIG_ERROR: VITE_USE_PACKAGES_D1=true requires VITE_PACKAGES_WORKER_URL."
    );
  }
  return flags.packagesWorkerUrl;
}

export function getDataSourceDiagnostics(): DataSourceDiagnostics {
  const flags = getDataSourceFlags();
  return {
    coreSource: flags.useCoreD1 ? "d1" : "firestore",
    packagesSource: flags.usePackagesD1 ? "d1" : "legacy-worker",
    coreWorkerUrlConfigured: flags.coreWorkerUrlConfigured,
    packagesWorkerUrlConfigured: flags.packagesWorkerUrlConfigured,
  };
}
