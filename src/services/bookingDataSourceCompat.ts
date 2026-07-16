import type {
  BookingDoc,
  BookingStatus,
} from "./firestoreBookings";
import type {
  CategoryDoc,
  SectionDoc,
  ServiceDoc,
} from "./firestoreCatalog";
import type { StaffPublicWithId } from "./firestoreStaffPublic";
import { resolveBookingDataSource, resolveCoreBookingDataSource } from "./bookingDataSource";
import type { BookingStaffAvailabilityQuery } from "./bookingDataSource";

export type BookingDataSourceMode = "auto" | "core";

function resolveCompatDataSource(mode: BookingDataSourceMode = "auto") {
  return mode === "core" ? resolveCoreBookingDataSource() : resolveBookingDataSource();
}

export function listActiveSections(
  _salonId = "main",
  mode: BookingDataSourceMode = "auto"
): Promise<SectionDoc[]> {
  return resolveCompatDataSource(mode).getServiceSections();
}

export function listActiveCategoriesBySection(
  sectionId: string,
  _salonId = "main",
  mode: BookingDataSourceMode = "auto"
): Promise<CategoryDoc[]> {
  return resolveCompatDataSource(mode).getServiceCategories(sectionId);
}

export function listActiveServices(
  params: { sectionId: string; categoryId?: string | null },
  _salonId = "main",
  mode: BookingDataSourceMode = "auto"
): Promise<ServiceDoc[]> {
  return resolveCompatDataSource(mode).getServices(
    params.sectionId,
    params.categoryId
  );
}

export function listActiveStaffAll(
  _salonId = "main",
  mode: BookingDataSourceMode = "auto"
): Promise<StaffPublicWithId[]> {
  return resolveCompatDataSource(mode).getActiveStaff();
}

export function getStaffAvailability(
  query: BookingStaffAvailabilityQuery,
  mode: BookingDataSourceMode = "auto"
) {
  return resolveCompatDataSource(mode).getStaffAvailability(query);
}

export function createBooking(
  booking: BookingDoc,
  mode: BookingDataSourceMode = "auto"
) {
  return resolveCompatDataSource(mode).createBooking(booking);
}

export function createBookingGroup(input: {
  parent: BookingDoc;
  items: BookingDoc[];
}, mode: BookingDataSourceMode = "auto") {
  return resolveCompatDataSource(mode).createBookingGroup(input);
}

export function updateBookingStatus(
  id: string,
  status: BookingStatus,
  mode: BookingDataSourceMode = "auto"
) {
  return resolveCompatDataSource(mode).updateBookingStatus(id, status);
}

export function updateBookingDetails(
  id: string,
  patch: Partial<BookingDoc>,
  mode: BookingDataSourceMode = "auto"
) {
  return resolveCompatDataSource(mode).updateBooking(id, patch);
}
