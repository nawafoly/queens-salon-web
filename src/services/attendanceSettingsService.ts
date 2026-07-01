import {
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import { SALON_ID, hrCollection } from "./hrCollections";

export type AttendanceLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
};

export type WorkZone = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  active: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export type WorkZoneMatch = {
  zone: WorkZone;
  distanceMeters: number;
};

function cleanText(v: any) {
  return String(v ?? "").trim();
}

function safeNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toWorkZone(id: string, raw: any): WorkZone {
  return {
    id,
    name: cleanText(raw?.name || raw?.title || id),
    lat: safeNumber(raw?.lat ?? raw?.latitude, 0),
    lng: safeNumber(raw?.lng ?? raw?.longitude, 0),
    radiusMeters: Math.max(10, safeNumber(raw?.radiusMeters ?? raw?.radius, 100)),
    active: raw?.active !== false,
    createdAt: raw?.createdAt,
    updatedAt: raw?.updatedAt,
  };
}

export function buildWorkZoneId(name: string) {
  const normalized = cleanText(name)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/^_+|_+$/g, "");

  return normalized || `zone_${Date.now()}`;
}

export async function listWorkZones(): Promise<WorkZone[]> {
  const snap = await getDocs(hrCollection("workZones"));
  return snap.docs
    .map((entry) => toWorkZone(entry.id, entry.data()))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ar"));
}

export async function listActiveWorkZones(): Promise<WorkZone[]> {
  const zones = await listWorkZones();
  return zones.filter((zone) => zone.active);
}

export async function saveWorkZone(zone: Partial<WorkZone> & { id?: string; name: string }) {
  const id = cleanText(zone.id) || buildWorkZoneId(zone.name);
  const payload = {
    name: cleanText(zone.name) || id,
    lat: safeNumber(zone.lat, 0),
    lng: safeNumber(zone.lng, 0),
    radiusMeters: Math.max(10, safeNumber(zone.radiusMeters, 100)),
    active: zone.active !== false,
    salonId: SALON_ID,
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, "salons", SALON_ID, "work_zones", id), {
    ...payload,
    createdAt: serverTimestamp(),
  }, { merge: true });

  return { id, ...payload } as WorkZone;
}

export async function removeWorkZone(id: string) {
  const cleanId = cleanText(id);
  if (!cleanId) return;
  await deleteDoc(doc(db, "salons", SALON_ID, "work_zones", cleanId));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceMeters(from: AttendanceLocation, to: AttendanceLocation) {
  const earthRadius = 6371000;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadius * c);
}

export function findMatchingWorkZone(
  location: AttendanceLocation,
  zones: WorkZone[]
): WorkZoneMatch | null {
  const matches = zones
    .filter((zone) => zone.active)
    .map((zone) => ({
      zone,
      distanceMeters: distanceMeters(location, { lat: zone.lat, lng: zone.lng }),
    }))
    .filter((match) => match.distanceMeters <= match.zone.radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  return matches[0] || null;
}

export function getBrowserPosition(options?: PositionOptions): Promise<AttendanceLocation> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new Error("الموقع غير مدعوم في هذا المتصفح."));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy || 0),
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error("اسمح بالوصول للموقع حتى يتم تسجيل الحضور."));
          return;
        }
        reject(new Error("تعذر قراءة موقعك الحالي. حاول مرة أخرى."));
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000,
        ...(options || {}),
      }
    );
  });
}
