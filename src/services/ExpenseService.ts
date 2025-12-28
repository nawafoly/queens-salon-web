// src/services/ExpenseService.ts
import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Expense } from "../types/finance";

const SALON_ID = "main";
const COL_PATH = ["salons", SALON_ID, "expenses"] as const;

export const ExpenseService = {
  async getAll(): Promise<Expense[]> {
    const q = query(collection(db, ...COL_PATH), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Expense, "id">),
    }));
  },

  async add(item: Expense) {
    await addDoc(collection(db, ...COL_PATH), {
      ...item,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  async update(id: string, patch: Partial<Expense>) {
    await updateDoc(doc(db, ...COL_PATH, id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  },

  async remove(id: string) {
    await deleteDoc(doc(db, ...COL_PATH, id));
  },

  async getTotal(): Promise<number> {
    const items = await this.getAll();
    return items.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  },
};
