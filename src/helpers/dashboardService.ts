

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
} from "firebase/firestore";

export type BookingStatus = "confirmed" | "pending" | "cancelled" | "completed";

export type Booking = {
  id: string;
  customerName: string;
  phone?: string;
  serviceName: string;
  serviceId?: string;
  employeeName?: string;
  date: string; // YYYY-MM-DD
  time: string; // e.g. "10:00 ص"
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

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// نفس أسعار Booking (fallback)
function getServicePrice(serviceId: string): number {
  const prices: Record<string, number> = {
    haircut: 75,
    coloring: 150,
    styling: 80,
    treatment: 120,
    makeup: 100,
    nails: 80,
    facial: 120,
    waxing: 60,
  };
  return prices[serviceId] || 0;
}

// نفس أسماء الخدمات في Booking (fallback)
function getServiceName(serviceId: string) {
  const map: Record<string, string> = {
    haircut: "قص الشعر",
    coloring: "صبغة الشعر",
    styling: "تسريحات الشعر",
    treatment: "معالجات الشعر",
    makeup: "مكياج",
    nails: "العناية بالأظافر",
    facial: "العناية بالبشرة",
    waxing: "إزالة الشعر",
  };
  return map[serviceId] || serviceId;
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
  // Firestore Timestamp
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (v?.seconds) return Number(v.seconds) * 1000;
  return 0;
}

function bookingsCol() {
  return collection(db, "bookings");
}

function mapBookingDoc(id: string, b: any): Booking {
  const serviceId = b.serviceId ?? b.service ?? "";
  const serviceName = b.serviceName ?? getServiceName(serviceId);

  const customerName =
    b.clientName ?? b.customerName ?? b.name ?? b.customer ?? "عميلة";

  const phone =
    b.clientPhone ?? b.phone ?? b.customerPhone ?? b.mobile ?? undefined;

  const employeeName = b.employeeName ?? b.employee ?? undefined;

  const date = String(b.date ?? "").trim();
  const time = String(b.time ?? "").trim();

  const status = normalizeStatus(b.status);

  const totalRaw = b.total ?? b.finalPrice;
  const total =
    typeof totalRaw === "number"
      ? totalRaw
      : Number.isFinite(Number(totalRaw))
      ? Number(totalRaw)
      : getServicePrice(serviceId);

  const createdAt =
    toMillis(b.createdAt) || toMillis(b.updatedAt) || Date.now();

  return {
    id,
    customerName,
    phone,
    serviceId,
    serviceName,
    employeeName,
    date,
    time,
    status,
    total,
    note: b.note ?? undefined,
    createdAt,
  };
}

export const DashboardService = {
  /**
   * ✅ Firestore: ما عاد فيه migrate من localStorage
   * نخليها موجودة فقط عشان ما ينكسر أي استدعاء قديم
   */
  migrateBookingsIfNeeded() {
    // no-op
  },

  /**
   * ✅ يجيب كل الحجوزات من Firestore
   * - ملاحظة: async
   */
  async getBookings(): Promise<Booking[]> {
    const qy = query(bookingsCol(), orderBy("createdAt", "desc"));
    const snaps = await getDocs(qy);

    const rows: Booking[] = [];
    snaps.forEach((d) => {
      rows.push(mapBookingDoc(d.id, d.data()));
    });

    // احتياط لو createdAt ناقص
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows;
  },

  /**
   * ✅ آخر حجوزات (limit)
   */
  async getLatestBookings(limit = 5): Promise<Booking[]> {
    const qy = query(bookingsCol(), orderBy("createdAt", "desc"), fsLimit(limit));
    const snaps = await getDocs(qy);

    const rows: Booking[] = [];
    snaps.forEach((d) => rows.push(mapBookingDoc(d.id, d.data())));
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows;
  },

  /**
   * ✅ إحصائيات الداشبورد من Firestore
   */
  async getStats(): Promise<DashboardStats> {
    const bookings = await this.getBookings();
    const today = todayISO();

    const todayBookings = bookings.filter((b) => b.date === today).length;

    const totalRevenue = bookings.reduce((sum, b) => sum + (b.total ?? 0), 0);

    // client count (unique by phone if exists else by name)
    const clientKeySet = new Set<string>();
    bookings.forEach((b) => {
      const p = (b.phone || "").trim();
      const n = (b.customerName || "").trim();
      const key = p ? `p:${p}` : `n:${n}`;
      if (key.trim()) clientKeySet.add(key);
    });

    // employees count (unique by employeeName)
    const empSet = new Set<string>();
    bookings.forEach((b) => {
      const e = (b.employeeName || "").trim();
      if (e) empSet.add(e);
    });

    return {
      employeesCount: empSet.size || 0,
      clientsCount: clientKeySet.size,
      totalRevenue,
      todayBookings,
    };
  },

  /**
   * ✅ تحديث حالة الحجز في Firestore
   */
  async updateBookingStatus(id: string, status: BookingStatus): Promise<void> {
    if (!id) return;

    const ref = doc(db, "bookings", id);
    await updateDoc(ref, { status });
  },

  /**
   * ✅ (اختياري) فلترة حجوزات اليوم مباشرة من Firestore بدون تحميل الكل
   * إذا احتجتها في الداشبورد لاحقًا
   */
  async getTodayBookingsCount(): Promise<number> {
    const today = todayISO();
    const qy = query(bookingsCol(), where("date", "==", today));
    const snaps = await getDocs(qy);
    return snaps.size;
  },
};

