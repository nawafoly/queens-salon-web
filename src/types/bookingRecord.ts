// Canonical booking DTO contracts consumed by MALIKAT Core booking flows.
import type { Timestamp } from "firebase/firestore";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type BookingChannel = "client" | "dashboard" | "internal";
export type BookingPaymentMethod = "cash" | "card" | "transfer" | "mixed";
export type BookingPaymentType = "full" | "partial" | "none";
export type BookingPaymentBreakdown = {
  cash?: number;
  card?: number;
  transfer?: number;
};

export type ServiceSnapshot = {
  serviceNameAtBooking: string;
  priceAtBooking: number;
  durationAtBooking: number;
  sectionIdAtBooking?: string;
  sectionTitleAtBooking?: string;
  categoryIdAtBooking?: string;
  categoryNameAtBooking?: string;
};

export type PackageServiceSnapshot = {
  serviceId: string;
  serviceName: string;
  sectionId?: string;
  categoryId?: string;
  price: number;
  durationMin: number;
};

export type PackageSnapshot = {
  packageId: string;
  packageName: string;
  finalPriceAtBooking: number;
  baseTotalPriceAtBooking: number;
  totalDurationMinAtBooking: number;
  serviceIds: string[];
  services: PackageServiceSnapshot[];
  sessionsCount?: number;
  kind?: "service_package" | "session_package";
};

export type BookingDoc = {
  /**
   * Canonical client id in Core D1. Internal/dashboard bookings must pass this
   * when an existing client was selected so the booking is attached to the
   * exact same account shown in the client portal.
   */
  clientId?: string | null;

  /** Firebase Auth UID for the client account, never the staff creator UID. */
  clientFirebaseUid?: string | null;

  /**
   * Administrative party booking metadata. Every booking still owns one
   * canonical client; these fields only group bookings created in one checkout.
   */
  partyId?: string | null;
  partyLeadClientId?: string | null;
  partyMemberOrder?: number | null;
  partySize?: number | null;

  userId?: string | null;

  slotStepMinAtBooking?: number;
  bufferMinAtBooking?: number;

  createdBy: string;
  createdByUid?: string | null;
  createdByEmail?: string | null;
  createdByName?: string | null;
  channel: BookingChannel;

  clientName: string;
  clientPhone: string;
  /** Client identity email, distinct from staff/actor email fields. */
  clientEmail?: string | null;

  /**
   * ✅ legacy (نتركه للتوافق)
   * قد يكون اسم أو serviceId في الداتا القديمة
   */
  serviceName: string;

  /**
   * ✅ NEW (ID-first)
   */
  serviceId?: string;
  serviceSnapshot?: ServiceSnapshot;
  packageId?: string;
  packageSnapshot?: PackageSnapshot;
  fromSessionPackage?: boolean;
  sessionPackageId?: string;
  sessionPackageName?: string;
  allowedServiceIds?: string[];
  consumeOneSession?: boolean;

  /**
   * ✅ NEW: رقم حجز بشري MK-xxxxx (سيرفر)
   */
  publicId?: string;

  // ✅ service duration in minutes (prevents overlaps)
  durationMin?: number;

  /**
   * ✅ employee linking
   * employeeId = staff_public doc id (من Booking page)
   * employeeUid = linkedUid الحقيقي (اختياري)
   * employeeKey = المفتاح المستخدم لعرض حجوزات الموظفة في Staff portal
   *   - Prefer employeeUid
   *   - Fallback employeeId (staff_public id)
   *   - Fallback safeKey(employeeName)
   */
  employeeId?: string | null;
  employeeUid?: string | null;

  employeeName: string;
  employeeKey?: string;

  date: string;
  time: string;
  startTime?: string;
  endTime?: string;

  // ✅ stored start-slotId (for debugging & tracking)
  slotId?: string;

  total?: number;
  finalPrice?: number;
  /** Catalog service price captured for internal audit only. */
  catalogPrice?: number;
  /** Agreed price for this booking item before discounts. */
  bookingPrice?: number;
  /** Canonical Core booking-item id used by audited price edits. */
  bookingItemId?: string;
  /** Quantity represented by the primary booking item. */
  bookingItemQuantity?: number;
  /** Discount applied to the primary booking item, in SAR. */
  bookingItemDiscount?: number;
  priceAdjustmentReason?: "catalog_pending_update" | "management_approved" | "special_price" | "other";
  priceAdjustmentNote?: string;
  discountAmount?: number;
  discountSnapshot?: any;
  paymentMethod?: BookingPaymentMethod;
  paymentBreakdown?: BookingPaymentBreakdown;
  paymentType?: BookingPaymentType;
  paidAmount?: number;
  remainingAmount?: number;
  invoiceId?: string;
  invoiceNumber?: string;

  status: BookingStatus;
  note?: string;
  adminNote?: string;
  viewedAt?: Timestamp | number;
  viewedAtMs?: number;
  viewedByUid?: string | null;
  viewedByEmail?: string | null;
  viewedByName?: string | null;
  pendingAt?: number;
  pendingByUid?: string;
  pendingByEmail?: string | null;
  pendingByName?: string | null;
  confirmedAt?: number;
  confirmedByUid?: string;
  confirmedByEmail?: string | null;
  confirmedByName?: string | null;
  completedAt?: number;
  completedByUid?: string;
  completedByEmail?: string | null;
  completedByName?: string | null;
  cancelledAt?: number;
  cancelledByUid?: string;
  cancelledByEmail?: string | null;
  cancelledByName?: string | null;
  paidAt?: number;
  paidByUid?: string;
  paidByEmail?: string | null;
  paidByName?: string | null;
  createdAtMs?: number;
  updatedByUid?: string | null;
  updatedByEmail?: string | null;
  updatedByName?: string | null;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  source?: "firestore" | "core-d1" | string;
};

export type BookingDocWithId = BookingDoc & { id: string };
export type BookingGroupInput = {
  parent: BookingDoc;
  items: BookingDoc[];
};
