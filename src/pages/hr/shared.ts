import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { auth } from "../../services/firebase";
import { normalizeAuthRole } from "../../services/authAccess";
import { CoreAccountService } from "../../services/CoreAccountService";
import { CoreHrService } from "../../services/CoreHrService";

export type HrSession = {
  user: FirebaseUser | null;
  uid: string;
  email: string;
  displayName: string;
  role: string;
  employeeId: string;
  userDoc: Record<string, any> | null;
  employeeDoc: Record<string, any> | null;
  staffDoc: Record<string, any> | null;
  loading: boolean;
};

export type OptionItem = {
  value: string;
  label: string;
  description?: string;
};

export function cleanText(value: unknown) {
  return String(value || "").trim();
}

export function cleanEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

export function formatShortDate(value?: string) {
  const s = cleanText(value);
  if (!s) return "—";
  return s;
}

function isBrokenIdentityText(value: unknown) {
  const text = cleanText(value);
  if (!text) return true;
  const compact = text.replace(/\s+/g, "");
  if (!compact) return true;
  return compact.replace(/[?\uFFFD]/g, "").length === 0;
}

function firstUsableIdentityText(values: unknown[]) {
  for (const value of values) {
    const text = cleanText(value);
    if (text && !isBrokenIdentityText(text)) return text;
  }
  return "";
}

function identityRecordParts(data: Record<string, any> | null | undefined) {
  const record = data || {};
  const employeeProfile =
    record.employeeProfile && typeof record.employeeProfile === "object"
      ? record.employeeProfile
      : {};
  const personal =
    employeeProfile.personal && typeof employeeProfile.personal === "object"
      ? employeeProfile.personal
      : record.personal && typeof record.personal === "object"
        ? record.personal
        : {};
  const profile =
    record.profile && typeof record.profile === "object"
      ? record.profile
      : {};

  return { record, employeeProfile, personal, profile };
}

function identityNameCandidates(data: Record<string, any> | null | undefined) {
  const { record, employeeProfile, personal, profile } = identityRecordParts(data);
  return [
    record.displayName,
    record.name,
    record.fullName,
    record.employeeName,
    record.nameAr,
    record.arabicName,
    personal.displayName,
    personal.name,
    personal.fullName,
    employeeProfile.displayName,
    employeeProfile.name,
    employeeProfile.fullName,
    profile.displayName,
    profile.name,
    profile.fullName,
  ];
}

function identityAvatarCandidates(data: Record<string, any> | null | undefined) {
  const { record, employeeProfile, personal, profile } = identityRecordParts(data);
  return [
    record.avatarUrl,
    record.avatarURL,
    record.photoURL,
    record.photoUrl,
    record.imageUrl,
    record.imageURL,
    record.profileImageUrl,
    record.profileImage,
    record.profilePhotoUrl,
    record.profilePhoto,
    record.photo,
    record.image,
    record.picture,
    record.avatar,
    employeeProfile.avatarUrl,
    employeeProfile.avatarURL,
    employeeProfile.photoURL,
    employeeProfile.photoUrl,
    employeeProfile.imageUrl,
    employeeProfile.imageURL,
    employeeProfile.profileImageUrl,
    employeeProfile.profileImage,
    employeeProfile.profilePhotoUrl,
    employeeProfile.profilePhoto,
    employeeProfile.photo,
    employeeProfile.image,
    personal.avatarUrl,
    personal.avatarURL,
    personal.photoURL,
    personal.photoUrl,
    personal.imageUrl,
    personal.imageURL,
    personal.profileImageUrl,
    personal.profileImage,
    personal.profilePhotoUrl,
    personal.profilePhoto,
    personal.photo,
    personal.image,
    profile.avatarUrl,
    profile.avatarURL,
    profile.photoURL,
    profile.photoUrl,
    profile.imageUrl,
    profile.imageURL,
    profile.profileImageUrl,
    profile.profileImage,
    profile.profilePhotoUrl,
    profile.profilePhoto,
    profile.photo,
    profile.image,
  ];
}

function resolveSessionDisplayName(args: {
  employeeDoc: Record<string, any> | null;
  staffDoc: Record<string, any> | null;
  userDoc: Record<string, any> | null;
  authDisplayName?: string | null;
  email?: string | null;
}) {
  return (
    firstUsableIdentityText([
      ...identityNameCandidates(args.employeeDoc),
      ...identityNameCandidates(args.staffDoc),
      ...identityNameCandidates(args.userDoc),
      args.authDisplayName,
    ]) || cleanEmail(args.email || "") || "الموظفة"
  );
}

function resolveSessionAvatarUrl(args: {
  employeeDoc: Record<string, any> | null;
  staffDoc: Record<string, any> | null;
  userDoc: Record<string, any> | null;
  authPhotoUrl?: string | null;
}) {
  return cleanText(
    [
      ...identityAvatarCandidates(args.employeeDoc),
      ...identityAvatarCandidates(args.staffDoc),
      ...identityAvatarCandidates(args.userDoc),
      args.authPhotoUrl,
    ]
      .map(cleanText)
      .find(Boolean) || ""
  );
}

function booleanFlag(value: unknown, fallback = true) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = cleanText(value).toLowerCase();
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  return fallback;
}

