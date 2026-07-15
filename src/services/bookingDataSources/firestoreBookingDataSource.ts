// TEMPORARY CUTOVER ADAPTER.
// Remove this source after production cutover to Core D1.
import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
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
