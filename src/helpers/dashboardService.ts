// src/helpers/dashboardService.ts
import { db } from "../services/firebase";
import {
  collection,
  doc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { isStaffOperationallyActiveForDate } from "./staffOperationalStatus";


export type BookingStatus = "confirmed" | "pending" | "cancelled" | "completed";

export type Booking = {
  id: string;
  publicId?: string;
  customerName: string;
  phone?: string;
  serviceName: string;
  serviceId?: string;
  serviceSectionName?: string;
  serviceCategoryName?: string;
  employeeName?: string;
  employeeId?: string | null;
  employeeUid?: string | null;
  date: string; // YYYY-MM-DD
  time: string; // "10:00 ص" or "17:30"
  status: BookingStatus;
  total?: number;
  note?: string;
  createdAt: number; // millis
};

export type DashboardStats = {
  employeesCount: number;
  clientsCount: number;
  totalRevenue: number;
  todayBookings: number;
};

const SALON_ID = "main";

// ✅ helpers
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeStatus(status: any): BookingStatus {
  const s = String(status || "").toLowerCase();
  if (s === "confirmed") return "confirmed";
  if (s === "pending") return "pending";
  if (s === "cancelled") return "cancelled";
  if (s === "completed") return "completed";
  return "pending";
}

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (v?.seconds) return Number(v.seconds) * 1000;
  return 0;
}

// ✅ ✅ ✅ أهم تعديل: المسار الصحيح
function bookingsCol() {
  return collection(db, "salons", SALON_ID, "bookings");
}

function mapBookingDoc(id: string, b: any): Booking {
  const serviceId = b.serviceId ?? b.service ?? "";
  const serviceName =
    b.serviceSnapshot?.serviceNameAtBooking ??
    b.serviceName ??
    serviceId ??
    "—";

  const customerName =
    b.clientName ?? b.customerName ?? b.name ?? b.customer ?? "عميلة";

  const phone =
    b.clientPhone ?? b.phone ?? b.customerPhone ?? b.mobile ?? undefined;

  const employeeName = b.employeeName ?? b.employee ?? undefined;

  const date = String(b.date ?? "").trim();
  const time = String(b.time ?? "").trim();

  const status = normalizeStatus(b.status);

  const totalRaw = b.finalPrice ?? b.total;
  const total =
    typeof totalRaw === "number"
      ? totalRaw
      : Number.isFinite(Number(totalRaw))
      ? Number(totalRaw)
      : 0;

  const createdAt =
    toMillis(b.createdAt) || toMillis(b.updatedAt) || Date.now();

  return {
    id,
    publicId: b.publicId ? String(b.publicId) : undefined,
    customerName,
    phone,
    serviceId,
    serviceName,
    serviceSectionName:
      b.serviceSnapshot?.sectionTitleAtBooking ??
      b.sectionTitleAtBooking ??
      b.serviceSectionTitle ??
      undefined,
    serviceCategoryName:
      b.serviceSnapshot?.categoryNameAtBooking ??
      b.categoryNameAtBooking ??
      b.serviceCategoryName ??
      undefined,
    employeeName,
    employeeId: String(b.employeeId ?? "").trim() || null,
    employeeUid: String(b.employeeUid ?? "").trim() || null,
    date,
    time,
    status,
    total,
    note: b.note ?? undefined,
    createdAt,
  };
}

export const DashboardService = {
  migrateBookingsIfNeeded() {
    // no-op
  },

  async getBookings(): Promise<Booking[]> {
    // ✅ orderBy createdAt (ولو ناقص يضبط بعدين بالـ sort)
    const qy = query(bookingsCol(), orderBy("createdAt", "desc"));
    const snaps = await getDocs(qy);

    const rows: Booking[] = [];
    snaps.forEach((d) => rows.push(mapBookingDoc(d.id, d.data())));

    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows;
  },

  async getLatestBookings(limit = 5): Promise<Booking[]> {
    const qy = query(bookingsCol(), orderBy("createdAt", "desc"), fsLimit(limit));
    const snaps = await getDocs(qy);

    const rows: Booking[] = [];
    snaps.forEach((d) => rows.push(mapBookingDoc(d.id, d.data())));

    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows;
  },

  async getStats(): Promise<DashboardStats> {
    const [bookings, staffSnap] = await Promise.all([
      this.getBookings(),
      getDocs(collection(db, "salons", SALON_ID, "staff_public")),
    ]);
    const today = todayISO();

    const todayBookings = bookings.filter((b) => b.date === today).length;
    const totalRevenue = bookings.reduce((sum, b) => sum + (b.total ?? 0), 0);

    const clientKeySet = new Set<string>();
    bookings.forEach((b) => {
      const p = (b.phone || "").trim();
      const n = (b.customerName || "").trim();
      const key = p ? `p:${p}` : `n:${n}`;
      if (key.trim()) clientKeySet.add(key);
    });

    const employeesCount = staffSnap.docs.filter((snap) =>
      isStaffOperationallyActiveForDate({ ...(snap.data() as any), id: snap.id } as any, today)
    ).length;

    return {
      employeesCount,
      clientsCount: clientKeySet.size,
      totalRevenue,
      todayBookings,
    };
  },

  async updateBookingStatus(id: string, status: BookingStatus): Promise<void> {
    if (!id) return;

    // ✅ ✅ ✅ أهم تعديل: doc في salons/main/bookings
    const ref = doc(db, "salons", SALON_ID, "bookings", id);
    await updateDoc(ref, { status });
  },

  async getTodayBookingsCount(): Promise<number> {
    const today = todayISO();
    const qy = query(bookingsCol(), where("date", "==", today));
    const snaps = await getDocs(qy);
    return snaps.size;
  },


  async finalizeClosedDate(closeDate: string): Promise<{ updated: number }> {
    if (!closeDate) return { updated: 0 };

    // ✅ نجيب حجوزات اليوم المحدد فقط
    const qy = query(
      bookingsCol(),
      where("date", "==", closeDate),
      where("status", "in", ["confirmed", "pending"])
    );

    const snaps = await getDocs(qy);

    if (snaps.empty) return { updated: 0 };

    const batch = writeBatch(db);
    let updated = 0;

    snaps.docs.forEach((d) => {
      const s = normalizeStatus(d.data()?.status);

      if (s === "confirmed") {
        batch.update(d.ref, { status: "completed" });
        updated++;
      } else if (s === "pending") {
        batch.update(d.ref, { status: "cancelled" });
        updated++;
      }
    });

    if (updated > 0) {
      await batch.commit();
    }

    return { updated };
  },

};
