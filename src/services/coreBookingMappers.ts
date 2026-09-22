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
  const mapped = renameKeys<CoreClient>(row, {
    salon_id: "salonId",
    phone_normalized: "phoneNormalized",
    avatar_url: "avatarUrl",
    membership_id: "membershipId",
    membership_percent: "membershipPercent",
    firebase_uid: "firebaseUid",
    legacy_client_doc_id: "legacyClientDocId",
    created_at: "createdAt",
    updated_at: "updatedAt",
  });
  return { ...mapped, vip: Number(row.vip) === 1 || row.vip === true };
}

export function mapCoreService(row: Record<string, unknown>): CoreService {
  const mapped = renameKeys<CoreService>(row, {
    salon_id: "salonId",
    section_id: "sectionId",
    category_id: "categoryId",
    duration_minutes: "durationMinutes",
    price_halalas: "priceHalalas",
    promo_active: "promoActive",
    catalog_price_halalas: "catalogPriceHalalas",
    promo_price_halalas: "promoPriceHalalas",
    promo_id: "promoId",
    promo_starts_at: "promoStartsAt",
    promo_ends_at: "promoEndsAt",
    season_price_halalas: "seasonPriceHalalas",
    image_url: "imageUrl",
    sort_order: "sortOrder",
    created_at: "createdAt",
    updated_at: "updatedAt",
  });
  return {
    ...mapped,
    active: Number(row.active) === 1,
    promoActive: row.promoActive === true || Number(row.promo_active) === 1,
  };
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
    hr_profile_status: "hrProfileStatus",
    hr_employment_status: "hrEmploymentStatus",
    hr_account_status: "hrAccountStatus",
    avatar_url: "avatarUrl",
    show_on_booking: "showOnBooking",
    specialties_json: "specialtiesJson",
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
    section_id: "sectionId",
    section_name: "sectionName",
    category_id: "categoryId",
    category_name: "categoryName",
    staff_id: "staffId",
    staff_name: "staffName",
    unit_price_halalas: "unitPriceHalalas",
    catalog_unit_price_halalas: "catalogUnitPriceHalalas",
    price_adjustment_reason: "priceAdjustmentReason",
    price_adjustment_note: "priceAdjustmentNote",
    price_adjusted_by_uid: "priceAdjustedByUid",
    price_adjusted_at: "priceAdjustedAt",
    total_halalas: "totalHalalas",
    discount_halalas: "discountHalalas",
    final_total_halalas: "finalTotalHalalas",
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
    admin_notes: "adminNotes",
    subtotal_halalas: "subtotalHalalas",
    discount_halalas: "discountHalalas",
    total_halalas: "totalHalalas",
    discount_snapshot_json: "discountSnapshotJson",
    payment_status: "paymentStatus",
    invoice_id: "invoiceId",
    invoice_number: "invoiceNumber",
    paid_halalas: "paidHalalas",
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
    discount_snapshot_json: "discountSnapshotJson",
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
    booking_public_id: "bookingPublicId",
    booking_date: "bookingDate",
    booking_status: "bookingStatus",
    booking_total_halalas: "bookingTotalHalalas",
    booking_paid_halalas: "bookingPaidHalalas",
    booking_payment_status: "bookingPaymentStatus",
    booking_staff_id: "bookingStaffId",
    booking_staff_name: "bookingStaffName",
    booking_client_name: "bookingClientName",
    booking_client_phone: "bookingClientPhone",
    booking_invoice_id: "bookingInvoiceId",
    booking_invoice_number: "bookingInvoiceNumber",
    invoice_id: "invoiceId",
    payment_id: "paymentId",
    amount_halalas: "amountHalalas",
    payment_breakdown_json: "paymentBreakdownJson",
    client_name: "clientName",
    client_phone: "clientPhone",
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
    added_by: "addedBy",
    source_kind: "sourceKind",
    source_ref_id: "sourceRefId",
    source_type: "sourceType",
    staff_id: "staffId",
    staff_name: "staffName",
    month_key: "monthKey",
    payroll_kind: "payrollKind",
    created_at: "createdAt",
    updated_at: "updatedAt",
  });
}

