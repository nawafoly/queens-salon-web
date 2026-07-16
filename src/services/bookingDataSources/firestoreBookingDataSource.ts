// TEMPORARY CUTOVER ADAPTER.
// Remove this source after production cutover to Core D1.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { normalizeBookedSlotsMap } from "../firestoreAvailabilityDays";
import {
  createBooking,
  createBookingGroup,
  getBookingById,
  listAllBookings,
  updateBookingDetails,
  updateBookingStatus,
} from "../firestoreBookings";
import {
  listActiveCategoriesBySection,
  listActiveSections,
  listActiveServices,
} from "../firestoreCatalog";
import { listActiveStaffAll } from "../firestoreStaffPublic";
import type {
  BookingClientCandidate,
  BookingDataSource,
} from "../bookingDataSource";

const SALON_ID = "main";

function normalizePhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("9665") && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith("5") && digits.length === 9) {
    return `0${digits}`;
  }
  return digits;
}

async function searchClients(
  search: string
): Promise<BookingClientCandidate[]> {
  const value = String(search || "").trim();
  if (!value) return [];

  const phone = normalizePhone(value);
  const output = new Map<string, BookingClientCandidate>();

  for (const collectionName of ["clients", "users"]) {
    const reference = collection(
      db,
      "salons",
      SALON_ID,
      collectionName
    );
    const candidates = phone
      ? [
          query(reference, where("phone", "==", phone), limit(20)),
          query(reference, where("mobile", "==", phone), limit(20)),
        ]
      : [query(reference, limit(100))];

    for (const candidateQuery of candidates) {
      try {
        const snapshot = await getDocs(candidateQuery);
        snapshot.docs.forEach((document) => {
          const raw = document.data() as Record<string, unknown>;
          const name = String(raw.name || raw.fullName || "").trim();
          const mobile = normalizePhone(raw.phone || raw.mobile);
          if (
            !phone &&
            !name.toLowerCase().includes(value.toLowerCase())
          ) {
            return;
          }
          output.set(document.id, {
            id: document.id,
            salonId: SALON_ID,
            name,
            fullName: name,
            phoneNormalized: mobile,
            phone: mobile,
            mobile,
            email: String(raw.email || "") || null,
            firebaseUid:
              String(raw.uid || raw.firebaseUid || "") || null,
            status: String(raw.status || "active"),
            createdAt: "",
            updatedAt: "",
            source: "firestore-transition",
          });
        });
      } catch {
        // Keep searching the remaining legacy collections.
      }
    }
  }

  return [...output.values()].slice(0, 50);
}

