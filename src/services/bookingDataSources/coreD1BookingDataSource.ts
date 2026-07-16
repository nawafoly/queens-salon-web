import { CoreBookingService } from "../CoreBookingService";
import { CoreCatalogService } from "../CoreCatalogService";
import { CoreClientService } from "../CoreClientService";
import { CoreInvoiceService } from "../CoreInvoiceService";
import { CorePaymentService } from "../CorePaymentService";
import { CoreStaffService } from "../CoreStaffService";
import { CoreAvailabilityService } from "../CoreAvailabilityService";
import { PackageOperationsService } from "../PackageOperationsService";
import {
  createBookingWithPackageSaga,
  type PackageSagaItem,
  type PackageSagaReservation,
} from "../packageBookingSaga";
import { getDataSourceFlags } from "../../config/dataSourceFlags";
import {
  coreBookingToLegacy,
  coreServiceToLegacy,
  coreServicesToSections,
  coreStaffToLegacy,
  legacyBookingToCoreInput,
} from "../coreBookingMappers";
import type { BookingDataSource } from "../bookingDataSource";
import type {
  BookingDoc,
  BookingStatus,
} from "../firestoreBookings";

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

async function resolveClientId(booking: BookingDoc): Promise<string> {
  const firebaseUid = String(booking.userId || "").trim();

  if (firebaseUid) {
    const byUid = await CoreClientService.list(firebaseUid);
    const exact = byUid.find(
      (client) => client.firebaseUid === firebaseUid
    );
    if (exact) return exact.id;
  }

  const phone = normalizePhone(booking.clientPhone);
  const searchValue = phone || booking.clientName;
  const rows = searchValue
    ? await CoreClientService.list(searchValue)
    : [];

  const matched =
    rows.find(
      (client) =>
        phone &&
        normalizePhone(client.phoneNormalized) === phone
    ) ||
    rows.find((client) => client.name === booking.clientName);

  if (matched) return matched.id;

  const created = await CoreClientService.create({
    name: booking.clientName || "عميلة",
    phone: booking.clientPhone,
    firebaseUid: firebaseUid || undefined,
  });
  return created.id;
}


function generatedBookingId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `booking_${Date.now()}_${Math.random().toString(36).slice(2)}`
  ).replace(/[^A-Za-z0-9_-]/g, "_");
}

function isPackageCovered(booking: BookingDoc): boolean {
  return Boolean(
    booking.consumeOneSession ||
      booking.fromSessionPackage ||
      booking.sessionPackageId
  );
}

function readBookingDiscountSnapshot(booking: BookingDoc): Record<string, unknown> | undefined {
  const snapshot = (booking as BookingDoc & { discountSnapshot?: unknown }).discountSnapshot;
  return snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : undefined;
}

function originalHalalasForBooking(booking: BookingDoc): number {
  const finalAmount = Number(booking.finalPrice ?? booking.total ?? booking.serviceSnapshot?.priceAtBooking ?? 0);
  const discountAmount = Number((booking as BookingDoc & { discountAmount?: number }).discountAmount || 0);
  const explicit = Number(
    (booking as BookingDoc & { originalAmount?: number; subtotal?: number }).originalAmount ??
      (booking as BookingDoc & { originalAmount?: number; subtotal?: number }).subtotal ??
      (booking.serviceSnapshot as Record<string, unknown> | undefined)?.originalAmountAtBooking ??
      (booking.serviceSnapshot as Record<string, unknown> | undefined)?.priceBeforeDiscountAtBooking ??
      finalAmount + discountAmount
  );
  return Math.max(0, Math.round((Number.isFinite(explicit) ? explicit : finalAmount + discountAmount) * 100));
}

function discountHalalasForBooking(booking: BookingDoc): number {
  return Math.max(0, Math.round(Number((booking as BookingDoc & { discountAmount?: number }).discountAmount || 0) * 100));
}

function finalHalalasForBooking(booking: BookingDoc): number {
  const finalAmount = Number(booking.finalPrice ?? booking.total ?? booking.serviceSnapshot?.priceAtBooking ?? 0);
  return Math.max(0, Math.round((Number.isFinite(finalAmount) ? finalAmount : 0) * 100));
}

function packageSagaItem(
  booking: BookingDoc,
  clientId: string,
  bookingId: string,
  itemIndex = 0
): PackageSagaItem {
  return {
    cartItemId:
      String(
        (booking as BookingDoc & { cartItemId?: string }).cartItemId ||
          `item_${itemIndex}`
      ).trim() || `item_${itemIndex}`,
    clientId,
    clientPackageId:
      String(booking.sessionPackageId || "").trim() || undefined,
    serviceId: String(
      booking.serviceId || booking.serviceName || ""
    ).trim(),
    employeeId: String(booking.employeeId || "").trim(),
    date: String(booking.date || "").trim(),
    time: String(booking.time || booking.startTime || "").trim(),
  };
}