export function coreServiceToLegacy(service: CoreService): ServiceDoc {
  const catalogPriceHalalas = service.catalogPriceHalalas ?? service.priceHalalas;
  return {
    id: service.id,
    الاسم: service.name,
    sectionId: text(service.sectionId || service.categoryId || "services"),
    categoryId: service.categoryId || null,
    promoActive: service.promoActive === true,
    catalogPriceHalalas,
    catalogPrice: sarFromHalalas(catalogPriceHalalas),
    promoPriceHalalas: service.promoPriceHalalas ?? null,
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

export function coreStaffToLegacy(
  staff: CoreStaff
): StaffPublicWithId {
  return {
    id: staff.id,
    name: staff.name,
    specialties: staff.specialties || [],
    active: staff.active,
    isActive: staff.active,
    status:
      staff.hrAccountStatus ||
      staff.hrProfileStatus ||
      staff.hrEmploymentStatus ||
      staff.employmentStatus ||
      (staff.active ? "active" : "inactive"),
    employmentStatus: staff.employmentStatus || (staff.active ? "active" : "inactive"),
    accountStatus: staff.hrAccountStatus || undefined,
    hrProfileStatus: staff.hrProfileStatus || undefined,
    hrEmploymentStatus: staff.hrEmploymentStatus || undefined,
    hrAccountStatus: staff.hrAccountStatus || undefined,
    linkedUid: staff.firebaseUid || undefined,
    avatarUrl: staff.avatarUrl || undefined,
    showOnBooking: staff.showOnBooking !== false,
    // Runtime booking schedule comes only from Core availability / HR resolver.
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
  const discountAmount = sarFromHalalas(booking.discountHalalas);
  const paidAmount = Math.max(0, Math.min(total, sarFromHalalas(booking.paidHalalas || 0)));
  const isPaid = booking.paymentStatus === "paid" || (total > 0 && paidAmount >= total);
  const isPartial = booking.paymentStatus === "partial" || (paidAmount > 0 && paidAmount < total);
  let discountSnapshot: unknown = undefined;
  try {
    discountSnapshot = booking.discountSnapshotJson
      ? JSON.parse(String(booking.discountSnapshotJson))
      : undefined;
  } catch {
    discountSnapshot = undefined;
  }

  const packageItems = booking.items.filter((item) => item.packageCovered || item.clientPackageId);
  const firstPackageItem = packageItems[0];

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
          sectionIdAtBooking: firstItem.sectionId || undefined,
          sectionTitleAtBooking: firstItem.sectionName || undefined,
          categoryIdAtBooking: firstItem.categoryId || undefined,
          categoryNameAtBooking: firstItem.categoryName || undefined,
        }
      : undefined,
    employeeId: booking.staffId || firstItem?.staffId || null,
    employeeName: booking.staffName || "-",
    date: booking.bookingDate,
    time: booking.startTime,
    startTime: booking.startTime,
    total,
    finalPrice: total,
    catalogPrice: firstItem?.catalogUnitPriceHalalas == null
      ? undefined
      : sarFromHalalas(firstItem.catalogUnitPriceHalalas),
    bookingPrice: firstItem?.unitPriceHalalas == null
      ? undefined
      : sarFromHalalas(firstItem.unitPriceHalalas),
    priceAdjustmentReason: firstItem?.priceAdjustmentReason || undefined,
    priceAdjustmentNote: firstItem?.priceAdjustmentNote || undefined,
    discountAmount,
    discountSnapshot,
    paymentType: isPaid ? "full" : isPartial ? "partial" : "none",
    paidAmount,
    remainingAmount: Math.max(0, total - paidAmount),
    invoiceId: booking.invoiceId || undefined,
    invoiceNumber: booking.invoiceNumber || undefined,
    status: legacyBookingStatus(booking.status),
    note: booking.notes || undefined,
    adminNote: booking.adminNotes || undefined,
    durationMin: firstItem?.durationMinutes || undefined,
    fromSessionPackage: packageItems.length > 0,
    consumeOneSession: packageItems.length > 0,
    sessionPackageId: firstPackageItem?.clientPackageId || undefined,
    allowedServiceIds: packageItems.map((item) => item.serviceId).filter(Boolean) as string[],
    createdAtMs: Date.parse(booking.createdAt) || undefined,
  };
}

export function legacyBookingToCoreInput(
  booking: BookingDoc,
  clientId: string
) {
  const finalTotal = Number(
    booking.finalPrice ??
      booking.total ??
      booking.serviceSnapshot?.priceAtBooking ??
      0
  );
  const discountAmount = Number((booking as any).discountAmount || 0);
  const originalTotal = Math.max(
    0,
    Number(
      booking.bookingPrice ??
        (booking as any).originalAmount ??
        (booking as any).subtotal ??
        (booking.serviceSnapshot as any)?.originalAmountAtBooking ??
        (booking.serviceSnapshot as any)?.priceBeforeDiscountAtBooking ??
        finalTotal + discountAmount
    )
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
    discountSnapshot: (booking as any).discountSnapshot || undefined,
    packageSessionsUsed:
      booking.consumeOneSession || booking.fromSessionPackage ? 1 : 0,
    slotStepMin: Number(booking.slotStepMinAtBooking || 10),
    bufferMin: Number(booking.bufferMinAtBooking || 0),
    items: [
      {
        serviceId: text(booking.serviceId || booking.serviceName),
        serviceName: text(booking.serviceName || booking.serviceSnapshot?.serviceNameAtBooking) || undefined,
        staffId: text(booking.employeeId) || undefined,
        unitPriceHalalas: Math.max(0, Math.round(originalTotal * 100)),
        priceAdjustmentReason: booking.priceAdjustmentReason,
        priceAdjustmentNote: booking.priceAdjustmentNote,
        discountHalalas: Math.max(0, Math.round(discountAmount * 100)),
        finalTotalHalalas: Math.max(0, Math.round(finalTotal * 100)),
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
