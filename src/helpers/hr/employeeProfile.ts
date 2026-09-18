import {
  formatWeeklyOffDaysLabel,
  normalizeWeeklyOffDays,
  type WorkScheduleWeekday,
} from "./workSchedule";
import {
  EMPLOYEE_AVATAR_CATEGORY,
  type EmployeeAvatarDoc,
  type EmployeeEmploymentStatus,
  type EmployeeProfileDoc,
} from "../../types/hrEmployee";

export type { EmployeeAvatarDoc } from "../../types/hrEmployee";

function toDateSafe(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value !== null) {
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof maybeTimestamp.toDate === "function") {
      const date = maybeTimestamp.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof maybeTimestamp.seconds === "number") {
      const date = new Date(maybeTimestamp.seconds * 1000 + Math.floor((maybeTimestamp.nanoseconds || 0) / 1000000));
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatNumberEN(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat("en-US", options).format(value);
}

function buildR2DownloadUrl(filePath: string, download = false) {
  const normalized = String(filePath || "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  // TODO: Wire this to MALIKAT src/services/r2Upload.ts or a signed-download service when HR avatars/files need private downloads.
  return download ? normalized : normalized;
}

function getDefaultEmployeeAvatarUrl(input: Record<string, unknown>) {
  return String(input.avatarUrl || "").trim();
}

function resolveUserAccountStatus(user: { active?: unknown; isActive?: unknown; status?: unknown }) {
  const explicitActive =
    typeof user.isActive === "boolean"
      ? user.isActive
      : typeof user.active === "boolean"
        ? user.active
        : null;
  const status = String(user.status || "").trim().toLowerCase();
  const inactiveByStatus = ["inactive", "suspended", "terminated", "disabled"].includes(status);
  return { isActive: explicitActive ?? !inactiveByStatus };
}
const EMPTY_VALUE = "غير محدد";

export type EmployeeProfileUserDoc = EmployeeProfileDoc & {
  employeeProfile?: EmployeeProfileDoc | null;
  uid?: string;
  email?: string | null;
  displayName?: string | null;
  name?: string | null;
  fullName?: string | null;
  phone?: string | null;
  mobile?: string | null;
  phoneNumber?: string | null;
  title?: string | null;
  department?: string | null;
  employeeCode?: string | null;
  fingerprintNumber?: string | null;
  employeeId?: string | null;
  leaveBalance?: number | string | null;
  adminNotes?: string | null;
  startDate?: unknown;
  hireDate?: unknown;
  joinedAt?: unknown;
  active?: unknown;
  isActive?: unknown;
  status?: unknown;
  photoURL?: string | null;
  profile?: Record<string, any> | null;
  contact?: Record<string, any> | null;
  employment?: Record<string, any> | null;
};

export type EmployeeProfileViewModel = {
  personal: {
    name: string;
    email: string;
    phone: string;
    avatar: EmployeeAvatarDoc | null;
    avatarUrl: string;
  };
  employment: {
    title: string;
    department: string;
    startDate: Date | null;
    leaveBalance: number | null;
    leaveBalanceLabel: string;
    statusKey: string;
    statusLabel: string;
    statusTone: "success" | "warning" | "muted";
    employeeCode: string;
    fingerprintNumber: string;
    shiftStartTime: string;
    shiftEndTime: string;
    weeklyOffDays: WorkScheduleWeekday[];
    weeklyOffDaysLabel: string;
    attendanceZoneLabel: string;
    baseSalary: number | null;
    insuranceDeduction: number | null;
    housingAllowance: number | null;
    transportationAllowance: number | null;
    otherAllowances: number | null;
    allowances: number | null;
    salaryDeductions: Array<{
      id?: string | null;
      title: string;
      amount: number;
    }>;
    isActive: boolean;
  };
};

function pickText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function toNullableNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstDate(...values: unknown[]) {
  for (const value of values) {
    const date = toDateSafe(value);
    if (date) return date;
  }
  return null;
}

function normalizeAvatar(
  value: unknown,
  fallbackPhotoUrl?: string | null
): { avatar: EmployeeAvatarDoc | null; avatarUrl: string } {
  if (typeof value === "string") {
    const avatarUrl = String(value || "").trim();
    return {
      avatar: avatarUrl ? { fileUrl: avatarUrl } : null,
      avatarUrl,
    };
  }

  if (value && typeof value === "object") {
    const raw = value as Record<string, any>;
    const filePath = pickText(raw.filePath, raw.path);
    const fileUrl = pickText(
      raw.fileUrl,
      raw.url,
      raw.photoURL,
      filePath ? buildR2DownloadUrl(filePath, false) : ""
    );

    const avatar: EmployeeAvatarDoc = {
      id: pickText(raw.id) || null,
      fileName: pickText(raw.fileName, raw.name) || null,
      filePath: filePath || null,
      fileUrl: fileUrl || null,
      contentType: pickText(raw.contentType, raw.type) || null,
      fileSize: toNullableNumber(raw.fileSize, raw.size),
      uploadedAt: raw.uploadedAt ?? null,
    };

    if (avatar.fileUrl || avatar.filePath) {
      return {
        avatar,
        avatarUrl: avatar.fileUrl || "",
      };
    }
  }

  const normalizedFallback = String(fallbackPhotoUrl || "").trim();
  return {
    avatar: normalizedFallback ? { fileUrl: normalizedFallback } : null,
    avatarUrl: normalizedFallback,
  };
}

function normalizeEmploymentStatus(input: {
  rawStatus: unknown;
  isActive: boolean;
}): {
  key: string;
  label: string;
  tone: "success" | "warning" | "muted";
} {
  const normalized = String(input.rawStatus || "")
    .trim()
    .toLowerCase();

  const resolved = normalized || (input.isActive ? "active" : "inactive");

  const map: Record<
    string,
    {
      label: string;
      tone: "success" | "warning" | "muted";
    }
  > = {
    active: { label: "على رأس العمل", tone: "success" },
    probation: { label: "فترة تجربة", tone: "warning" },
    on_leave: { label: "في إجازة", tone: "warning" },
    onleave: { label: "في إجازة", tone: "warning" },
    inactive: { label: "غير نشط", tone: "muted" },
    suspended: { label: "موقوف", tone: "muted" },
    terminated: { label: "منتهي الارتباط الوظيفي", tone: "muted" },
  };

  const matched = map[resolved];
  if (matched) {
    return {
      key: resolved,
      label: matched.label,
      tone: matched.tone,
    };
  }

  return {
    key: resolved || "unknown",
    label: String(input.rawStatus || EMPTY_VALUE).trim() || EMPTY_VALUE,
    tone: input.isActive ? "success" : "muted",
  };
}

export function normalizeEmployeeProfile(
  source: EmployeeProfileUserDoc | null | undefined,
  authFallback?: {
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
  }
): EmployeeProfileViewModel {
  const user = source || {};
  const rawUser = user as Record<string, any>;
  const employeeProfile = user.employeeProfile || {};
  const personal = (employeeProfile.personal || user.personal || {}) as Record<
    string,
    any
  >;
  const employment = (employeeProfile.employment ||
    user.employment ||
    {}) as Record<string, any>;
  const accountStatus = resolveUserAccountStatus(user);

  const name =
    pickText(
      user.displayName,
      user.name,
      user.fullName,
      personal.name,
      user.profile?.name,
      user.profile?.displayName,
      authFallback?.displayName
    ) || EMPTY_VALUE;

  const email =
    pickText(
      user.email,
      personal.email,
      user.profile?.email,
      authFallback?.email
    ) || EMPTY_VALUE;

  const phone =
    pickText(
      personal.phone,
      user.phone,
      user.mobile,
      user.phoneNumber,
      user.contact?.phone,
      user.profile?.phone
    ) || "";

  const normalizedAvatar = normalizeAvatar(
    personal.avatar ?? user.profile?.avatar ?? user.photoURL,
    authFallback?.photoURL
  );
  const avatar = normalizedAvatar.avatar;
  const avatarUrl =
    normalizedAvatar.avatarUrl ||
    getDefaultEmployeeAvatarUrl({
      id: pickText(
        rawUser.linkedEmployeeId,
        rawUser.employeeId,
        rawUser.uid,
        rawUser.id,
        email
      ),
      uid: rawUser.uid,
      name,
      displayName: rawUser.displayName,
      email,
      gender: pickText(
        personal.gender,
        personal.sex,
        rawUser.gender,
        rawUser.sex,
        rawUser.profile?.gender,
        rawUser.profile?.sex,
        rawUser.employeeProfile?.gender
      ),
    });

  const title =
    pickText(
      employment.title,
      user.title,
      employment.jobTitle,
      user.profile?.title
    ) || EMPTY_VALUE;

  const department =
    pickText(
      employment.department,
      user.department,
      employment.team,
      employment.division,
      user.profile?.department
    ) || EMPTY_VALUE;

  const startDate = firstDate(
    employment.startDate,
    user.startDate,
    employment.hireDate,
    user.hireDate,
    user.joinedAt
  );

  const leaveBalance = toNullableNumber(
    employment.leaveBalance,
    user.leaveBalance,
    employment.leaveDaysBalance
  );

  const leaveBalanceLabel =
    leaveBalance === null ? EMPTY_VALUE : `${formatNumberEN(leaveBalance)} يوم`;

  const employeeCode =
    pickText(
      employment.employeeCode,
      user.employeeCode,
      user.employeeId,
      user.profile?.employeeCode
    ) || EMPTY_VALUE;

  const fingerprintNumber =
    pickText(
      employment.fingerprintNumber,
      user.fingerprintNumber,
      user.profile?.fingerprintNumber
    ) || EMPTY_VALUE;
  const workSchedule = (employment.workSchedule || {}) as Record<string, any>;
  const shiftStartTime = pickText(
    workSchedule.startTime,
    employment.shiftStartTime
  );
  const shiftEndTime = pickText(workSchedule.endTime, employment.shiftEndTime);
  const weeklyOffDays = normalizeWeeklyOffDays(
    workSchedule.weeklyOffDays ?? employment.weeklyOffDays
  );
  const allowedZoneIds = Array.isArray(employment.allowedZoneIds)
    ? employment.allowedZoneIds.filter(Boolean)
    : [];
  const attendanceZoneLabel = allowedZoneIds.length
    ? `${formatNumberEN(allowedZoneIds.length)} نطاق معتمد`
    : EMPTY_VALUE;
  const salaryDeductions = Array.isArray(employment.salaryDeductions)
    ? employment.salaryDeductions
        .map((item: Record<string, any>) => ({
          id: pickText(item?.id) || null,
          title: pickText(item?.title, item?.name) || "خصم ثابت",
          amount: toNullableNumber(item?.amount) || 0,
        }))
        .filter(item => item.amount > 0)
    : [];
  const housingAllowance = toNullableNumber(employment.housingAllowance);
  const transportationAllowance = toNullableNumber(
    employment.transportationAllowance
  );
  const otherAllowances = toNullableNumber(employment.otherAllowances);
  const calculatedAllowances: number = [
    housingAllowance,
    transportationAllowance,
    otherAllowances,
  ].reduce<number>((sum, value) => {
    return sum + (typeof value === "number" ? Math.max(0, value) : 0);
  }, 0);

  const employmentStatus = normalizeEmploymentStatus({
    rawStatus:
      (employment.employmentStatus as
        | EmployeeEmploymentStatus
        | null
        | undefined) ??
      (employment.status as EmployeeEmploymentStatus | null | undefined) ??
      user.status,
    isActive: accountStatus.isActive,
  });

  return {
    personal: {
      name,
      email,
      phone,
      avatar,
      avatarUrl,
    },
    employment: {
      title,
      department,
      startDate,
      leaveBalance,
      leaveBalanceLabel,
      statusKey: employmentStatus.key,
      statusLabel: employmentStatus.label,
      statusTone: employmentStatus.tone,
      employeeCode,
      fingerprintNumber,
      shiftStartTime,
      shiftEndTime,
      weeklyOffDays,
      weeklyOffDaysLabel: formatWeeklyOffDaysLabel(weeklyOffDays),
      attendanceZoneLabel,
      baseSalary: toNullableNumber(employment.baseSalary),
      insuranceDeduction: toNullableNumber(employment.insuranceDeduction),
      housingAllowance,
      transportationAllowance,
      otherAllowances,
      allowances:
        toNullableNumber(employment.allowances) ??
        (calculatedAllowances > 0 ? calculatedAllowances : null),
      salaryDeductions,
      isActive: accountStatus.isActive,
    },
  };
}

export function buildEmployeePhonePatch(phone: string) {
  const normalizedPhone = String(phone || "").trim();
  return {
    phone: normalizedPhone,
    profile: {
      phone: normalizedPhone,
    },
    employeeProfile: {
      personal: {
        phone: normalizedPhone,
      },
    },
  };
}

export function buildEmployeeAvatarPatch(avatar: EmployeeAvatarDoc | null) {
  const filePath = String(avatar?.filePath || "").trim();
  const fileUrl = pickText(
    avatar?.fileUrl,
    filePath ? buildR2DownloadUrl(filePath, false) : ""
  );

  return {
    photoURL: fileUrl || null,
    profile: {
      photoURL: fileUrl || null,
      avatar:
        avatar && (avatar.filePath || avatar.fileUrl)
          ? {
              ...avatar,
              fileUrl: fileUrl || null,
            }
          : null,
    },
    employeeProfile: {
      personal: {
        avatar:
          avatar && (avatar.filePath || avatar.fileUrl)
            ? {
                ...avatar,
                fileUrl: fileUrl || null,
              }
            : null,
      },
    },
  };
}

export { EMPLOYEE_AVATAR_CATEGORY, EMPTY_VALUE as EMPLOYEE_EMPTY_VALUE };
