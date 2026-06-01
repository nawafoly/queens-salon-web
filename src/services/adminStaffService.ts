// src/services/adminStaffService.ts

import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase"; // ⬅️ نجيب app فقط

export type StaffCreateRole = "staff" | "hr" | "reception" | "admin";

export type AdminCreateStaffInput = {
  email: string;
  password: string;
  displayName: string;
  phone?: string;
  role: StaffCreateRole;
  employeeId?: string;
  department?: string;
  title?: string;
  avatarUrl?: string;
  employeeProfileEnabled?: boolean;
  showOnAbout?: boolean;
  showOnBooking?: boolean;

  // staff only
  specialties?: string[];
  bio?: string;
};

type AdminCreateStaffResponse = {
  ok: boolean;
  uid: string;
  employeeId: string;
  email: string;
  role: string;
  displayName: string;
};

// ✅ مهم جدًا: نفس region حق الـ Functions
const functions = getFunctions(app, "us-central1");

export async function adminCreateStaffUser(
  input: AdminCreateStaffInput
): Promise<AdminCreateStaffResponse> {
  const call = httpsCallable<AdminCreateStaffInput, AdminCreateStaffResponse>(
    functions,
    "adminCreateStaffUser"
  );

  const res = await call(input);
  return res.data;
}