function invalidateCoreAvailability(booking: Awaited<ReturnType<typeof CoreBookingService.get>>) {
  const seen = new Set<string>();
  for (const item of booking.items || []) {
    const staffId = String(item.staffId || booking.staffId || "").trim();
    const date = String(item.bookingDate || booking.bookingDate || "").trim();
    const key = `${staffId}|${date}`;
    if (!staffId || !date || seen.has(key)) continue;
    seen.add(key);
    CoreAvailabilityService.invalidate(staffId, date);
  }
  if (!seen.size && booking.staffId && booking.bookingDate) {
    CoreAvailabilityService.invalidate(booking.staffId, booking.bookingDate);
  }
}
async function createCoreBookingWithOptionalPackageSaga(
  bookingId: string,
  clientId: string,
  packageItems: PackageSagaItem[],
  createCoreBooking: (reservations: PackageSagaReservation[]) => ReturnType<typeof CoreBookingService.create>
) {
  if (!packageItems.length) return createCoreBooking([]);

  if (!getDataSourceFlags().usePackagesD1) {
    throw new Error(
      "PACKAGES_D1_REQUIRED: package booking through Core D1 requires VITE_USE_PACKAGES_D1=true."
    );
  }

  return createBookingWithPackageSaga({
    bookingId,
    packageItems,
    createCoreBooking,
  });
}

