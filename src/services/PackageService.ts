// Package catalog uses the same Packages Worker / D1 source as purchases,
// wallets, session balances, and transaction history.
import {
  PackageOperationsService,
  type PackageCatalogRecord,
} from "./PackageOperationsService";

export type Package = {
  id?: string;
  name: string;
  description?: string;
  serviceIds: string[];
  allowedServiceIds?: string[];
  sessionsCount: number;
  price: number;
  validityDays?: number;
  active: boolean;
  saleEnabled?: boolean;
  imageUrl?: string;
  terms?: string;
  startsAt?: string;
  endsAt?: string;
  audienceScope?: string;
  targetClientIds?: string[];
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
};

export function normalizePackageServiceIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizePackage(raw: Partial<PackageCatalogRecord & Package>): Package {
  const serviceIds = normalizePackageServiceIds(raw.allowedServiceIds || raw.serviceIds || []);
  return {
    id: String(raw.id || "").trim() || undefined,
    name: String(raw.name || "").trim(),
    description: String(raw.description || "").trim() || undefined,
    serviceIds,
    allowedServiceIds: serviceIds,
    sessionsCount: Math.max(1, Number(raw.sessionsCount || 1)),
    price: Math.max(0, Number(raw.price || 0)),
    validityDays: raw.validityDays == null ? undefined : Math.max(1, Math.floor(Number(raw.validityDays))),
    active: raw.active !== false,
    saleEnabled: raw.saleEnabled !== false,
    imageUrl: String(raw.imageUrl || "").trim() || undefined,
    terms: String(raw.terms || "").trim() || undefined,
    startsAt: String(raw.startsAt || "").trim() || undefined,
    endsAt: String(raw.endsAt || "").trim() || undefined,
    audienceScope: String(raw.audienceScope || "all").trim() || "all",
    targetClientIds: normalizePackageServiceIds(raw.targetClientIds || []),
    sortOrder: Math.max(0, Number(raw.sortOrder || 0)),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function toWorkerPayload(item: Partial<Package>): Record<string, unknown> {
  const normalized = normalizePackage(item as Package);
  return {
    ...(normalized.id ? { id: normalized.id } : {}),
    name: normalized.name,
    description: normalized.description,
    serviceIds: normalized.serviceIds,
    allowedServiceIds: normalized.serviceIds,
    sessionsCount: normalized.sessionsCount,
    price: normalized.price,
    validityDays: normalized.validityDays,
    active: normalized.active,
    saleEnabled: normalized.saleEnabled,
    imageUrl: normalized.imageUrl,
    terms: normalized.terms,
    startsAt: normalized.startsAt,
    endsAt: normalized.endsAt,
    audienceScope: normalized.audienceScope,
    targetClientIds: normalized.targetClientIds,
    sortOrder: normalized.sortOrder,
  };
}

export const PackageService = {
  async getAll(): Promise<Package[]> {
    const rows = await PackageOperationsService.listCatalog(true);
    return rows.map(normalizePackage).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name, "ar"));
  },

  async getActive(): Promise<Package[]> {
    const rows = await PackageOperationsService.listCatalog(false);
    return rows.map(normalizePackage).filter((pkg) => pkg.active && pkg.saleEnabled !== false && pkg.name && pkg.serviceIds.length > 0);
  },

  async add(item: Package) {
    await PackageOperationsService.createCatalog(toWorkerPayload(item) as Omit<PackageCatalogRecord, "id"> & { id?: string });
  },

  async update(id: string, patch: Partial<Package>) {
    await PackageOperationsService.updateCatalog(id, toWorkerPayload({ ...patch, id }));
  },

  async remove(id: string) {
    return PackageOperationsService.deleteCatalog(id);
  },
};
