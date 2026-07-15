import { CoreBookingService } from "../CoreBookingService";
import { CoreCatalogService } from "../CoreCatalogService";
import { CoreClientService } from "../CoreClientService";
import { CoreInvoiceService } from "../CoreInvoiceService";
import { CorePaymentService } from "../CorePaymentService";
import { CoreStaffService } from "../CoreStaffService";
import { PackageOperationsService } from "../PackageOperationsService";
import {
  createBookingWithPackageSaga,
  type PackageSagaItem,
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

async function createCoreBookingWithOptionalPackageSaga(
  bookingId: string,
  clientId: string,
  packageItems: PackageSagaItem[],
  createCoreBooking: () => ReturnType<typeof CoreBookingService.create>
) {
  if (!packageItems.length) return createCoreBooking();

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

  async getServiceCategories() {
    // The current public booking UI treats categories as optional.
    return [];
  },

  async getServiceSections() {
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
        () => CoreBookingService.create(coreInput)
      );

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
      items: group.items.map((item) => ({
        serviceId: String(
          item.serviceId || item.serviceName || ""
        ).trim(),
        staffId:
          String(item.employeeId || "").trim() || undefined,
        unitPriceHalalas: Math.max(
          0,
          Math.round(
            Number(item.finalPrice ?? item.total ?? 0) * 100
          )
        ),
        packageCovered: isPackageCovered(item),
        clientPackageId: item.sessionPackageId,
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
        () => CoreBookingService.create(coreInput)
      );

    return {
      parentId: created.id,
      parentPublicId: created.publicId || created.id,
      itemIds: created.items.map((item) => item.id),
    };
  },

  async updateBooking(id, patch) {
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
      await CoreBookingService.complete(id);
      if (hasPackageReservation) {
        await PackageOperationsService.consumeReserved(id);
      }
      return;
    }

    if (status === "cancelled") {
      await CoreBookingService.cancel(id);
      if (hasPackageReservation) {
        await PackageOperationsService.restoreReserved(
          id,
          "core_booking_cancelled"
        );
      }
      return;
    }

    await CoreBookingService.patch(id, {
      status: status === "confirmed" ? "booked" : status,
    });
  },

  createInvoice: CoreInvoiceService.create,
  recordPayment: CorePaymentService.record,
};
