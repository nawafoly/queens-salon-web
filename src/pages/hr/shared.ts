import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../../services/firebase";
import { SALON_ID } from "../../services/employeeHub";

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

export function useEmployeeSession() {
  const [session, setSession] = useState<HrSession>({
    user: null,
    uid: "",
    email: "",
    displayName: "",
    role: "guest",
    employeeId: "",
    userDoc: null,
    employeeDoc: null,
    staffDoc: null,
    loading: true,
  });

  useEffect(() => {
    let alive = true;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!alive) return;

      if (!user) {
        setSession({
          user: null,
          uid: "",
          email: "",
          displayName: "",
          role: "guest",
          employeeId: "",
          userDoc: null,
          employeeDoc: null,
          staffDoc: null,
          loading: false,
        });
        return;
      }

      const uid = user.uid;
      const email = cleanEmail(user.email || "");
      const displayName = cleanText(user.displayName || "");
      const userSnap = await getDoc(doc(db, "salons", SALON_ID, "users", uid));
      const userDoc = userSnap.exists() ? (userSnap.data() as Record<string, any>) : null;
      const role = cleanText(userDoc?.role || "guest").toLowerCase() || "guest";
      const employeeId = cleanText(userDoc?.employeeId || userDoc?.linkedEmployeeDocId || uid);

      const employeeSnap = employeeId
        ? await getDoc(doc(db, "salons", SALON_ID, "employees", employeeId))
        : null;
      const employeeDoc = employeeSnap?.exists() ? (employeeSnap.data() as Record<string, any>) : null;

      const staffSnap = employeeId
        ? await getDoc(doc(db, "salons", SALON_ID, "staff_public", employeeId))
        : null;
      const staffDoc = staffSnap?.exists() ? (staffSnap.data() as Record<string, any>) : null;

      if (!alive) return;
      setSession({
        user,
        uid,
        email: cleanEmail(userDoc?.email || email || ""),
        displayName: cleanText(userDoc?.displayName || userDoc?.name || displayName || ""),
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
