import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../../services/firebase";
import { SALON_ID } from "../../services/employeeHub";
import { readStoredAuthSession } from "../../services/localAuthSession";

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

function createBootstrapSession(): HrSession {
  const stored = readStoredAuthSession();
  if (!stored) return createGuestSession(true);

  const uid = cleanText(stored.uid);
  const email = cleanEmail(stored.email || "");
  const displayName = cleanText(stored.displayName || "");
  const role = cleanText(stored.role || "guest").toLowerCase() || "guest";

  return {
    user: uid
      ? ({ uid, email: email || null, displayName: displayName || null } as FirebaseUser)
      : null,
    uid,
    email,
    displayName,
    role,
    employeeId: uid,
    userDoc: null,
    employeeDoc: null,
    staffDoc: null,
    loading: false,
  };
}

function createLoggedOutSession(): HrSession {
  return createGuestSession(false);
}

export function useEmployeeSession() {
  const [session, setSession] = useState<HrSession>(() => createBootstrapSession());
  const requestSeqRef = useRef(0);

  useEffect(() => {
    let alive = true;

    const unsub = onAuthStateChanged(auth, async (user) => {
      const requestId = ++requestSeqRef.current;
      if (!alive) return;

      if (!user) {
        if (requestId !== requestSeqRef.current) return;
        const storedSession = readStoredAuthSession();
        setSession(storedSession ? createBootstrapSession() : createLoggedOutSession());
        return;
      }

      const uid = user.uid;
      const email = cleanEmail(user.email || "");
      const displayName = cleanText(user.displayName || "");

      const storedSession = readStoredAuthSession();
      const userDoc = await getDoc(doc(db, "salons", SALON_ID, "users", uid))
        .then((snap) => (snap.exists() ? (snap.data() as Record<string, any>) : null))
        .catch((error) => {
          console.error("[useEmployeeSession] failed to load user doc", error);
          return null;
        });
      const role = cleanText(userDoc?.role || storedSession?.role || "guest").toLowerCase() || "guest";
      const employeeId = cleanText(
        userDoc?.employeeId || userDoc?.linkedEmployeeDocId || storedSession?.uid || uid
      );

      const [employeeDoc, staffDoc] = await Promise.all([
        employeeId
          ? getDoc(doc(db, "salons", SALON_ID, "employees", employeeId))
              .then((snap) => (snap.exists() ? (snap.data() as Record<string, any>) : null))
              .catch((error) => {
                console.error("[useEmployeeSession] failed to load employee doc", error);
                return null;
              })
          : Promise.resolve(null),
        employeeId
          ? getDoc(doc(db, "salons", SALON_ID, "staff_public", employeeId))
              .then((snap) => (snap.exists() ? (snap.data() as Record<string, any>) : null))
              .catch((error) => {
                console.error("[useEmployeeSession] failed to load staff doc", error);
                return null;
              })
          : Promise.resolve(null),
      ]);

      if (!alive || requestId !== requestSeqRef.current) return;
      setSession({
        user,
        uid: cleanText(uid),
        email: cleanEmail(userDoc?.email || storedSession?.email || email || ""),
        displayName: cleanText(
          userDoc?.displayName || userDoc?.name || storedSession?.displayName || displayName || ""
        ),
        role,
        employeeId,
        userDoc,
        employeeDoc: employeeDoc || null,
        staffDoc: staffDoc || null,
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
