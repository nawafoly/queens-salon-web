import BookingInternalV2 from "../features/internal-booking-v2/BookingInternalV2";

type BookingInternalProps = {
  /**
   * Kept only for route/API compatibility with the historical component.
   * Booking runtime is intentionally delegated to V2 so there is exactly one
   * internal scheduling/availability implementation.
   */
  internalMode?: boolean;
};

/**
 * Compatibility entry point for the historical internal-booking route.
 *
 * The legacy implementation was removed from runtime because maintaining a
 * second schedule/leave/availability engine violates the Core HR cutover.
 * Both /dashboard/booking-internal and /dashboard/booking-internal-legacy now
 * execute BookingInternalV2, whose dated staff picker and time slots resolve
 * through Core getStaffAvailability -> resolveStaffBookingDay ->
 * resolveEmployeeShift.
 */
export default function BookingInternal(_props: BookingInternalProps) {
  return <BookingInternalV2 />;
}
