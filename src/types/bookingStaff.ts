// Public-facing staff DTO retained for Core booking compatibility.
// No Firestore runtime dependency.

export type StaffPublicDoc = {
  name: string;
  specialties: string[];
  active?: boolean | number | string | null;
  isActive?: boolean | number | string | null;
  disabled?: boolean | number | string | null;
  status?: string;
  employmentStatus?: string;
  accountStatus?: string;
  hrProfileStatus?: string;
  hrEmploymentStatus?: string;
  hrAccountStatus?: string;
  avatarUrl?: string;
  avatarURL?: string;
  photoURL?: string;
  photoUrl?: string;
  imageUrl?: string;
  imageURL?: string;
  profileImageUrl?: string;
  profileImage?: string;
  picture?: string;
  avatar?: string;
  rating?: number;
  reviewsCount?: number;
  reviewCount?: number;
  ratingsCount?: number;
  employmentEndDate?: string;
  linkedUid?: string;
  showOnBooking?: boolean | number | string | null;
  employeeProfile?: Record<string, unknown> | null;
  employment?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  appUser?: Record<string, unknown> | null;
  bookingProfile?: Record<string, unknown> | null;
  onLeave?: boolean;
  leaveStartDate?: string;
  leaveUntil?: string;
  leaveType?: string;
  leaveNote?: string;
  leaveRequestId?: string;
  coreLeaveId?: string;
  source?: "staff_public" | "employees" | string;
  employeeId?: string;
  employeeDocId?: string;
  employeeUid?: string;
  uid?: string;
  authUid?: string;
  userId?: string;
  email?: string;
  phone?: string;
};

export type StaffPublicWithId = StaffPublicDoc & { id: string };
