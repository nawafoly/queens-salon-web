import {
    collection,
    addDoc,
    getDocs,
    query,
    orderBy,
    serverTimestamp,
  } from "firebase/firestore";
  import { db } from "./firebase";
  
  const SALON_ID = "main";
  const COL_PATH = ["salons", SALON_ID, "client_packages"] as const;
  
  export type ClientPackage = {
    id?: string;
    clientId: string;
  
    packageId: string;
    packageName: string;
  
    serviceIds: string[];
  
    totalSessions: number;
    usedSessions: number;
    remainingSessions: number;
  
    pricePaid: number;
  
    active: boolean;
  
    createdAt?: any;
    updatedAt?: any;
  };
  
  export const ClientPackageService = {
    async getAll(): Promise<ClientPackage[]> {
      const q = query(collection(db, ...COL_PATH), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
  
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ClientPackage, "id">),
      }));
    },
  
    async add(item: ClientPackage) {
      await addDoc(collection(db, ...COL_PATH), {
        ...item,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
  };