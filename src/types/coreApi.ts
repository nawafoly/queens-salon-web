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
  avatarUrl?: string | null;
  showOnBooking?: boolean;
  specialties?: string[];
  schedules?: CoreStaffSchedule[];
  leaveStartDate?: string | null;
  leaveEndDate?: string | null;
  leaveNote?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CoreBookingItem = {
  id: string;
  bookingId: string;
  salonId: string;
  serviceId: string;
  serviceNameSnapshot: string;
  staffId?: string | null;
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
  source?: string | null;
  note?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  occurredAt: string;
  createdAt: string;
};

export type CoreDiscount = {
  id: string;
  salonId: string;
  code?: string | null;
  codeKey?: string | null;
  name: string;
  type: "fixed" | "percent";
  value: number;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  usedCount: number;
  minOrderHalalas?: number | null;
  maxDiscountHalalas?: number | null;
  perClientLimit?: number | null;
  appliesTo: "all" | "services" | "categories";
  serviceIds: string[];
  categoryIds?: string[];
  sequenceSteps: Record<string, unknown>[];
  imageUrl?: string | null;
  description?: string | null;
  priceBeforeHalalas?: number | null;
  priceAfterHalalas?: number | null;
  published: boolean;
  status: "draft" | "scheduled" | "active" | "expired" | "disabled" | string;
  sortOrder: number;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  targetScope: "all" | "specific" | string;
  targetClientIds: string[];
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CoreExpenseEntry = {
  id: string;
  salonId: string;
  amountHalalas: number;
  category?: string | null;
  description?: string | null;
  paymentMethod?: string | null;
  occurredAt: string;
  createdByUid?: string | null;
  createdAt: string;
  updatedAt: string;
  title?: string | null;
  note?: string | null;
  addedBy?: string | null;
  sourceKind?: string | null;
  sourceRefId?: string | null;
  sourceType?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  monthKey?: string | null;
  payrollKind?: string | null;
};

export type CoreCreateBookingInput = {
  id?: string;
  clientId: string;
  staffId?: string;
  bookingDate: string;
  startTime: string;
  endTime?: string;
  status?: string;
  source?: string;
  notes?: string;
  discountHalalas?: number;
  discountSnapshot?: Record<string, unknown>;
  discount_snapshot?: Record<string, unknown>;
  packageSessionsUsed?: number;
  createInvoice?: boolean;
  items: Array<{
    id?: string;
    serviceId: string;
    serviceName?: string;
    staffId?: string;
    quantity?: number;
    unitPriceHalalas?: number;
    discountHalalas?: number;
    finalTotalHalalas?: number;
    packageCovered?: boolean;
    clientPackageId?: string;
    bookingDate?: string;
    startTime?: string;
    endTime?: string;
    cartItemId?: string;
    packageReservationId?: string;
  }>;
  slotStepMin?: number;
  bufferMin?: number;
};

export type CoreAvailabilityBookingSlot = {
  bookingId: string;
  publicId: string;
  bookingItemId: string;
  serviceName: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  source: string;
  status: string;
  startTime: string;
  endTime: string;
  bufferMin?: number;
};

export type CoreStaffAvailability = {
  salonId: string;
  date: string;
  weekday: number;
  staffId: string;
  staffName: string;
  active: boolean;
  showOnBooking: boolean;
  onLeave: boolean;
  leaveNote: string;
  availableForDate: boolean;
  scheduleWindows: Array<{ id: string; startTime: string; endTime: string }>;
  lockedTimes: string[];
  takenTimes: string[];
  bookedSlots: Record<string, CoreAvailabilityBookingSlot>;
  bookings: Array<Record<string, unknown>>;
};

export type CoreApiListResponse<T> = {
  ok: true;
  data: T[];
};

export type CoreApiErrorResponse = {
  ok: false;
  error: string;
  message?: string;
};

export type CoreCatalogRow = {
  id: string;
  salonId: string;
  name: string;
  sectionId?: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CoreRefund = {
  id: string;
  salonId: string;
  paymentId?: string | null;
  invoiceId?: string | null;
  bookingId?: string | null;
  clientId?: string | null;
  amountHalalas: number;
  method: string;
  reason?: string | null;
  status: string;
  idempotencyKey?: string | null;
  providerReference?: string | null;
  createdByUid?: string | null;
  refundedAt: string;
  voidedAt?: string | null;
  voidedByUid?: string | null;
  createdAt: string;
  idempotent?: boolean;
};

export type CoreAuditLog = {
  id: string;
  salonId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  description?: string | null;
  source?: string | null;
  actorUid?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  beforeJson?: string | null;
  afterJson?: string | null;
  metaJson?: string | null;
  createdAt: string;
};
