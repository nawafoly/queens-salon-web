import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { getDoc } from "firebase/firestore";

import { auth } from "../../services/firebase";
import { hrDoc } from "../../services/hrCollections";
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
      const employeeId = cleanText(
        userDoc?.employeeId || userDoc?.linkedEmployeeDocId || uid
      );

      const [employeeDoc, staffDoc] = await Promise.all([
        employeeId
          ? getDoc(hrDoc("employees", employeeId))
              .then((snap) => (snap.exists() ? (snap.data() as Record<string, any>) : null))
              .catch((error) => {
                console.error("[useEmployeeSession] failed to load employee doc", error);
                return null;
              })
          : Promise.resolve(null),
        employeeId
          ? getDoc(hrDoc("staffPublic", employeeId))
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
        email: cleanEmail(userDoc?.email || email || ""),
        displayName: cleanText(
          userDoc?.displayName || userDoc?.name || displayName || ""
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
