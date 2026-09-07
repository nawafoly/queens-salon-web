export type BookingStatus = "confirmed" | "pending" | "cancelled" | "completed";

export type Booking = {
  id: string;
  publicId?: string;
  customerName: string;
  phone?: string;
  serviceName: string;
  serviceId?: string;
  serviceSectionName?: string;
  serviceCategoryName?: string;
  employeeName?: string;
  employeeId?: string | null;
  employeeUid?: string | null;
  date: string;
  time: string;
  status: BookingStatus;
  total?: number;
  note?: string;
  createdAt: number;
};

export const DashboardService = {
  migrateBookingsIfNeeded() {
    // Legacy compatibility no-op. Canonical dashboard data comes from Core.
  },
};
