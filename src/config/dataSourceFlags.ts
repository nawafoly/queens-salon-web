export type BookingDataSourceKind = "firestore" | "d1";
export type PackagesDataSourceKind = "legacy-worker" | "d1";

export type DataSourceFlags = {
  useCoreD1: boolean;
  usePackagesD1: boolean;
  useHrD1: boolean;
  useSettingsD1: boolean;
  useR2Files: boolean;
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
  hrSource: BookingDataSourceKind;
  settingsSource: BookingDataSourceKind;
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
  const packagesWorkerUrl = normalizeBaseUrl(envValue("VITE_PACKAGES_WORKER_URL"));

  return {
    useCoreD1: envFlag("VITE_USE_CORE_D1"),
    usePackagesD1: envFlag("VITE_USE_PACKAGES_D1"),
    useHrD1: envFlag("VITE_USE_HR_D1"),
    useSettingsD1: envFlag("VITE_USE_SETTINGS_D1"),
    useR2Files: envFlag("VITE_USE_R2_FILES"),
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
    hrSource: flags.useHrD1 ? "d1" : "firestore",
    settingsSource: flags.useSettingsD1 ? "d1" : "firestore",
    filesSource: flags.useR2Files ? "r2" : "firebase",
  };
}
