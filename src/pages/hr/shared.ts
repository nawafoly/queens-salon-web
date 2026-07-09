import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { getDoc, getDocs, limit, query, where } from "firebase/firestore";

import { auth } from "../../services/firebase";
import { hrCollection, hrDoc, type HrCollectionKey } from "../../services/hrCollections";
import { normalizeAuthRole } from "../../services/authAccess";

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

function uniqueText(values: unknown[]) {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function recordUidCandidates(data: Record<string, any> | null | undefined) {
  return uniqueText([
    data?.linkedUid,
    data?.uid,
    data?.linkedUserId,
    data?.employeeUid,
  ]);
}

function recordEmailCandidates(data: Record<string, any> | null | undefined) {
  return uniqueText([data?.email, data?.userEmail]).map((item) => item.toLowerCase());
}

function hasAttendanceZone(data: Record<string, any> | null | undefined) {
  const employment = data?.employeeProfile?.employment || data?.employment || {};
  const allowedZoneIds = Array.isArray(employment?.allowedZoneIds)
    ? employment.allowedZoneIds
    : Array.isArray(data?.allowedZoneIds)
      ? data.allowedZoneIds
      : [];

  return Boolean(
    cleanText(data?.allowedAttendanceZoneId) ||
      cleanText(data?.attendanceZoneId) ||
      cleanText(data?.assignedAttendanceZoneId) ||
      cleanText(data?.attendanceScopeId) ||
      cleanText(employment?.allowedAttendanceZoneId) ||
      cleanText(employment?.attendanceZoneId) ||
      cleanText(employment?.assignedAttendanceZoneId) ||
      cleanText(employment?.attendanceScopeId) ||
      allowedZoneIds.map(cleanText).some(Boolean)
  );
}

type EmployeeSessionRecord = {
  id: string;
  source: "employees" | "staffPublic";
  data: Record<string, any>;
};

async function readEmployeeSessionDoc(
  key: "employees" | "staffPublic",
  id: string
): Promise<EmployeeSessionRecord | null> {
  const cleanId = cleanText(id);
  if (!cleanId) return null;

  try {
    const snap = await getDoc(hrDoc(key, cleanId));
    return snap.exists()
      ? {
          id: snap.id,
          source: key,
          data: { id: snap.id, documentId: snap.id, ...(snap.data() as Record<string, any>) },
        }
      : null;
  } catch (error) {
    console.warn(`[useEmployeeSession] failed to read ${key}/${cleanId}`, error);
    return null;
  }
}

async function queryEmployeeSessionDocs(
  key: "employees" | "staffPublic",
  fieldName: string,
  value: string,
  maxRows = 5
): Promise<EmployeeSessionRecord[]> {
  const cleanValue = cleanText(value);
  if (!cleanValue) return [];

  try {
    const snap = await getDocs(
      query(
        hrCollection(key as HrCollectionKey),
        where(fieldName, "==", cleanValue),
        limit(maxRows)
      )
    );

    return snap.docs.map((entry) => ({
      id: entry.id,
      source: key,
      data: { id: entry.id, documentId: entry.id, ...(entry.data() as Record<string, any>) },
    }));
  } catch (error) {
    console.warn(`[useEmployeeSession] failed to query ${key}.${fieldName}`, error);
    return [];
  }
}

function recordBelongsToUser(
  record: EmployeeSessionRecord,
  uid: string,
  email: string,
  trustedEmployeeIds: Set<string>,
  trustedEmailIds: Set<string>
) {
  if (trustedEmployeeIds.has(record.id)) return true;

  const uidMatches = recordUidCandidates(record.data).includes(uid) || record.id === uid;
  if (uidMatches) return true;

  const recordUids = recordUidCandidates(record.data);
  const hasConflictingUid = recordUids.length > 0 && !recordUids.includes(uid);
  if (hasConflictingUid) return false;

  return Boolean(
    email &&
      trustedEmailIds.has(record.id) &&
      recordEmailCandidates(record.data).includes(email)
  );
}

function recordPriority(record: EmployeeSessionRecord, preferredEmployeeIds: Set<string>) {
  let score = 0;
  if (preferredEmployeeIds.has(record.id)) score += 100;
  if (recordUidCandidates(record.data).length) score += 60;
  if (hasAttendanceZone(record.data)) score += 20;
  if (record.source === "employees") score += 10;
  return score;
}

async function resolveEmployeeSessionRecords(args: {
  uid: string;
  email: string;
  userDoc: Record<string, any> | null;
}) {
  const uid = cleanText(args.uid);
  const email = cleanEmail(args.email);
  const userDoc = args.userDoc || {};
  const explicitEmployeeIds = uniqueText([
    userDoc?.employeeId,
    userDoc?.linkedEmployeeDocId,
  ]).filter((id) => id !== uid);
  const lookupIds = uniqueText([...explicitEmployeeIds, uid]);

  const directRecords = await Promise.all(
    lookupIds.flatMap((id) => [
      readEmployeeSessionDoc("employees", id),
      readEmployeeSessionDoc("staffPublic", id),
    ])
  );

  const uidQueries = uid
    ? await Promise.all([
        queryEmployeeSessionDocs("employees", "linkedUid", uid),
        queryEmployeeSessionDocs("employees", "uid", uid),
        queryEmployeeSessionDocs("employees", "linkedUserId", uid),
        queryEmployeeSessionDocs("staffPublic", "linkedUid", uid),
        queryEmployeeSessionDocs("staffPublic", "uid", uid),
        queryEmployeeSessionDocs("staffPublic", "linkedUserId", uid),
      ])
    : [];

  const emailQueries = email
    ? await Promise.all([
        queryEmployeeSessionDocs("staffPublic", "email", email, 3),
        queryEmployeeSessionDocs("staffPublic", "userEmail", email, 3),
      ])
    : [];

  const byKey = new Map<string, EmployeeSessionRecord>();
  for (const record of [
    ...directRecords.filter(Boolean),
    ...uidQueries.flat(),
    ...emailQueries.flat(),
  ] as EmployeeSessionRecord[]) {
    byKey.set(`${record.source}:${record.id}`, record);
  }

  const allRecords = Array.from(byKey.values());
  const emailMatchedIds = new Set(
    allRecords
      .filter((record) => {
        const recordUids = recordUidCandidates(record.data);
        return (
          email &&
          recordEmailCandidates(record.data).includes(email) &&
          !recordUids.some((candidate) => candidate !== uid)
        );
      })
      .map((record) => record.id)
  );
  const trustedEmailIds = emailMatchedIds.size === 1 ? emailMatchedIds : new Set<string>();
  const preferredSet = new Set(explicitEmployeeIds);
  const linkedRecords = allRecords
    .filter((record) => recordBelongsToUser(record, uid, email, preferredSet, trustedEmailIds))
    .sort((left, right) => recordPriority(right, preferredSet) - recordPriority(left, preferredSet));

  const canonicalId = cleanText(
    linkedRecords[0]?.id ||
      userDoc?.employeeId ||
      userDoc?.linkedEmployeeDocId ||
      uid
  );

  const [employeeRecord, staffRecord] = await Promise.all([
    readEmployeeSessionDoc("employees", canonicalId),
    readEmployeeSessionDoc("staffPublic", canonicalId),
  ]);

  const employeeDoc =
    employeeRecord?.data ||
    linkedRecords.find((record) => record.source === "employees" && record.id === canonicalId)?.data ||
    null;

  const staffDoc =
    staffRecord?.data ||
    linkedRecords.find((record) => record.source === "staffPublic" && record.id === canonicalId)?.data ||
    null;

  return {
    employeeId: canonicalId,
    employeeDoc,
    staffDoc,
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

      const uid = user.uid;
      const email = cleanEmail(user.email || "");
      const displayName = cleanText(user.displayName || "");

      const userDoc = await getDoc(hrDoc("users", uid))
        .then((snap) => (snap.exists() ? (snap.data() as Record<string, any>) : null))
        .catch((error) => {
          console.error("[useEmployeeSession] failed to load user doc", error);
          return null;
        });
      const role = normalizeAuthRole(userDoc?.role || "guest");
      const resolvedEmployee = await resolveEmployeeSessionRecords({
        uid,
        email,
        userDoc,
      });
      const employeeId = resolvedEmployee.employeeId;

      if (!alive || requestId !== requestSeqRef.current) return;
      setSession({
        user,
        uid: cleanText(uid),
        email: cleanEmail(userDoc?.email || email || ""),
        displayName: cleanText(
          userDoc?.displayName || userDoc?.name || displayName || ""
        ),
        role,
        employeeId,
        userDoc,
        employeeDoc: resolvedEmployee.employeeDoc || null,
        staffDoc: resolvedEmployee.staffDoc || null,
        loading: false,
      });
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
