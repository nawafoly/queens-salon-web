

// src/services/serviceResolver.ts
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

const SALON_ID = "main";
const cache = new Map<string, string>();

export async function resolveServiceName(serviceId?: string) {
    if (!serviceId) return "—";

    // كاش عشان ما نضرب Firestore كل مرة
    if (cache.has(serviceId)) {
        return cache.get(serviceId)!;
    }

    try {
        const ref = doc(db, "salons", SALON_ID, "services", serviceId);
        const snap = await getDoc(ref);

        const name = snap.exists() ? snap.data()?.name || "—" : "—";
        cache.set(serviceId, name);
        return name;
    } catch {
        return "—";
    }
}

