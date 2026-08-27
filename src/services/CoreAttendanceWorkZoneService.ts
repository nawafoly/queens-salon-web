import { auth } from "./firebase";

const DEFAULT_ATTENDANCE_WORKER_URL = "https://malikat-attendance.maedin.workers.dev";

export type CoreAttendanceWorkZone = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  active: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function workerBaseUrl() {
  return cleanText((import.meta as any).env?.VITE_ATTENDANCE_WORKER_URL || DEFAULT_ATTENDANCE_WORKER_URL).replace(/\/+$/g, "");
}

async function request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("يجب تسجيل الدخول قبل استخدام إعدادات الحضور.");
  const token = await user.getIdToken();
  const response = await fetch(`${workerBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || payload?.ok === false) {
    const error = new Error(cleanText(payload?.message || payload?.detail) || `attendance_worker_${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

function normalizeZone(raw: any): CoreAttendanceWorkZone {
  return {
    id: cleanText(raw?.id),
    name: cleanText(raw?.name || raw?.id),
    lat: Number(raw?.center?.lat ?? raw?.lat ?? 0),
    lng: Number(raw?.center?.lng ?? raw?.lng ?? 0),
    radiusMeters: Math.max(10, Number(raw?.radiusMeters ?? raw?.radius_meters ?? 100) || 100),
    active: raw?.active !== false && raw?.active !== 0,
    createdAt: cleanText(raw?.createdAt ?? raw?.created_at) || null,
    updatedAt: cleanText(raw?.updatedAt ?? raw?.updated_at) || null,
  };
}

export async function listCoreAttendanceWorkZones(): Promise<CoreAttendanceWorkZone[]> {
  const payload = await request<{ zones?: any[] }>("/attendance/work-zones");
  return (Array.isArray(payload?.zones) ? payload.zones : [])
    .map(normalizeZone)
    .filter((zone) => zone.id)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ar"));
}

export async function getCoreAttendanceWorkZone(id: string): Promise<CoreAttendanceWorkZone | null> {
  const cleanId = cleanText(id);
  if (!cleanId) return null;
  return (await listCoreAttendanceWorkZones()).find((zone) => zone.id === cleanId) || null;
}

export async function saveCoreAttendanceWorkZone(zone: CoreAttendanceWorkZone): Promise<CoreAttendanceWorkZone> {
  const id = cleanText(zone.id);
  if (!id) throw new Error("معرف نطاق الحضور مطلوب.");
  const payload = await request<{ zone?: any }>("/attendance/work-zones", {
    method: "POST",
    body: JSON.stringify({
      id,
      name: cleanText(zone.name) || id,
      type: "radius",
      center: { lat: Number(zone.lat), lng: Number(zone.lng) },
      radiusMeters: Number(zone.radiusMeters),
      active: zone.active !== false,
    }),
  });
  return normalizeZone(payload?.zone || zone);
}

export async function deleteCoreAttendanceWorkZone(id: string) {
  const cleanId = cleanText(id);
  if (!cleanId) return;
  try {
    await request(`/attendance/work-zones/${encodeURIComponent(cleanId)}`, { method: "DELETE" });
  } catch (error) {
    if (Number((error as any)?.status) === 404) return;
    throw error;
  }
}
