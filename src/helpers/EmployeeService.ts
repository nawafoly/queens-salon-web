  // src/helpers/employeeService.ts
  import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
  import { db } from "../services/firebase";

  const SALON_ID = "main";
  const STAFF_PUBLIC_COLLECTION = ["salons", SALON_ID, "staff_public"] as const;

  /**
   * ملاحظة مهمة:
   * - docId داخل staff_public هو employeeId (ثابت ويستخدم للربط).
   * - linkedUid داخل الوثيقة هو employeeUid (UID حق تسجيل الدخول).
   * - إحنا راح نوحّد employeeKey = employeeUid (أفضل للفلترة في DashboardStaff).
   */

  export type EmployeeRole = "admin" | "staff" | "reception" | "owner" | "pending";

  export type Employee = {
    // ✅ هذا لازم يكون doc.id
    id: string;

    name: string;
    phone: string;

    // ✅ email مهم للعرض/الربط
    email?: string;

    // ✅ linkedUid هو UID حق Firebase Auth
    linkedUid?: string;

    role: EmployeeRole;
    active: boolean;

    // اختيارات عرض
    showOnAbout?: boolean;
    showOnBooking?: boolean;

    createdAt?: any;
    updatedAt?: any;
  };

  export type EmployeeRefs = {
    employeeId: string;   // staff_public docId
    employeeUid: string;  // linkedUid
    employeeKey: string;  // unified key (we use employeeUid)
  };

  function toEmployee(docId: string, data: any): Employee {
    return {
      id: docId,
      name: String(data?.name || ""),
      phone: String(data?.phone || ""),
      email: data?.email ? String(data.email) : undefined,
      linkedUid: data?.linkedUid ? String(data.linkedUid) : undefined,
      role: (String(data?.role || "staff").toLowerCase() as EmployeeRole),
      active: Boolean(data?.active ?? true),
      showOnAbout: Boolean(data?.showOnAbout ?? false),
      showOnBooking: Boolean(data?.showOnBooking ?? true),
      createdAt: data?.createdAt,
      updatedAt: data?.updatedAt,
    };
  }

  export const EmployeeService = {
    /**
     * ✅ أهم دالة لحل مشكلة الحجوزات
     * تعطيك الثلاثي المطلوب للحجز:
     * - employeeId = staff_public docId
     * - employeeUid = linkedUid
     * - employeeKey = employeeUid (توحيد)
     */
    buildEmployeeRefs(emp: Employee): EmployeeRefs {
      const employeeId = emp.id;
      const employeeUid = String(emp.linkedUid || "").trim();

      return {
        employeeId,
        employeeUid,
        employeeKey: employeeUid || employeeId, // fallback مؤقت لو linkedUid ناقص
      };
    },

    /**
     * ✅ جلب كل الموظفات من Firestore
     */
    async getAll(): Promise<Employee[]> {
      const colRef = collection(db, ...STAFF_PUBLIC_COLLECTION);
      const q = query(colRef, orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      return snap.docs.map((d) => toEmployee(d.id, d.data()));
    },

    /**
     * ✅ جلب الموظفات النشطات فقط
     * + (اختياري) اللي يظهرون بالحجز
     */
    async getActive(opts?: { onlyBooking?: boolean }): Promise<Employee[]> {
      const all = await this.getAll();
      const active = all.filter((e) => e.active);
      if (opts?.onlyBooking) return active.filter((e) => e.showOnBooking !== false);
      return active;
    },

    /**
     * ✅ مراقبة لحظية (مناسبة للـ React useEffect)
     * ترجع unsubscribe
     */
    subscribeAll(onChange: (list: Employee[]) => void, onError?: (err: unknown) => void) {
      const colRef = collection(db, ...STAFF_PUBLIC_COLLECTION);
      const q = query(colRef, orderBy("createdAt", "desc"));

      return onSnapshot(
        q,
        (snap) => {
          const list = snap.docs.map((d) => toEmployee(d.id, d.data()));
          onChange(list);
        },
        (err) => {
          console.error("EmployeeService.subscribeAll error:", err);
          onError?.(err);
        }
      );
    },

    /**
     * ✅ جلب موظفة واحدة بالـ employeeId (docId)
     */
    async getById(employeeId: string): Promise<Employee | null> {
      const ref = doc(db, ...STAFF_PUBLIC_COLLECTION, employeeId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return toEmployee(snap.id, snap.data());
    },

    /**
     * ✅ إنشاء/إضافة موظفة
     * ملاحظة: الآن لازم docId يكون ثابت (الـ system عندكم يعتمد على IDs ثابتة)
     * لذلك نفرض إنك تمرر employeeId بنفسك.
     */
    async add(employeeId: string, data: Omit<Employee, "id">): Promise<Employee> {
      const ref = doc(db, ...STAFF_PUBLIC_COLLECTION, employeeId);

      const payload = {
        email: data.email || "",
        linkedUid: data.linkedUid || "",
        role: data.role || "staff",
        active: data.active ?? true,
        name: data.name || "",
        phone: data.phone || "",
        showOnAbout: data.showOnAbout ?? false,
        showOnBooking: data.showOnBooking ?? true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(ref, payload, { merge: true });
      const saved = await this.getById(employeeId);
      if (!saved) throw new Error("EmployeeService.add: failed to read back saved employee");
      return saved;
    },

    /**
     * ✅ تحديث بيانات الموظفة (بدون لعب بالـ id)
     */
    async update(employeeId: string, patch: Partial<Omit<Employee, "id">>): Promise<Employee | null> {
      const ref = doc(db, ...STAFF_PUBLIC_COLLECTION, employeeId);

      const payload: any = {
        ...patch,
        updatedAt: serverTimestamp(),
      };

      // تنظيف قيم غير مناسبة
      if ("id" in payload) delete payload.id;

      await updateDoc(ref, payload);
      return await this.getById(employeeId);
    },

    /**
     * ✅ حذف موظفة
     */
    async remove(employeeId: string): Promise<boolean> {
      try {
        const ref = doc(db, ...STAFF_PUBLIC_COLLECTION, employeeId);
        await deleteDoc(ref);
        return true;
      } catch (e) {
        console.error("EmployeeService.remove error:", e);
        return false;
      }
    },
  };