export const coreD1BookingDataSource: BookingDataSource = {
  kind: "d1",

  async getServices(sectionId = "", categoryId = null) {
    const services = await CoreCatalogService.listServices({
      activeOnly: true,
      sectionId: sectionId || undefined,
      categoryId: categoryId || undefined,
    });
    return services.map(coreServiceToLegacy);
  },

  async getServiceCategories(sectionId = "") {
    const categories = await CoreCatalogService.listCategories(true);
    return categories.map((row) => ({
      id: row.id,
      الاسم: row.name,
      sectionId: row.sectionId || sectionId || "",
      active: row.active,
      order: row.sortOrder,
    }));
  },

  async getServiceSections() {
    const rows = await CoreCatalogService.listSections(true);
    if (rows.length) {
      return rows.map((row) => ({
        id: row.id,
        الاسم: row.name,
        active: row.active,
        order: row.sortOrder,
      }));
    }
    return coreServicesToSections(
      await CoreCatalogService.listServices({ activeOnly: true })
    );
  },

  async getActiveStaff(serviceId) {
    const staff = await CoreStaffService.list({
      activeOnly: true,
      serviceId,
    });
    return staff.map(coreStaffToLegacy);
  },

  getStaffAvailability(query) {
    return CoreAvailabilityService.getStaffDay({
      staffId: query.staffId,
      date: query.date,
      slotStepMin: query.slotStepMin,
      bufferMin: query.bufferMin,
      forceFresh: query.forceFresh,
    });
  },

  async searchClients(search) {
    const rows = await CoreClientService.list(search);
    return rows.map((client) => ({
      ...client,
      fullName: client.name,
      phone: client.phoneNormalized,
      mobile: client.phoneNormalized,
      source: "core-d1",
    }));
  },

  async getClient(id) {
    try {
      const client = await CoreClientService.get(id);
      return {
        ...client,
        fullName: client.name,
        phone: client.phoneNormalized,
        mobile: client.phoneNormalized,
        source: "core-d1",
      };
    } catch {
      return null;
    }
  },

  async createClient(input) {
    const client = await CoreClientService.create(input);
    return {
      ...client,
      fullName: client.name,
      phone: client.phoneNormalized,
      mobile: client.phoneNormalized,
      source: "core-d1",
    };
  },

  async searchBookings(query = {}) {
    return (await CoreBookingService.list(query)).map(
      coreBookingToLegacy
    );
  },

  async getBooking(id) {
    try {
      return coreBookingToLegacy(
        await CoreBookingService.get(id)
      );
    } catch {
      return null;
    }
  },

  async createBooking(booking) {
    const clientId = await resolveClientId(booking);
    const bookingId =
      String(
        (booking as BookingDoc & { id?: string }).id || ""
      ).trim() || generatedBookingId();
    const coreInput = {
      ...legacyBookingToCoreInput(booking, clientId),
      id: bookingId,
    };
    const packageItems = isPackageCovered(booking)
      ? [packageSagaItem(booking, clientId, bookingId)]
      : [];

    const created =
      await createCoreBookingWithOptionalPackageSaga(
        bookingId,
        clientId,
        packageItems,
        (reservations) => {
          const reservation = reservations[0];
          return CoreBookingService.create({
            ...coreInput,
            items: coreInput.items.map((item, index) => ({
              ...item,
              cartItemId: reservation?.item.cartItemId || `item_${index}`,
              packageReservationId:
                reservation?.result.packageTransactionId || undefined,
            })),
          });
        }
      );

    invalidateCoreAvailability(created);
    return {
      id: created.id,
      publicId: created.publicId || created.id,
    };
  },

  async createBookingGroup(group) {
    const firstItem = group.items[0] || group.parent;
    const clientId = await resolveClientId(group.parent);
    const bookingId =
      String(
        (group.parent as BookingDoc & { id?: string }).id || ""
      ).trim() || generatedBookingId();

    const coreInput = {
      ...legacyBookingToCoreInput(firstItem, clientId),
      id: bookingId,
      staffId:
        String(
          group.parent.employeeId ||
            firstItem.employeeId ||
            ""
        ).trim() || undefined,
      bookingDate: group.parent.date || firstItem.date,
      startTime:
        group.parent.time ||
        group.parent.startTime ||
        firstItem.time,
      notes: group.parent.note,
      source: group.parent.channel || "client",
      slotStepMin: Number(group.parent.slotStepMinAtBooking || firstItem.slotStepMinAtBooking || 10),
      bufferMin: Number(group.parent.bufferMinAtBooking || firstItem.bufferMinAtBooking || 0),
      discountSnapshot: readBookingDiscountSnapshot(group.parent) || readBookingDiscountSnapshot(firstItem),
      items: group.items.map((item, index) => ({
        serviceId: String(
          item.serviceId || item.serviceName || ""
        ).trim(),
        staffId:
          String(item.employeeId || "").trim() || undefined,
        unitPriceHalalas: originalHalalasForBooking(item),
        discountHalalas: discountHalalasForBooking(item),
        finalTotalHalalas: finalHalalasForBooking(item),
        packageCovered: isPackageCovered(item),
        clientPackageId: item.sessionPackageId,
        bookingDate: String(item.date || group.parent.date || "").trim(),
        startTime: String(item.time || item.startTime || group.parent.time || "").trim(),
        cartItemId:
          String((item as BookingDoc & { cartItemId?: string }).cartItemId || `item_${index}`).trim() || `item_${index}`,
      })),
    };

    const packageItems = group.items
      .map((item, index) =>
        isPackageCovered(item)
          ? packageSagaItem(item, clientId, bookingId, index)
          : null
      )
      .filter(
        (item): item is PackageSagaItem => Boolean(item)
      );

    const created =
      await createCoreBookingWithOptionalPackageSaga(
        bookingId,
        clientId,
        packageItems,
        (reservations) => {
          const byCartItem = new Map(
            reservations.map((reservation) => [
              reservation.item.cartItemId,
              reservation.result.packageTransactionId,
            ])
          );
          return CoreBookingService.create({
            ...coreInput,
            items: coreInput.items.map((item, index) => ({
              ...item,
              cartItemId: item.cartItemId || `item_${index}`,
              packageReservationId:
                byCartItem.get(item.cartItemId || `item_${index}`) || undefined,
            })),
          });
        }
      );

    invalidateCoreAvailability(created);
    return {
      parentId: created.id,
      parentPublicId: created.publicId || created.id,
      itemIds: created.items.map((item) => item.id),
    };
  },

  async updateBooking(id, patch) {
    const scheduleChanged = Boolean(
      patch.date || patch.time || patch.startTime || patch.endTime || patch.employeeId
    );
    if (scheduleChanged) {
      const current = await CoreBookingService.get(id);
      const updated = await CoreBookingService.reschedule(id, {
        bookingDate: patch.date,
        startTime: patch.time || patch.startTime,
        endTime: patch.endTime,
        staffId: patch.employeeId,
        notes: patch.note,
      });
      invalidateCoreAvailability(current);
      invalidateCoreAvailability(updated);
    }
    await CoreBookingService.patch(id, {
      status:
        patch.status === "confirmed" ? "booked" : patch.status,
      notes: patch.note,
      paymentStatus:
        patch.paymentType === "full"
          ? "paid"
          : patch.paymentType === "partial"
            ? "partial"
            : undefined,
    });
  },

  async updateBookingStatus(
    id,
    status: BookingStatus
  ) {
    const current =
      status === "completed" || status === "cancelled"
        ? await CoreBookingService.get(id)
        : null;
    const hasPackageReservation = Boolean(
      current?.items.some((item) => item.packageCovered)
    );

    if (status === "completed") {
      const updated = await CoreBookingService.complete(id);
      invalidateCoreAvailability(updated);
      if (hasPackageReservation) {
        await PackageOperationsService.consumeReserved(id);
      }
      return;
    }

    if (status === "cancelled") {
      const updated = await CoreBookingService.cancel(id);
      invalidateCoreAvailability(updated);
      if (hasPackageReservation) {
        await PackageOperationsService.restoreReserved(
          id,
          "core_booking_cancelled"
        );
      }
      return;
    }

    const updated = await CoreBookingService.patch(id, {
      status: status === "confirmed" ? "booked" : status,
    });
    invalidateCoreAvailability(updated);
  },

  createInvoice: CoreInvoiceService.create,
  recordPayment: CorePaymentService.record,
};
