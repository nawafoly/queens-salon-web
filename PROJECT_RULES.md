# PROJECT_RULES.md

# Project Malikat Salon — قواعد المشروع الرسمية

هذا الملف هو المرجع الأول الذي يجب قراءته قبل تنفيذ تغييرات معمارية أو تصميمية داخل المشروع.

---

## 1. Design Authority

المرجع البصري الأعلى والوحيد للمشروع:

`/dashboard/design-system-v2`

المصدر البرمجي:

`src/styles/dashboard-v2/`

**Dashboard V2 هو Design System الرسمي الوحيد.**

أي صفحة جديدة أو صفحة قديمة يتم تحديث تصميمها يجب أن تتبع Dashboard V2.

`EnterpriseWorkspacesV2` ليس Design System مستقلًا، ويجب توحيده تدريجيًا مع Dashboard V2.

إذا حدث تعارض بين أي CSS قديم أو EnterpriseWorkspacesV2 وبين Dashboard V2:

**Dashboard V2 يفوز دائمًا.**

لا يتم إنشاء V3 أو V4 أو Theme بصري جديد دون قرار صريح من مالك المشروع.

الهدف النهائي:

`Design System واحد فقط للمشروع = Dashboard V2`

---

## 2. Visual Reference

عند طلب:

- "التصميم الجديد"
- "نفس التصميم الجديد"
- "وحد الصفحة"
- "خلها مثل باقي الداشبورد الجديد"

فالمرجع المقصود تلقائيًا هو:

`/dashboard/design-system-v2`

ويجب مراجعة مكونات `dsv2-*` والـtokens الموجودة قبل كتابة CSS جديد.

---

## 3. Migration Strategy

نقل النظام يتم تدريجيًا:

1. نقل الصفحة إلى Dashboard V2.
2. الحفاظ على جميع وظائفها الحالية.
3. اختبار Desktop.
4. اختبار Tablet.
5. اختبار Mobile.
6. التأكد من Build.
7. إزالة CSS القديم الخاص بالصفحة بعد التأكد أنه لم يعد مستخدمًا.
8. عدم الإبقاء على Design Systems متوازية على المدى النهائي.

---

## 4. Authorization Architecture

Firebase Authentication مسؤول عن:

- تسجيل الدخول
- الهوية
- Credentials
- Firebase UID

Cloudflare Core Worker + D1 مسؤول عن:

- Role
- Account Status
- Permissions
- Employee Link
- Operational Authorization

**D1 هو مصدر الحقيقة للصلاحيات والأدوار وحالة الحساب.**

لا يتم إعادة Firestore كمصدر صلاحيات أثناء تعديلات الواجهة.

---

## 5. UI Refactors Must Preserve Logic

عند إعادة تصميم أي صفحة:

- لا يتم تغيير منطق D1 بدون حاجة وظيفية مستقلة.
- لا يتم تغيير الصلاحيات بسبب تعديل بصري.
- لا يتم تغيير API contracts بسبب CSS.
- لا يتم حذف وظائف موجودة لتسهيل التصميم.
- يتم فصل Visual Refactor عن Business Logic Refactor قدر الإمكان.

---

## 6. Git Safety

قبل أي تعديل كبير:

- فحص `git status`
- معرفة الفرع الحالي
- عدم الكتابة فوق تعديلات غير مرتبطة
- عدم حذف ملفات قديمة قبل التأكد من عدم استخدامها

قبل اعتماد التغيير:

- `git diff --check`
- تشغيل Build المناسب
- مراجعة الصفحة بصريًا

لا يتم Push أو Merge إلا عند طلب مالك المشروع أو عند الاتفاق الصريح على ذلك.

---

## 7. Source Inspection First

قبل تعديل صفحة موجودة:

1. قراءة TSX/JSX الفعلي.
2. تحديد CSS imports الفعلية.
3. تحديد المكونات المشتركة.
4. تحديد الأنماط القديمة والمتعارضة.
5. مقارنة الصفحة بالمرجع `/dashboard/design-system-v2`.
6. ثم تنفيذ التعديل.

ممنوع اختراع هيكل بصري جديد قبل فحص المرجع والنظام الحالي.

---

## 8. Long-Term Goal

الهدف ليس تجميل صفحات منفصلة.

الهدف هو:

**إعادة بناء واجهة مَلِكات بالكامل على نظام بصري موحد وحديث، ثم إزالة الأنظمة والـCSS القديمة تدريجيًا حتى يبقى Dashboard V2 فقط.**
