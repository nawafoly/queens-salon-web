import { initializeApp, getApps } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";

import { auth } from "./firebase";
import { CoreAccountService } from "./CoreAccountService";
import { CoreHrService } from "./CoreHrService";
import { CoreWorkforceService } from "./CoreWorkforceService";

export type EmployeeOnboardingRole =
  | "staff"
  | "reception"
  | "hr"
  | "accountant"
  | "admin";

export type PendingEmployeeOnboarding = {
  createLogin: boolean;
  displayName: string;
  email: string;
  phone: string;
  role: EmployeeOnboardingRole;
  password: string;
};

let pendingEmployeeOnboarding: PendingEmployeeOnboarding | null = null;

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizedEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

export function makeEmployeeTempPassword() {
  return `Hr${Math.random().toString(36).slice(2, 6)}${Math.random().toString(36).slice(2, 6)}!`;
}

export function queueEmployeeOnboarding(input: PendingEmployeeOnboarding) {
  pendingEmployeeOnboarding = {
    ...input,
    displayName: cleanText(input.displayName),
    email: normalizedEmail(input.email),
    phone: cleanText(input.phone),
    password: cleanText(input.password),
  };
}

export function clearEmployeeOnboardingQueue() {
  pendingEmployeeOnboarding = null;
}

function getSecondaryAuth() {
  const options = (auth as any)?.app?.options;
  if (!options) throw new Error("تعذر تجهيز جلسة إنشاء حساب الدخول.");

  const name = "hr-unified-onboarding-auth-app";
  const app = getApps().find((item) => item.name === name) || initializeApp(options, name);
  return getAuth(app);
}

async function waitForPrimaryFirebaseSession(timeoutMs = 5000) {
  if (auth.currentUser) return auth.currentUser;

  return new Promise<User>((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("جلسة تسجيل الدخول غير جاهزة. سجل الخروج ثم ادخل من جديد."));
    }, timeoutMs);

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (!user) return;
        window.clearTimeout(timer);
        unsubscribe();
        resolve(user);
      },
      () => {
        window.clearTimeout(timer);
        unsubscribe();
        reject(new Error("تعذر التحقق من جلسة تسجيل الدخول."));
      },
    );
  });
}

async function findCoreAccountByEmail(email: string) {
  const normalized = normalizedEmail(email);
  if (!normalized) return null;
  const accounts = await CoreAccountService.list(false, "internal");
  return accounts.find((account) => normalizedEmail(account.email) === normalized) || null;
}

function friendlyProvisioningError(error: unknown) {
  const code = cleanText((error as any)?.code).toLowerCase();
  const raw = cleanText((error as any)?.message)
    .replace(/^FirebaseError:\s*/i, "")
    .replace(/^FunctionsError:\s*/i, "");

  if (code.includes("email-already-in-use") || raw.includes("email-already-in-use")) {
    return new Error("هذا البريد مرتبط بحساب دخول موجود مسبقًا.");
  }
  if (code.includes("invalid-email") || raw.includes("invalid-email")) {
    return new Error("صيغة البريد الإلكتروني غير صحيحة.");
  }
  if (code.includes("weak-password") || raw.includes("weak-password")) {
    return new Error("كلمة المرور المؤقتة ضعيفة. استخدم 6 أحرف على الأقل.");
  }
  if (code.includes("network-request-failed") || raw.includes("network-request-failed")) {
    return new Error("تعذر الاتصال بخدمة تسجيل الدخول. تحقق من الاتصال ثم حاول مرة أخرى.");
  }
  if (raw) return new Error(raw);
  return new Error("تعذر إنشاء الموظفة وحساب الدخول.");
}

const coordinatorFlag = "__malikatUnifiedEmployeeOnboardingInstalled";
const coordinatorOriginalSave = "__malikatUnifiedEmployeeOnboardingOriginalSave";
const service = CoreHrService as typeof CoreHrService & Record<string, unknown>;

