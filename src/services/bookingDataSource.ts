import type {
  BookingDoc,
  BookingDocWithId,
  BookingStatus,
} from "./firestoreBookings";
import type {
  CategoryDoc,
  SectionDoc,
  ServiceDoc,
} from "./firestoreCatalog";
import type { StaffPublicWithId } from "./firestoreStaffPublic";
import type {
  CoreClient,
  CoreInvoice,
  CorePayment,
} from "../types/coreApi";
import {
  getDataSourceFlags,
  requireCoreWorkerUrl,
} from "../config/dataSourceFlags";
import { firestoreBookingDataSource } from "./bookingDataSources/firestoreBookingDataSource";
import { coreD1BookingDataSource } from "./bookingDataSources/coreD1BookingDataSource";

export type BookingClientCandidate = CoreClient & {
  phone?: string;
  mobile?: string;
  fullName?: string;
  source?: string;
};

export type BookingSearchQuery = {
  date?: string;
  search?: string;
  clientId?: string;
  staffId?: string;
  status?: string;
};

export interface BookingDataSource {
  readonly kind: "firestore" | "d1";
  getServices(
    sectionId?: string,
    categoryId?: string | null
  ): Promise<ServiceDoc[]>;
  getServiceCategories(sectionId?: string): Promise<CategoryDoc[]>;
  getServiceSections(): Promise<SectionDoc[]>;
  getActiveStaff(serviceId?: string): Promise<StaffPublicWithId[]>;
  searchClients(search: string): Promise<BookingClientCandidate[]>;
  getClient(id: string): Promise<BookingClientCandidate | null>;
  createClient(input: {
    name: string;
    phone: string;
    email?: string;
    firebaseUid?: string;
  }): Promise<BookingClientCandidate>;
  searchBookings(query?: BookingSearchQuery): Promise<BookingDocWithId[]>;
  getBooking(id: string): Promise<BookingDocWithId | null>;
  createBooking(
    input: BookingDoc
  ): Promise<{ id: string; publicId: string }>;
  createBookingGroup(input: {
    parent: BookingDoc;
    items: BookingDoc[];
  }): Promise<{
    parentId: string;
    parentPublicId: string;
    itemIds: string[];
  }>;
  updateBooking(id: string, patch: Partial<BookingDoc>): Promise<void>;
  updateBookingStatus(
    id: string,
    status: BookingStatus
  ): Promise<void>;
  createInvoice(
    input: Record<string, unknown>
  ): Promise<CoreInvoice | null>;
  recordPayment(
    input: Record<string, unknown>
  ): Promise<CorePayment | null>;
}

export function resolveBookingDataSource(): BookingDataSource {
  const flags = getDataSourceFlags();
  if (flags.useCoreD1) {
    // Explicit cutover only. Never fall back to Firestore after a D1 failure.
    requireCoreWorkerUrl();
    return coreD1BookingDataSource;
  }
  return firestoreBookingDataSource;
}
