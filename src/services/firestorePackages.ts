import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { writeAuditLog } from "./logService";

export type PackageServiceItem = {
  serviceId: string;
  serviceName: string;
  sectionId?: string;
  categoryId?: string;
  price: number;
  durationMin: number;
};

export type ServicePackageDoc = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  active: boolean;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  serviceIds: string[];
  services: PackageServiceItem[];
  baseTotalPrice: number;
  totalDurationMin: number;
  finalPrice: number;
  discountAmount?: number;
  discountPercent?: number;
  warnDiscountOverPercent?: number;
  createdAt?: Timestamp | any;
  updatedAt?: Timestamp | any;
};

const DEFAULT_SALON_ID = "main";

function packagesCol(salonId = DEFAULT_SALON_ID) {
  return collection(db, "salons", salonId, "service_packages");
}

function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

function localISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeDateISO(v: any): string {
  if (!v) return "";

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const datePrefixMatch = s.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
    if (datePrefixMatch?.[1]) return datePrefixMatch[1];
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return localISODate(parsed);
    return "";
  }

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    return localISODate(v);
  }

  if (typeof v?.toDate === "function") {
    return normalizeDateISO(v.toDate());
  }

  if (typeof v?.seconds === "number") {
    return normalizeDateISO(new Date(v.seconds * 1000));
  }

  return "";
}

function normalizePackageItem(raw: any): PackageServiceItem {
  return {
    serviceId: String(raw?.serviceId || "").trim(),
    serviceName: String(raw?.serviceName || "").trim(),
    sectionId: String(raw?.sectionId || "").trim() || undefined,
    categoryId: String(raw?.categoryId || "").trim() || undefined,
    price: Math.max(0, Number(raw?.price || 0)),
    durationMin: Math.max(0, Number(raw?.durationMin || 0)),
  };
}

function normalizePackage(raw: any, id: string): ServicePackageDoc {
  const services: PackageServiceItem[] = Array.isArray(raw?.services)
    ? raw.services.map(normalizePackageItem)
    : [];
  const serviceIds = Array.isArray(raw?.serviceIds)
    ? raw.serviceIds.map((x: any) => String(x || "").trim()).filter(Boolean)
    : services.map((x: PackageServiceItem) => x.serviceId).filter(Boolean);

  const baseTotalPrice = Math.max(
    0,
    Number(
      raw?.baseTotalPrice ??
        services.reduce((sum: number, x: PackageServiceItem) => sum + Number(x.price || 0), 0)
    )
  );
  const totalDurationMin = Math.max(
    0,
    Number(
      raw?.totalDurationMin ??
        services.reduce((sum: number, x: PackageServiceItem) => sum + Number(x.durationMin || 0), 0)
    )
  );
  const finalPrice = Math.max(0, Number(raw?.finalPrice ?? baseTotalPrice));
  const discountAmount = Math.max(0, Number(raw?.discountAmount ?? baseTotalPrice - finalPrice));
  const discountPercent =
    baseTotalPrice > 0
      ? Math.max(0, Number(raw?.discountPercent ?? (discountAmount / baseTotalPrice) * 100))
      : 0;

  return {
    id,
    name: String(raw?.name || "").trim(),
    description: String(raw?.description || "").trim() || undefined,
    imageUrl: String(raw?.imageUrl || "").trim() || undefined,
    active: raw?.active !== false,
    startDate: normalizeDateISO(raw?.startDate) || undefined,
    endDate: normalizeDateISO(raw?.endDate) || undefined,
    serviceIds,
    services,
    baseTotalPrice,
    totalDurationMin,
    finalPrice,
    discountAmount,
    discountPercent,
    warnDiscountOverPercent: Number(raw?.warnDiscountOverPercent || 0) || undefined,
    createdAt: raw?.createdAt,
    updatedAt: raw?.updatedAt,
  };
}