export const firestoreBookingDataSource: BookingDataSource = {
  kind: "firestore",

  async getStaffAvailability(input) {
    const staffId = String(input.staffId || "").trim();
    const employeeKey = String(input.employeeKey || "").trim();
    const date = String(input.date || "").trim();
    const takenTimes = new Set<string>();
    const bookedSlots: Record<string, any> = {};

    if (staffId && date) {
      const dayRef = doc(
        db,
        "salons",
        SALON_ID,
        "availability_days",
        date,
        "employees",
        staffId
      );
      const daySnapshot = await getDoc(dayRef);
      if (daySnapshot.exists()) {
        const raw = daySnapshot.data() as Record<string, unknown>;
        if (raw.complete === true) {
          const normalized = normalizeBookedSlotsMap(raw.bookedSlots);
          Object.entries(normalized).forEach(([time, value]) => {
            const key = String(time || "").trim();
            if (!key) return;
            takenTimes.add(key);
            bookedSlots[key] = value;
          });
        }
      }
    }

    if (!takenTimes.size && date && (staffId || employeeKey)) {
      const slots = collection(db, "salons", SALON_ID, "booking_slots");
      let snapshot = staffId
        ? await getDocs(
            query(
              slots,
              where("employeeId", "==", staffId),
              where("date", "==", date),
              limit(500)
            )
          )
        : null;
      if ((!snapshot || snapshot.empty) && employeeKey) {
        snapshot = await getDocs(
          query(
            slots,
            where("employeeKey", "==", employeeKey),
            where("date", "==", date),
            limit(500)
          )
        );
      }
      snapshot?.docs.forEach((row) => {
        const time = String((row.data() as any)?.time || "").trim();
        if (time) takenTimes.add(time);
      });
    }

    if (date && (staffId || employeeKey)) {
      const bookings = collection(db, "salons", SALON_ID, "bookings");
      let snapshot = staffId
        ? await getDocs(
            query(
              bookings,
              where("employeeId", "==", staffId),
              where("date", "==", date),
              limit(250)
            )
          )
        : null;
      if ((!snapshot || snapshot.empty) && employeeKey) {
        snapshot = await getDocs(
          query(
            bookings,
            where("employeeKey", "==", employeeKey),
            where("date", "==", date),
            limit(250)
          )
        );
      }
      snapshot?.docs.forEach((row) => {
        const raw = row.data() as any;
        const status = String(raw.status || "").toLowerCase();
        if (["cancelled", "canceled", "rejected"].includes(status)) return;
        const time = String(raw.time || raw.startTime || "").trim();
        if (!time) return;
        bookedSlots[time] = {
          bookingId: row.id,
          publicId: String(raw.publicId || row.id),
          bookingItemId: "",
          serviceName: String(raw.serviceName || ""),
          clientId: String(raw.userId || ""),
          clientName: String(raw.clientName || raw.name || ""),
          clientPhone: String(raw.clientPhone || raw.phone || ""),
          source: String(raw.channel || raw.source || ""),
          status,
          startTime: time,
          endTime: "",
        };
      });
    }

    return {
      salonId: SALON_ID,
      date,
      weekday: new Date(`${date}T12:00:00.000Z`).getUTCDay(),
      staffId,
      staffName: "",
      active: true,
      showOnBooking: true,
      onLeave: false,
      leaveNote: "",
      availableForDate: true,
      scheduleWindows: [],
      lockedTimes: [...takenTimes].sort(),
      takenTimes: [...takenTimes].sort(),
      bookedSlots,
      bookings: [],
    };
  },

  getServices(sectionId = "", categoryId = null) {
    return listActiveServices(
      { sectionId, categoryId },
      SALON_ID
    );
  },

  getServiceCategories(sectionId = "") {
    return listActiveCategoriesBySection(sectionId, SALON_ID);
  },

  getServiceSections() {
    return listActiveSections(SALON_ID);
  },

  getActiveStaff() {
    return listActiveStaffAll(SALON_ID);
  },

  searchClients,

  async getClient(id) {
    return (await searchClients(id)).find((row) => row.id === id) || null;
  },

  async createClient(input) {
    const phone = normalizePhone(input.phone);
    return {
      id: `pending:${phone || Date.now()}`,
      salonId: SALON_ID,
      name: input.name,
      fullName: input.name,
      phoneNormalized: phone,
      phone,
      mobile: phone,
      email: input.email || null,
      firebaseUid: input.firebaseUid || null,
      status: "active",
      createdAt: "",
      updatedAt: "",
      source: "firestore-booking-write",
    };
  },

  async searchBookings(filters = {}) {
    const rows = await listAllBookings();
    const needle = String(filters.search || "").toLowerCase();
    return rows.filter(
      (row) =>
        (!filters.date || row.date === filters.date) &&
        (!filters.staffId || row.employeeId === filters.staffId) &&
        (!filters.status || row.status === filters.status) &&
        (!needle ||
          [row.id, row.publicId, row.clientName, row.clientPhone].some(
            (value) =>
              String(value || "").toLowerCase().includes(needle)
          ))
    );
  },

  getBooking: getBookingById,
  createBooking,
  createBookingGroup,

  async updateBooking(id, patch) {
    await updateBookingDetails(id, patch);
  },

  async updateBookingStatus(id, status) {
    await updateBookingStatus(id, status);
  },

  async createInvoice() {
    return null;
  },

  async recordPayment() {
    return null;
  },
};