if (!service[coordinatorFlag]) {
  const originalSaveEmployee = CoreHrService.saveEmployee.bind(CoreHrService);
  service[coordinatorFlag] = true;
  service[coordinatorOriginalSave] = originalSaveEmployee;

  CoreHrService.saveEmployee = async (input: Record<string, unknown>) => {
    const onboarding = pendingEmployeeOnboarding;
    if (!onboarding) return originalSaveEmployee(input);

    // Consume exactly one HR create/save call. Any later saves in the same
    // employee workflow continue through the original Core HR service.
    pendingEmployeeOnboarding = null;

    const employeeInput: Record<string, unknown> = {
      ...input,
      ...(onboarding.email ? { email: onboarding.email } : {}),
      ...(onboarding.phone ? { phone: onboarding.phone } : {}),
    };

    if (!onboarding.createLogin) {
      return originalSaveEmployee(employeeInput);
    }

    if (!onboarding.email || !onboarding.email.includes("@")) {
      throw new Error("البريد الإلكتروني الصحيح مطلوب لإنشاء حساب الدخول.");
    }
    if (!onboarding.password || onboarding.password.length < 6) {
      throw new Error("كلمة المرور المؤقتة يجب أن تكون 6 أحرف على الأقل.");
    }

    await waitForPrimaryFirebaseSession();

    const existingCoreAccount = await findCoreAccountByEmail(onboarding.email);
    if (existingCoreAccount) {
      throw new Error("يوجد حساب في النظام بنفس البريد. اربط الحساب الموجود بدل إنشاء حساب جديد.");
    }

    let secondary: Auth | null = null;
    let firebaseUser: User | null = null;
    let createdAccountId = "";
    let savedEmployeeId = "";

    try {
      secondary = getSecondaryAuth();
      await signOut(secondary).catch(() => {});

      const credential = await createUserWithEmailAndPassword(
        secondary,
        onboarding.email,
        onboarding.password,
      );
      firebaseUser = credential.user;
      await updateProfile(firebaseUser, {
        displayName: onboarding.displayName || cleanText(input.name),
      }).catch(() => {});

      const firebaseUid = cleanText(firebaseUser.uid);
      const requestedEmployeeId = cleanText(input.id || input.employeeId);
      const employeeId = requestedEmployeeId || firebaseUid;

      const employee = await originalSaveEmployee({
        ...employeeInput,
        id: employeeId,
        employeeId,
        firebaseUid,
        status: cleanText(input.status) || "active",
        employmentStatus: cleanText(input.employmentStatus) || "active",
        employmentSource: cleanText(input.employmentSource) || "salon",
        includeInEmployeeManagement: input.includeInEmployeeManagement ?? true,
      });
      savedEmployeeId = cleanText((employee as any)?.id) || employeeId;

      const account = await CoreAccountService.create({
        firebaseUid,
        displayName: onboarding.displayName || cleanText(input.name),
        email: onboarding.email,
        phone: onboarding.phone || undefined,
        role: onboarding.role,
        status: "active",
      });
      createdAccountId = cleanText(account.id);

      await CoreAccountService.linkEmployee(account.id, savedEmployeeId);

      await CoreWorkforceService.createNotification({
        targetUid: firebaseUid,
        targetEmployeeId: savedEmployeeId,
        type: "system",
        title: "تم إنشاء حساب الموظفة",
        body: "تم إنشاء حساب الدخول وربطه بملفك الوظيفي.",
        route: "/employee/overview",
      }).catch(() => {});

      return employee;
    } catch (error) {
      if (createdAccountId) {
        await CoreAccountService.remove(createdAccountId).catch(() => {});
      }
      if (firebaseUser) {
        await deleteUser(firebaseUser).catch(() => {});
      }
      if (savedEmployeeId) {
        await originalSaveEmployee({
          id: savedEmployeeId,
          status: "inactive",
          employmentStatus: "inactive",
          adminNotes: "Unified onboarding rollback: account provisioning did not complete.",
        }).catch(() => {});
      }
      throw friendlyProvisioningError(error);
    } finally {
      if (secondary) await signOut(secondary).catch(() => {});
    }
  };
}
