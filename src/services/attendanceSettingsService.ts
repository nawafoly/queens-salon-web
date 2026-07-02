import {
  deleteDoc,
  doc,
  getDoc,
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
  branchId?: string;
  branchName?: string;
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

export type AttendanceZoneVerification = WorkZoneMatch & {
  location: AttendanceLocation;
  accuracyMeters?: number;
  maxAllowedAccuracyMeters: number;
};

function cleanText(v: any) {
  return String(v ?? "").trim();
}

function safeNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function assertValidLatLng(lat: number, lng: number) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("خط العرض lat غير صحيح");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error("خط الطول lng غير صحيح");
  }
}

function attachVerificationError(
  message: string,
  data: {
    location?: AttendanceLocation;
    workZoneMatch?: WorkZoneMatch;
    reason: string;
  }
) {
  const error = new Error(message) as Error & {
    location?: AttendanceLocation;
    workZoneMatch?: WorkZoneMatch;
    reason?: string;
  };
  error.location = data.location;
  error.workZoneMatch = data.workZoneMatch;
  error.reason = data.reason;
  return error;
}

function toWorkZone(id: string, raw: any): WorkZone {
  return {
    id,
    name: cleanText(raw?.name || raw?.title || id),
    branchId: cleanText(raw?.branchId) || undefined,
    branchName: cleanText(raw?.branchName) || undefined,
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

export async function getWorkZone(id: string): Promise<WorkZone | null> {
  const cleanId = cleanText(id);
  if (!cleanId) return null;
  const snap = await getDoc(doc(db, "salons", SALON_ID, "work_zones", cleanId));
  return snap.exists() ? toWorkZone(snap.id, snap.data()) : null;
}

export function resolveAssignedAttendanceZoneId(profile: Record<string, any>) {
  const employment = profile?.employeeProfile?.employment || profile?.employment || {};
  const allowedZoneIds = Array.isArray(employment?.allowedZoneIds)
    ? employment.allowedZoneIds
    : Array.isArray(profile?.allowedZoneIds)
      ? profile.allowedZoneIds
      : [];

  return cleanText(
    profile?.allowedAttendanceZoneId ||
    employment?.allowedAttendanceZoneId ||
    profile?.attendanceZoneId ||
    employment?.attendanceZoneId ||
    profile?.assignedAttendanceZoneId ||
    employment?.assignedAttendanceZoneId ||
    profile?.attendanceScopeId ||
    employment?.attendanceScopeId ||
    allowedZoneIds[0] ||
    ""
  );
}

export async function saveWorkZone(zone: Partial<WorkZone> & { id?: string; name: string }) {
  const id = cleanText(zone.id) || buildWorkZoneId(zone.name);

  const name = cleanText(zone.name) || id;
  const lat = safeNumber(zone.lat, 0);
  const lng = safeNumber(zone.lng, 0);
  const radiusMeters = Math.max(10, safeNumber(zone.radiusMeters, 100));
  const branchId = cleanText(zone.branchId);
  const branchName = cleanText(zone.branchName);

  if (!name) {
    throw new Error("اسم النطاق مطلوب.");
  }

  assertValidLatLng(lat, lng);

  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new Error("نصف قطر النطاق غير صحيح.");
  }

  const payload = {
    name,
    lat,
    lng,
    radiusMeters,
    active: zone.active !== false,
    salonId: SALON_ID,
    updatedAt: serverTimestamp(),
    ...(branchId ? { branchId } : {}),
    ...(branchName ? { branchName } : {}),
  };

  await setDoc(
    doc(db, "salons", SALON_ID, "work_zones", id),
    {
      ...payload,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

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
  assertValidLatLng(from.lat, from.lng);
  assertValidLatLng(to.lat, to.lng);

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

export function calculateWorkZoneDistance(location: AttendanceLocation, zone: WorkZone) {
  return distanceMeters(
    { lat: location.lat, lng: location.lng },
    { lat: zone.lat, lng: zone.lng }
  );
}

export async function verifyAssignedWorkZone(args: {
  employeeId: string;
  assignedZoneId: string;
  location: AttendanceLocation;
  maxAllowedAccuracyMeters: number;
}): Promise<AttendanceZoneVerification> {
  const employeeId = cleanText(args.employeeId);
  const assignedZoneId = cleanText(args.assignedZoneId);
  const location = {
    lat: safeNumber(args.location?.lat, NaN),
    lng: safeNumber(args.location?.lng, NaN),
    accuracy: Number.isFinite(Number(args.location?.accuracy))
      ? Math.max(0, Math.round(Number(args.location?.accuracy)))
      : undefined,
  };
  const maxAllowedAccuracyMeters = Math.max(0, Math.round(safeNumber(args.maxAllowedAccuracyMeters, 0)));

  assertValidLatLng(location.lat, location.lng);

  if (!assignedZoneId) {
    throw attachVerificationError("لم يتم تحديد نطاق للموظفة.", {
      location,
      reason: "zone_not_assigned",
    });
  }

  const zone = await getWorkZone(assignedZoneId);
  if (!zone) {
    console.warn("[attendance_zone_check]", {
      employeeId,
      zoneId: assignedZoneId,
      maxAllowedAccuracyMeters,
      reason: "zone_not_found",
    });
    throw attachVerificationError("تعذر قراءة نطاق الحضور المحدد للموظفة.", {
      location,
      reason: "zone_not_found",
    });
  }

  if (!zone.active) {
    console.warn("[attendance_zone_check]", {
      employeeId,
      zoneId: zone.id,
      zoneName: zone.name,
      radiusMeters: zone.radiusMeters,
      maxAllowedAccuracyMeters,
      reason: "zone_inactive",
    });
    throw attachVerificationError("نطاق الحضور المحدد للموظفة غير نشط.", {
      location,
      workZoneMatch: { zone, distanceMeters: calculateWorkZoneDistance(location, zone) },
      reason: "zone_inactive",
    });
  }

  console.warn("[attendance_zone_check_inputs]", {
    employeeLocation: {
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy,
    },
    zoneLocation: {
      lat: zone.lat,
      lng: zone.lng,
    },
    zoneId: zone.id,
    zoneName: zone.name,
    radiusMeters: zone.radiusMeters,
  });

  const workZoneMatch = {
    zone,
    distanceMeters: calculateWorkZoneDistance(location, zone),
  };

  if (workZoneMatch.distanceMeters > zone.radiusMeters) {
    console.warn("[attendance_zone_check]", {
      employeeId,
      zoneId: zone.id,
      zoneName: zone.name,
      distanceMeters: workZoneMatch.distanceMeters,
      accuracyMeters: location.accuracy,
      radiusMeters: zone.radiusMeters,
      maxAllowedAccuracyMeters,
      reason: "outside_radius",
    });
    throw attachVerificationError(
      `أنت خارج نطاق العمل. المسافة ${workZoneMatch.distanceMeters} م والنطاق ${zone.radiusMeters} م`,
      {
        location,
        workZoneMatch,
        reason: "outside_radius",
      }
    );
  }

  if (location.accuracy !== undefined && location.accuracy > maxAllowedAccuracyMeters) {
    console.warn("[attendance_zone_check]", {
      employeeId,
      zoneId: zone.id,
      zoneName: zone.name,
      distanceMeters: workZoneMatch.distanceMeters,
      accuracyMeters: location.accuracy,
      radiusMeters: zone.radiusMeters,
      maxAllowedAccuracyMeters,
      reason: "accuracy_too_low",
    });
    throw attachVerificationError(
      `دقة الموقع غير كافية. الدقة الحالية ${location.accuracy} م والحد المسموح ${maxAllowedAccuracyMeters} م`,
      {
        location,
        workZoneMatch,
        reason: "accuracy_too_low",
      }
    );
  }

  return {
    ...workZoneMatch,
    location,
    accuracyMeters: location.accuracy,
    maxAllowedAccuracyMeters,
  };
}

export async function verifyEmployeeWorkZone(args: {
  employeeId: string;
  profile: Record<string, any>;
  maxAllowedAccuracyMeters: number;
  positionOptions?: PositionOptions;
}) {
  const location = await getBrowserPosition(args.positionOptions);
  const assignedZoneId = resolveAssignedAttendanceZoneId(args.profile);
  return verifyAssignedWorkZone({
    employeeId: args.employeeId,
    assignedZoneId,
    location,
    maxAllowedAccuracyMeters: args.maxAllowedAccuracyMeters,
  });
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
