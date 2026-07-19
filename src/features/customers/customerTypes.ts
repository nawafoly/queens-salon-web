export type CustomerSource = "combined" | "client-record" | "booking-only";

export type CustomerSegment =
  | "all"
  | "vip"
  | "with-bookings"
  | "without-bookings"
  | "active-packages";

export type CustomerSort = "latest" | "most" | "newest";

export type CustomerLastVisitFilter = "all" | "30-days" | "90-days" | "never";

export type CustomerRow = {
  key: string;
  clientId?: string;
  legacyClientDocId?: string;
  name: string;
  phone: string;
  bookingsCount: number;
  lastVisitDate: string;
  lastVisitTime: string;
  vip: boolean;
  status: string;
  importedNote?: string;
  source: CustomerSource;
  createdAt?: string;
  activePackagesCount: number;
};

export type CustomerStats = {
  totalClients: number;
  totalBookings: number;
  activeClients: number;
  newThisMonth: number;
  vipClients: number;
  averageBookings: number;
};
