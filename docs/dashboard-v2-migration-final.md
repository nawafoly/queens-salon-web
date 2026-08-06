# اكتمال نقل صفحات لوحة التحكم إلى Design System V2

التاريخ: 2026-08-06

المرجع الوحيد للتصميم:

- `/dashboard/design-system-v2`
- `src/styles/dashboard-v2/dashboard-v2.css`

## الصفحات المعتمدة

- `/dashboard/overview`
- `/dashboard/employees`
- `/dashboard/payroll`
- `/dashboard/reports`
- `/dashboard/expenses`
- `/dashboard/income`
- `/dashboard/bookings`

## ما تم حسمه

- توحيد استيراد CSS من مدخل V2 واحد فقط.
- إلغاء الاستيرادات المباشرة لملفات CSS من الصفحات.
- حذف ملفات CSS القديمة غير المستخدمة للصفحات المستهدفة.
- إزالة قواعد الصفحات المستهدفة من `DashboardSkin.css` و`MadanAdminTheme.css` وملفات الغلاف القديمة.
- دمج طبقات تصميم مساحة الموظفة المتراكمة في ملف واحد: `employee-workspace.css`.
- إعادة بناء CSS التقارير والحجوزات ليتبع المتغيرات والمكونات المشتركة في V2.
- إزالة ألوان Hex و`!important` من ملفات الصفحات المعتمدة.
- إزالة الأنماط المضمنة من `DashboardBookings.tsx` ونقلها إلى CSS النظام.
- عزل تصميم إنشاء الحجز الداخلي القديم في `BookingInternalLegacy.css` ومساره فقط، بحيث لا يؤثر على `/dashboard/bookings`.
- إضافة فحص دائم: `npm run check:dashboard-v2`.

## التحقق

```powershell
npm ci
npm run check:dashboard-v2
npm run build
```

فحص `check:dashboard-v2` يمنع رجوع ملفات CSS القديمة أو الألوان الخام أو `!important` أو الاستيرادات المباشرة للصفحات.
