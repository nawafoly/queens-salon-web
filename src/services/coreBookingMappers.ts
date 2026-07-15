import type {
  CoreBooking,
  CoreBookingItem,
  CoreClient,
  CoreExpenseEntry,
  CoreIncomeEntry,
  CoreInvoice,
  CorePayment,
  CoreService,
  CoreStaff,
  CoreStaffSchedule,
} from "../types/coreApi";
import type { BookingDoc, BookingDocWithId } from "./firestoreBookings";
import type { SectionDoc, ServiceDoc } from "./firestoreCatalog";
import type { StaffPublicWithId } from "./firestoreStaffPublic";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function sarFromHalalas(value: unknown): number {
  return Number(value || 0) / 100;
}

function renameKeys<T>(
  row: Record<string, unknown>,
  names: Record<string, string>
): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    output[names[key] || key] = value;
  }
  return output as T;
}

export function mapCoreClient(row: Record<string, unknown>): CoreClient {
  return renameKeys<CoreClient>(row, {
    salon_id: "salonId",
    phone_normalized: "phoneNormalized",
    firebase_uid: "firebaseUid",
    created_at: "createdAt",
    updated_at: "updatedAt",
  });
}

export function mapCoreService(row: Record<string, unknown>): CoreService {
  const mapped = renameKeys<CoreService>(row, {
    salon_id: "salonId",
    section_id: "sectionId",
    category_id: "categoryId",
    duration_minutes: "durationMinutes",
    price_halalas: "priceHalalas",
    image_url: "imageUrl",
    sort_order: "sortOrder",
    created_at: "createdAt",
    updated_at: "updatedAt",
  });
  return { ...mapped, active: Number(row.active) === 1 };
}

function mapCoreStaffSchedule(
  row: Record<string, unknown>
): CoreStaffSchedule {
  const mapped = renameKeys<CoreStaffSchedule>(row, {
    salon_id: "salonId",
    staff_id: "staffId",
    start_time: "startTime",
    end_time: "endTime",
    created_at: "createdAt",
    updated_at: "updatedAt",
  });
  return { ...mapped, active: Number(row.active) === 1 };
}

export function mapCoreStaff(row: Record<string, unknown>): CoreStaff {
  const mapped = renameKeys<CoreStaff & { specialtiesJson?: string }>(row, {
    salon_id: "salonId",
    firebase_uid: "firebaseUid",
    phone_normalized: "phoneNormalized",
    employment_status: "employmentStatus",
    avatar_url: "avatarUrl",
    show_on_booking: "showOnBooking",
    specialties_json: "specialtiesJson",
    leave_start_date: "leaveStartDate",
    leave_end_date: "leaveEndDate",
    leave_note: "leaveNote",
    created_at: "createdAt",
    updated_at: "updatedAt",
  });

  let specialties: string[] = [];
  try {
    const parsed = JSON.parse(text(mapped.specialtiesJson) || "[]");
    if (Array.isArray(parsed)) {
      specialties = parsed.map(text).filter(Boolean);
    }
  } catch {
    specialties = [];
  }

  return {
    ...mapped,
    active: Number(row.active) === 1,
    showOnBooking:
      row.show_on_booking === undefined
        ? true
        : Number(row.show_on_booking) === 1,
    specialties,
    schedules: Array.isArray(row.schedules)
      ? (row.schedules as Record<string, unknown>[]).map(
          mapCoreStaffSchedule
        )
      : [],
  };
}

function mapCoreBookingItem(
  row: Record<string, unknown>
): CoreBookingItem {
  const mapped = renameKeys<CoreBookingItem>(row, {
    booking_id: "bookingId",
    salon_id: "salonId",
    service_id: "serviceId",
    service_name_snapshot: "serviceNameSnapshot",
    staff_id: "staffId",
    unit_price_halalas: "unitPriceHalalas",
    total_halalas: "totalHalalas",
    package_covered: "packageCovered",
    client_package_id: "clientPackageId",
    duration_minutes: "durationMinutes",
    booking_date: "bookingDate",
    start_time: "startTime",
    end_time: "endTime",
    cart_item_id: "cartItemId",
    package_reservation_id: "packageReservationId",
    created_at: "createdAt",
  });
  return { ...mapped, packageCovered: Number(row.package_covered) === 1 };
}

