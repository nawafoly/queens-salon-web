export type CoreClient = {
  id: string;
  salonId: string;
  name: string;
  phoneNormalized: string;
  email?: string | null;
  firebaseUid?: string | null;
  status: string;
  notes?: string | null;
  vip?: boolean;
  legacyClientDocId?: string | null;
  loyaltyBalance?: number;
  loyaltyEarned?: number;
  loyaltyUsed?: number;
  loyaltyReversed?: number;
  lastCompletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CoreServiceCategory = {
  id: string;
  salonId: string;
  name: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CoreService = {
  id: string;
  salonId: string;
  name: string;
  sectionId?: string | null;
  categoryId?: string | null;
  description?: string | null;
  durationMinutes: number;
  priceHalalas: number;
  seasonPriceHalalas?: number | null;
  active: boolean;
  imageUrl?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CoreStaffSchedule = {
  id: string;
  salonId: string;
  staffId: string;
  weekday: number;
  startTime?: string | null;
  endTime?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CoreStaff = {
  id: string;
  salonId: string;
  firebaseUid?: string | null;
  name: string;
  phoneNormalized?: string | null;
  active: boolean;
  employmentStatus?: string | null;
  hrProfileStatus?: string | null;
  hrEmploymentStatus?: string | null;
  hrAccountStatus?: string | null;
  avatarUrl?: string | null;
  showOnBooking?: boolean;
  specialties?: string[];
  schedules?: CoreStaffSchedule[];
  createdAt: string;
  updatedAt: string;
};

export type CoreBookingItem = {
  id: string;
  bookingId: string;
  salonId: string;
  serviceId: string;
  serviceNameSnapshot: string;
  sectionId?: string | null;
  sectionName?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  quantity: number;
  unitPriceHalalas: number;
  totalHalalas: number;
  discountHalalas?: number;
  finalTotalHalalas?: number | null;
  packageCovered: boolean;
  clientPackageId?: string | null;
  durationMinutes?: number | null;
  bookingDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  cartItemId?: string | null;
  packageReservationId?: string | null;
  createdAt: string;
};

export type CoreBooking = {
  id: string;
  publicId?: string | null;
  salonId: string;
  clientId: string;
  clientName?: string | null;
  clientPhone?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  bookingDate: string;
  startTime: string;
  endTime?: string | null;
  status: string;
  source?: string | null;
  notes?: string | null;
  subtotalHalalas: number;
  discountHalalas: number;
  totalHalalas: number;
  discountSnapshotJson?: string | null;
  paymentStatus: string;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  paidHalalas?: number;
  packageSessionsUsed: number;
  createdByUid?: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string | null;
  completedAt?: string | null;
  slotStepMin?: number;
  bufferMin?: number;
  items: CoreBookingItem[];
};

export type CoreInvoice = {
  id: string;
  salonId: string;
  bookingId?: string | null;
  clientId: string;
  invoiceNumber?: string | null;
  subtotalHalalas: number;
  discountHalalas: number;
  totalHalalas: number;
  discountSnapshotJson?: string | null;
  paidHalalas: number;
  status: string;
  issuedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CorePayment = {
  id: string;
  salonId: string;
  invoiceId?: string | null;
  bookingId?: string | null;
  clientId?: string | null;
  method: string;
  amountHalalas: number;
  status: string;
  provider?: string | null;
  providerReference?: string | null;
  idempotencyKey?: string | null;
  paidAt?: string | null;
  createdAt: string;
  idempotent?: boolean;
};

export type CoreIncomeEntry = {
  id: string;
  salonId: string;
  bookingId?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
  amountHalalas: number;
  category?: string | null;
  description?: string | null;
  method?: string | null;
  paymentBreakdownJson?: string | null;
  sourceKind?: string | null;
  sourceId?: string | null;
  paidAt?: string | null;
  createdAt: string;
};

export type CoreExpenseEntry = {
  id: string;
  salonId: string;
  amountHalalas: number;
  category?: string | null;
  description?: string | null;
  method?: string | null;
  paymentBreakdownJson?: string | null;
  sourceKind?: string | null;
  sourceId?: string | null;
  expenseDate?: string | null;
  createdAt: string;
  updatedAt?: string | null;
};
