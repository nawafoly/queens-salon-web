import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

const SALON_ID = "main";
const COL_PATH = ["salons", SALON_ID, "packages_catalog"] as const;

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
  createdAt?: any;
  updatedAt?: any;
};

export function normalizePackageServiceIds(values: any): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  values.forEach((value) => {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });

  return out;
}

function collectPackageServiceIds(raw: any): string[] {
  return normalizePackageServiceIds([
    ...(Array.isArray(raw?.allowedServiceIds) ? raw.allowedServiceIds : []),
    ...(Array.isArray(raw?.serviceIds) ? raw.serviceIds : []),
    raw?.serviceId,
  ]);
}

function normalizePackage(raw: any, fallbackId?: string): Package {
  const serviceIds = collectPackageServiceIds(raw);

  return {
    id: String(raw?.id || fallbackId || "").trim() || undefined,
    name: String(raw?.name || "").trim(),
    description: String(raw?.description || "").trim() || undefined,
    serviceIds,
    allowedServiceIds: serviceIds,
    sessionsCount: Math.max(1, Number(raw?.sessionsCount || 1)),
    price: Math.max(0, Number(raw?.price || 0)),
    validityDays:
      raw?.validityDays === undefined || raw?.validityDays === null || raw?.validityDays === ""
        ? undefined
        : Math.max(1, Math.floor(Number(raw.validityDays || 1))),
    active: raw?.active !== false,
    createdAt: raw?.createdAt,
    updatedAt: raw?.updatedAt,
  };
}

async function fetchPackages() {
  try {
    return await getDocs(query(collection(db, ...COL_PATH), orderBy("name", "asc")));
  } catch {
    return getDocs(collection(db, ...COL_PATH));
  }
}

export const PackageService = {
  async getAll(): Promise<Package[]> {
    const snap = await fetchPackages();

    return snap.docs
      .map((d) => normalizePackage({ id: d.id, ...(d.data() as Omit<Package, "id">) }, d.id))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
  },

  async getActive(): Promise<Package[]> {
    const rows = await this.getAll();
    return rows.filter((pkg) => pkg.active !== false && pkg.name && pkg.serviceIds.length > 0);
  },

  async add(item: Package) {
    const normalized = normalizePackage(item);
    await addDoc(collection(db, ...COL_PATH), {
      name: normalized.name,
      ...(normalized.description ? { description: normalized.description } : {}),
      serviceIds: normalized.serviceIds,
      allowedServiceIds: normalized.serviceIds,
      sessionsCount: normalized.sessionsCount,
      price: normalized.price,
      ...(normalized.validityDays ? { validityDays: normalized.validityDays } : {}),
      active: normalized.active !== false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  async update(id: string, patch: Partial<Package>) {
    const payload: Record<string, any> = {
      updatedAt: serverTimestamp(),
    };

    if (Object.prototype.hasOwnProperty.call(patch, "name")) {
      payload.name = String(patch.name || "").trim();
    }

    if (Object.prototype.hasOwnProperty.call(patch, "description")) {
      payload.description = String(patch.description || "").trim();
    }

    if (
      Object.prototype.hasOwnProperty.call(patch, "serviceIds") ||
      Object.prototype.hasOwnProperty.call(patch, "allowedServiceIds")
    ) {
      const serviceIds = collectPackageServiceIds(patch);
      payload.serviceIds = serviceIds;
      payload.allowedServiceIds = serviceIds;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "sessionsCount")) {
      payload.sessionsCount = Math.max(1, Number(patch.sessionsCount || 1));
    }

    if (Object.prototype.hasOwnProperty.call(patch, "price")) {
      payload.price = Math.max(0, Number(patch.price || 0));
    }

    if (Object.prototype.hasOwnProperty.call(patch, "validityDays")) {
      const raw = patch.validityDays;
      payload.validityDays =
        raw === undefined || raw === null
          ? deleteField()
          : Math.max(1, Math.floor(Number(raw || 1)));
    }

    if (Object.prototype.hasOwnProperty.call(patch, "active")) {
      payload.active = patch.active !== false;
    }

    await updateDoc(doc(db, ...COL_PATH, id), payload);
  },

};