export async function listActivePackages(salonId = DEFAULT_SALON_ID): Promise<ServicePackageDoc[]> {
  const today = localISODate(new Date());
  const isActiveByDate = (x: ServicePackageDoc) => {
    const startOk = !x.startDate || x.startDate <= today;
    const endOk = !x.endDate || x.endDate >= today;
    return startOk && endOk;
  };
  try {
    const snap = await getDocs(query(packagesCol(salonId), orderBy("updatedAt", "desc")));
    return snap.docs
      .map((d) => normalizePackage(d.data(), d.id))
      .filter((x) => x.active && isActiveByDate(x) && x.name && x.serviceIds.length > 0 && x.totalDurationMin > 0);
  } catch {
    const snap = await getDocs(packagesCol(salonId));
    return snap.docs
      .map((d) => normalizePackage(d.data(), d.id))
      .filter((x) => x.active && isActiveByDate(x) && x.name && x.serviceIds.length > 0 && x.totalDurationMin > 0);
  }
}

export async function listAllPackages(salonId = DEFAULT_SALON_ID): Promise<ServicePackageDoc[]> {
  try {
    const snap = await getDocs(query(packagesCol(salonId), orderBy("updatedAt", "desc")));
    return snap.docs.map((d) => normalizePackage(d.data(), d.id));
  } catch {
    const snap = await getDocs(packagesCol(salonId));
    return snap.docs.map((d) => normalizePackage(d.data(), d.id));
  }
}

export async function upsertPackage(pkg: ServicePackageDoc, salonId = DEFAULT_SALON_ID) {
  const id = String(pkg.id || "").trim();
  if (!id) throw new Error("PACKAGE_ID_REQUIRED");

  const services = Array.isArray(pkg.services) ? pkg.services.map(normalizePackageItem) : [];
  const serviceIds = Array.isArray(pkg.serviceIds)
    ? pkg.serviceIds.map((x) => String(x || "").trim()).filter(Boolean)
    : services.map((x) => x.serviceId).filter(Boolean);

  const baseTotalPrice = Math.max(
    0,
    Number(pkg.baseTotalPrice || services.reduce((sum, x) => sum + Number(x.price || 0), 0))
  );
  const totalDurationMin = Math.max(
    0,
    Number(pkg.totalDurationMin || services.reduce((sum, x) => sum + Number(x.durationMin || 0), 0))
  );
  const finalPrice = Math.max(0, Number(pkg.finalPrice || 0));
  const discountAmount = Math.max(0, baseTotalPrice - finalPrice);
  const discountPercent = baseTotalPrice > 0 ? (discountAmount / baseTotalPrice) * 100 : 0;

  const payload = stripUndefined({
    id,
    name: String(pkg.name || "").trim(),
    description: String(pkg.description || "").trim() || undefined,
    imageUrl: String(pkg.imageUrl || "").trim() || undefined,
    active: pkg.active !== false,
    startDate: normalizeDateISO(pkg.startDate) || undefined,
    endDate: normalizeDateISO(pkg.endDate) || undefined,
    serviceIds,
    services,
    baseTotalPrice,
    totalDurationMin,
    finalPrice,
    discountAmount,
    discountPercent,
    warnDiscountOverPercent: Number(pkg.warnDiscountOverPercent || 0) || undefined,
    updatedAt: serverTimestamp(),
    createdAt: pkg.createdAt ?? serverTimestamp(),
  });

  await setDoc(doc(db, "salons", salonId, "service_packages", id), payload as any, { merge: true });

  try {
    await writeAuditLog({
      salonId,
      action: "service_package_upserted",
      entityType: "service_package",
      entityId: id,
      description: "تم حفظ الباكيج",
      source: "dashboard",
      after: {
        id,
        name: String(pkg.name || "").trim(),
        description: String(pkg.description || "").trim() || undefined,
        imageUrl: String(pkg.imageUrl || "").trim() || undefined,
        active: pkg.active !== false,
        startDate: normalizeDateISO(pkg.startDate) || undefined,
        endDate: normalizeDateISO(pkg.endDate) || undefined,
        serviceIds,
        baseTotalPrice,
        totalDurationMin,
        finalPrice,
        discountAmount,
        discountPercent,
      },
    });
  } catch {
    // ignore audit errors
  }
}

export async function removePackage(idRaw: string, salonId = DEFAULT_SALON_ID) {
  const id = String(idRaw || "").trim();
  if (!id) return;
  await deleteDoc(doc(db, "salons", salonId, "service_packages", id));
}
