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
import { resolveBookingDataSource } from "./bookingDataSource";
import type { BookingStaffAvailabilityQuery } from "./bookingDataSource";

export function listActiveSections(
  _salonId = "main"
): Promise<SectionDoc[]> {
  return resolveBookingDataSource().getServiceSections();
}

export function listActiveCategoriesBySection(
  sectionId: string,
  _salonId = "main"
): Promise<CategoryDoc[]> {
  return resolveBookingDataSource().getServiceCategories(sectionId);
}

export function listActiveServices(
  params: { sectionId: string; categoryId?: string | null },
  _salonId = "main"
): Promise<ServiceDoc[]> {
  return resolveBookingDataSource().getServices(
    params.sectionId,
    params.categoryId
  );
}

export function listActiveStaffAll(
  _salonId = "main"
): Promise<StaffPublicWithId[]> {
  return resolveBookingDataSource().getActiveStaff();
}

export function getStaffAvailability(
  query: BookingStaffAvailabilityQuery
) {
  return resolveBookingDataSource().getStaffAvailability(query);
}

export function createBooking(booking: BookingDoc) {
  return resolveBookingDataSource().createBooking(booking);
}

export function createBookingGroup(input: {
  parent: BookingDoc;
  items: BookingDoc[];
}) {
  return resolveBookingDataSource().createBookingGroup(input);
}

export function updateBookingStatus(
  id: string,
  status: BookingStatus
) {
  return resolveBookingDataSource().updateBookingStatus(id, status);
}

export function updateBookingDetails(
  id: string,
  patch: Partial<BookingDoc>
) {
  return resolveBookingDataSource().updateBooking(id, patch);
}
