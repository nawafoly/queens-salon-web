import { PackageOperationsService } from "./PackageOperationsService";

export function packageSagaOperationId(
  operation: "reserve" | "release" | "redeem",
  bookingId: string,
  cartItemId: string
): string {
  return `${operation}_${bookingId}_${cartItemId}`.replace(
    /[^A-Za-z0-9_-]/g,
    "_"
  );
}

export type PackageSagaItem = {
  cartItemId: string;
  clientId: string;
  clientPackageId?: string;
  serviceId: string;
  employeeId: string;
  date: string;
  time: string;
};

export async function createBookingWithPackageSaga<T>(input: {
  bookingId: string;
  packageItems: PackageSagaItem[];
  createCoreBooking: () => Promise<T>;
}): Promise<T> {
  const reserved: PackageSagaItem[] = [];

  try {
    for (const item of input.packageItems) {
      await PackageOperationsService.reserve({
        ...item,
        bookingId: input.bookingId,
        operationId: packageSagaOperationId(
          "reserve",
          input.bookingId,
          item.cartItemId
        ),
      });
      reserved.push(item);
    }

    return await input.createCoreBooking();
  } catch (error) {
    await Promise.allSettled(
      reserved.map((item) =>
        PackageOperationsService.release({
          bookingId: input.bookingId,
          clientPackageId: item.clientPackageId,
          cartItemId: item.cartItemId,
          reason: "core_booking_create_failed",
          operationId: packageSagaOperationId(
            "release",
            input.bookingId,
            item.cartItemId
          ),
        })
      )
    );
    throw error;
  }
}
