

// src/helpers/employeeService.ts
export type EmployeeRole = "admin" | "staff";

export type Employee = {
  id: string;
  name: string;
  phone: string;
  role: EmployeeRole;
  active: boolean;
  createdAt: string; // ISO
};

const EMP_KEY = "dashboard_employees_v1";

function uid() {
  return `emp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export const EmployeeService = {
  key: EMP_KEY,

  getAll(): Employee[] {
    try {
      const raw = localStorage.getItem(EMP_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveAll(list: Employee[]) {
    localStorage.setItem(EMP_KEY, JSON.stringify(list));
  },

  add(data: Omit<Employee, "id" | "createdAt">): Employee {
    const list = this.getAll();
    const emp: Employee = {
      id: uid(),
      createdAt: new Date().toISOString(),
      ...data,
    };
    const next = [...list, emp];
    this.saveAll(next);
    return emp;
  },

  update(id: string, patch: Partial<Omit<Employee, "id" | "createdAt">>): Employee | null {
    const list = this.getAll();
    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) return null;

    const updated: Employee = { ...list[idx], ...patch };
    const next = [...list];
    next[idx] = updated;
    this.saveAll(next);
    return updated;
  },

  remove(id: string): boolean {
    const list = this.getAll();
    const next = list.filter((e) => e.id !== id);
    if (next.length === list.length) return false;
    this.saveAll(next);
    return true;
  },

  // مفيد لاحقًا: نجيب النشطات فقط
  getActive(): Employee[] {
    return this.getAll().filter((e) => e.active);
  },
};