export function mapCoreBooking(
  row: Record<string, unknown>
): CoreBooking {
  const mapped = renameKeys<CoreBooking>(row, {
    public_id: "publicId",
    salon_id: "salonId",
    client_id: "clientId",
    client_name: "clientName",
    client_phone: "clientPhone",
    staff_id: "staffId",
    staff_name: "staffName",
    booking_date: "bookingDate",
    start_time: "startTime",
    end_time: "endTime",
    subtotal_halalas: "subtotalHalalas",
    discount_halalas: "discountHalalas",
    total_halalas: "totalHalalas",
    payment_status: "paymentStatus",
    package_sessions_used: "packageSessionsUsed",
    created_by_uid: "createdByUid",
    created_at: "createdAt",
    updated_at: "updatedAt",
    cancelled_at: "cancelledAt",
    completed_at: "completedAt",
    slot_step_min: "slotStepMin",
    buffer_min: "bufferMin",
  });

  return {
    ...mapped,
    items: Array.isArray(row.items)
      ? (row.items as Record<string, unknown>[]).map(mapCoreBookingItem)
      : [],
  };
}

export function mapCoreInvoice(
  row: Record<string, unknown>
): CoreInvoice {
  return renameKeys<CoreInvoice>(row, {
    salon_id: "salonId",
    booking_id: "bookingId",
    client_id: "clientId",
    invoice_number: "invoiceNumber",
    subtotal_halalas: "subtotalHalalas",
    discount_halalas: "discountHalalas",
    total_halalas: "totalHalalas",
    paid_halalas: "paidHalalas",
    issued_at: "issuedAt",
    created_at: "createdAt",
    updated_at: "updatedAt",
  });
}

export function mapCorePayment(
  row: Record<string, unknown>
): CorePayment {
  return renameKeys<CorePayment>(row, {
    salon_id: "salonId",
    invoice_id: "invoiceId",
    booking_id: "bookingId",
    client_id: "clientId",
    amount_halalas: "amountHalalas",
    provider_reference: "providerReference",
    idempotency_key: "idempotencyKey",
    paid_at: "paidAt",
    created_at: "createdAt",
  });
}

export function mapCoreIncome(
  row: Record<string, unknown>
): CoreIncomeEntry {
  return renameKeys<CoreIncomeEntry>(row, {
    salon_id: "salonId",
    booking_id: "bookingId",
    invoice_id: "invoiceId",
    payment_id: "paymentId",
    amount_halalas: "amountHalalas",
    occurred_at: "occurredAt",
    created_at: "createdAt",
  });
}

export function mapCoreExpense(
  row: Record<string, unknown>
): CoreExpenseEntry {
  return renameKeys<CoreExpenseEntry>(row, {
    salon_id: "salonId",
    amount_halalas: "amountHalalas",
    payment_method: "paymentMethod",
    occurred_at: "occurredAt",
    created_by_uid: "createdByUid",
    created_at: "createdAt",
    updated_at: "updatedAt",
  });
}