function normalizeCoreEmployeeSessionDoc(raw: Record<string, any> | null | undefined) {
  if (!raw) return null;
  const employment =
    raw.employment && typeof raw.employment === "object"
      ? raw.employment
      : {};

  const phone = cleanText(
    raw.phone ||
      raw.phoneNormalized ||
      raw.phone_normalized ||
      employment.phone ||
      ""
  );
  const department = cleanText(
    raw.department ||
      employment.department ||
      ""
  );
  const title = cleanText(
    raw.title ||
      employment.title ||
      employment.jobTitle ||
      employment.job_title ||
      ""
  );

  return {
    ...raw,
    displayName: firstUsableIdentityText([raw.displayName, raw.name]),
    ...(phone ? { phone } : {}),
    department,
    title,
    employeeProfileEnabled: booleanFlag(
      raw.employeeProfileEnabled ??
        raw.includeInEmployeeManagement ??
        raw.include_in_employee_management,
      true
    ),
    showOnAbout: booleanFlag(
      raw.showOnAbout ?? raw.show_on_about,
      true
    ),
    employment,
  };
}

function createGuestSession(loading: boolean): HrSession {
  return {
    user: null,
    uid: "",
    email: "",
    displayName: "",
    role: "guest",
    employeeId: "",
    userDoc: null,
    employeeDoc: null,
    staffDoc: null,
    loading,
  };
}

function createLoggedOutSession(): HrSession {
  return createGuestSession(false);
}

export function useEmployeeSession() {
  const [session, setSession] = useState<HrSession>(() => createGuestSession(true));
  const requestSeqRef = useRef(0);

  useEffect(() => {
    let alive = true;

    const unsub = onAuthStateChanged(auth, async (user) => {
      const requestId = ++requestSeqRef.current;
      if (!alive) return;

      if (!user) {
        if (requestId !== requestSeqRef.current) return;
        setSession(createLoggedOutSession());
        return;
      }

      const uid = cleanText(user.uid);
      const authEmail = cleanEmail(user.email || "");
      const authDisplayName = cleanText(user.displayName || "");

      try {
        // Firebase authenticates only. Operational account status, role,
        // permissions and employee linkage are canonical Core D1 data.
        const me = await CoreAccountService.me();
        const account = me.user || ({} as any);
        const employeeId = cleanText(
          me.employeeLink?.employeeId ||
            account.employeeLink?.employeeId ||
            ""
        );

        let coreEmployee: Record<string, any> | null = null;
        if (employeeId) {
          try {
            coreEmployee = (await CoreHrService.getMyEmployeeProfile()) as unknown as Record<string, any>;
          } catch (error) {
            console.error("[useEmployeeSession] failed to load Core employee profile", error);
            const linked = me.employeeLink?.employee || account.employeeLink?.employee || null;
            if (linked) {
              coreEmployee = {
                id: employeeId,
                name: linked.name,
                email: linked.email,
                phone: linked.phone,
              };
            }
          }
        }

        const normalizedEmployeeDoc = normalizeCoreEmployeeSessionDoc(coreEmployee);
        const normalizedUserDoc: Record<string, any> = {
          ...account,
          employeeLink: me.employeeLink || account.employeeLink || null,
          permissions: me.permissions || account.permissions || [],
        };
        const role = normalizeAuthRole(
          account.role || account.primaryRole || me.roles?.[0] || "guest"
        );
        const resolvedDisplayName = resolveSessionDisplayName({
          employeeDoc: normalizedEmployeeDoc,
          staffDoc: normalizedEmployeeDoc,
          userDoc: normalizedUserDoc,
          authDisplayName,
          email: account.email || authEmail,
        });
        const resolvedAvatarUrl = resolveSessionAvatarUrl({
          employeeDoc: normalizedEmployeeDoc,
          staffDoc: normalizedEmployeeDoc,
          userDoc: normalizedUserDoc,
          authPhotoUrl: user.photoURL,
        });

        const employeeDoc = normalizedEmployeeDoc
          ? {
              ...normalizedEmployeeDoc,
              ...(resolvedAvatarUrl ? { avatarUrl: resolvedAvatarUrl } : {}),
            }
          : null;
        const userDoc = {
          ...normalizedUserDoc,
          displayName: resolvedDisplayName,
          ...(resolvedAvatarUrl ? { avatarUrl: resolvedAvatarUrl } : {}),
        };

        if (!alive || requestId !== requestSeqRef.current) return;
        setSession({
          user,
          uid,
          email: cleanEmail(account.email || authEmail),
          displayName: resolvedDisplayName,
          role,
          employeeId,
          userDoc,
          employeeDoc,
          // Compatibility shape for employee pages that still prefer staffDoc;
          // the value is Core-derived, never a Firestore mirror.
          staffDoc: employeeDoc,
          loading: false,
        });
      } catch (error) {
        console.error("[useEmployeeSession] failed to resolve canonical Core session", error);
        if (!alive || requestId !== requestSeqRef.current) return;
        // Fail closed: a Firebase identity alone grants no operational role or
        // employee linkage when Core account resolution is unavailable.
        setSession({
          user,
          uid,
          email: authEmail,
          displayName: authDisplayName || authEmail || "الموظفة",
          role: "guest",
          employeeId: "",
          userDoc: null,
          employeeDoc: null,
          staffDoc: null,
          loading: false,
        });
      }
    });

    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return session;
}

export function useEmployeeRosterOptions(items: Array<{ value: string; label: string; description?: string }>) {
  return useMemo(() => items.filter((item) => !!cleanText(item.value)), [items]);
}