export function coreServiceToLegacy(service: CoreService): ServiceDoc {
  return {
    id: service.id,
    الاسم: service.name,
    sectionId: text(service.sectionId || service.categoryId || "services"),
    categoryId: service.categoryId || null,
    السعر: sarFromHalalas(service.priceHalalas),
    المدة: Math.max(1, Number(service.durationMinutes || 30)),
    active: service.active,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

export function coreServicesToSections(
  services: CoreService[]
): SectionDoc[] {
  const sections = new Map<string, SectionDoc>();
  for (const service of services) {
    const id = text(service.sectionId || service.categoryId || "services");
    if (!sections.has(id)) {
      sections.set(id, {
        id,
        الاسم: id === "services" ? "الخدمات" : id,
        active: true,
        order: service.sortOrder,
      });
    }
  }
  return [...sections.values()].sort(
    (left, right) => Number(left.order ?? 999) - Number(right.order ?? 999)
  );
}

const dayKeys = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

export function coreStaffToLegacy(
  staff: CoreStaff
): StaffPublicWithId {
  const customWorkingHours: NonNullable<
    StaffPublicWithId["customWorkingHours"]
  > = {};

  for (const schedule of staff.schedules || []) {
    const key = dayKeys[schedule.weekday] || "sun";
    customWorkingHours[key] = {
      enabled: schedule.active,
      start: schedule.startTime || "10:00",
      end: schedule.endTime || "22:00",
    };
  }

  return {
    id: staff.id,
    name: staff.name,
    specialties: staff.specialties || [],
    active: staff.active,
    linkedUid: staff.firebaseUid || undefined,
    avatarUrl: staff.avatarUrl || undefined,
    showOnBooking: staff.showOnBooking !== false,
    useCustomWorkingHours: Boolean(staff.schedules?.length),
    customWorkingHours,
    onLeave: Boolean(staff.leaveStartDate || staff.leaveEndDate),
    leaveUntil: staff.leaveEndDate || undefined,
    leaveNote: staff.leaveNote || undefined,
  };
}

function legacyBookingStatus(status: string): BookingDoc["status"] {
  if (status === "booked") return "confirmed";
  if (
    status === "pending" ||
    status === "confirmed" ||
    status === "completed" ||
    status === "cancelled"
  ) {
    return status;
  }
  return "pending";
}

export function coreBookingToLegacy(
  booking: CoreBooking
): BookingDocWithId {
  const firstItem = booking.items[0];
  const total = sarFromHalalas(booking.totalHalalas);
  const isPaid = booking.paymentStatus === "paid";
  const isPartial = booking.paymentStatus === "partial";

  return {
    id: booking.id,
    publicId: booking.publicId || booking.id,
    userId: booking.clientId,
    createdBy: booking.source || "core-d1",
    channel:
      booking.source === "internal"
        ? "internal"
        : booking.source === "dashboard"
          ? "dashboard"
          : "client",
    clientName: booking.clientName || "",
    clientPhone: booking.clientPhone || "",
    serviceName: firstItem?.serviceNameSnapshot || "",
    serviceId: firstItem?.serviceId,
    serviceSnapshot: firstItem
      ? {
          serviceNameAtBooking: firstItem.serviceNameSnapshot,
          priceAtBooking: sarFromHalalas(firstItem.totalHalalas),
          durationAtBooking: Number(firstItem.durationMinutes || 0),
        }
      : undefined,
    employeeId: booking.staffId || firstItem?.staffId || null,
    employeeName: booking.staffName || "-",
    date: booking.bookingDate,
    time: booking.startTime,
    startTime: booking.startTime,
    total,
    finalPrice: total,
    paymentType: isPaid ? "full" : isPartial ? "partial" : "none",
    paidAmount: isPaid ? total : 0,
    remainingAmount: isPaid ? 0 : total,
    status: legacyBookingStatus(booking.status),
    note: booking.notes || undefined,
    durationMin: firstItem?.durationMinutes || undefined,
    createdAtMs: Date.parse(booking.createdAt) || undefined,
  };
}

export function legacyBookingToCoreInput(
  booking: BookingDoc,
  clientId: string
) {
  const total = Number(
    booking.finalPrice ??
      booking.total ??
      booking.serviceSnapshot?.priceAtBooking ??
      0
  );

  return {
    id:
      text((booking as BookingDoc & { id?: string }).id) ||
      undefined,
    clientId,
    staffId: text(booking.employeeId) || undefined,
    bookingDate: text(booking.date),
    startTime: text(booking.time || booking.startTime),
    status: booking.status === "confirmed" ? "booked" : booking.status,
    source: booking.channel || "client",
    notes: booking.note,
    packageSessionsUsed:
      booking.consumeOneSession || booking.fromSessionPackage ? 1 : 0,
    slotStepMin: Number(booking.slotStepMinAtBooking || 10),
    bufferMin: Number(booking.bufferMinAtBooking || 0),
    items: [
      {
        serviceId: text(booking.serviceId || booking.serviceName),
        staffId: text(booking.employeeId) || undefined,
        unitPriceHalalas: Math.max(0, Math.round(total * 100)),
        packageCovered: Boolean(
          booking.consumeOneSession || booking.fromSessionPackage
        ),
        clientPackageId: booking.sessionPackageId,
        bookingDate: text(booking.date),
        startTime: text(booking.time || booking.startTime),
        cartItemId: text((booking as BookingDoc & { cartItemId?: string }).cartItemId) || "item_0",
      },
    ],
  };
}
