> **ARCHIVED — Historical repository note. This is not an operational instruction or current source of truth.**

# المرحلة 2 و3 — توحيد الباقات والجلسات داخل Core D1

## الحالة

تم تنفيذ **المرحلة الثانية برمجيًا بالكامل** وتجهيز **المرحلة الثالثة بأداة ترحيل آمنة وقابلة للتكرار**.

لم يتم تعديل قاعدة الإنتاج أو نشر Worker من هذه البيئة؛ التطبيق على الإنتاج يتم فقط بعد تنفيذ أوامر النشر أدناه من جهاز المشروع المرتبط بحساب Cloudflare.

## المعمارية بعد التعديل

```text
React / Capacitor
        │
        │ Firebase ID Token
        ▼
queens-salon-core-api
        │
        ▼
queens-salon-core (D1 واحدة)
        ├── clients
        ├── bookings / booking_items
        ├── invoices / payments / refunds
        ├── loyalty
        ├── package_catalog
        ├── client_packages
        ├── package_transactions
        └── باقي بيانات Core
```

لم تعد الواجهة تحتاج إلى عنوان `queens-salon-packages-api` منفصل. مسارات الباقات أصبحت تحت:

```text
/api/core/packages/*
```

وتم الإبقاء مؤقتًا على توافق داخلي لمسارات `/api/packages/*` داخل Core Worker حتى لا تنكسر الاستدعاءات القديمة أثناء مراحل التحويل التالية.

## ما تم تنفيذه

### 1. مخطط موحد داخل Core D1

أضيفت migration:

```text
migrations/core/0011_unify_packages_into_core.sql
```

وتنشئ داخل Core D1:

- `package_catalog`
- `client_packages`
- `package_transactions`
- ربط الباقات بجدول `clients` نفسه المستخدم في الحجوزات.
- `canonical_client_id` و`legacy_ids_json` لهوية العميلة.
- طبقة توافق `client_identity_aliases` مبنية على جدول aliases الموجود، دون إنشاء مصدر هوية ثانٍ.

### 2. Core Worker واحد

أصبح Core Worker يخدم:

```text
/api/core/packages/health
/api/core/packages/my-wallet
/api/core/packages/my-catalog
/api/core/packages/catalog
/api/core/packages/admin/*
/api/core/packages/purchase
/api/core/packages/redeem
/api/core/packages/restore
```

ويستخدم binding واحدًا:

```text
CORE_DB
```

كما تمت إضافة Cron كل ساعة لمعالجة انتهاء صلاحية الباقات من Core Worker نفسه.

### 3. تحويل الواجهة إلى Core Worker للباقات

- `PackageOperationsService` يستخدم `VITE_CORE_WORKER_URL`.
- المسارات القديمة `/api/packages/*` تتحول إلى `/api/core/packages/*` قبل الطلب.
- لم يعد `VITE_PACKAGES_WORKER_URL` مطلوبًا.
- سكربت التطوير لا يشغّل Packages Worker منفصلًا.
- سكربت التحقق يفحص مسارات الباقات داخل Core Worker.

### 4. ترحيل بيانات الباقات الحالية

أضيف السكربت:

```text
scripts/migrate-packages-d1-to-core.mjs
```

وظيفته:

- قراءة العميلات والباقات والحركات من قاعدة `queens-salon-packages` القديمة.
- قراءة العميلات والـaliases من `queens-salon-core`.
- مطابقة الهوية باستخدام:
  - alias أو المعرف القديم.
  - Firebase UID.
  - رقم الجوال الموحّد.
- رفض المطابقات المتعارضة أو الغامضة بدل ربط الباقة بالعميلة الخطأ.
- إنشاء SQL idempotent.
- إنشاء تقرير JSON قبل التطبيق.
- إنشاء نسخ احتياطية تلقائية من القاعدتين قبل `--apply`.
- التحقق من أعداد السجلات بعد النقل.

## نتائج التحقق

تم تشغيل الأمر:

```powershell
npm run verify:core:unified
```

والنتيجة:

```text
Package D1-only guard: passed
Core D1-only guard: passed
Packages Worker compatibility tests: 34/34 passed
Core Worker tests: 57/57 passed
Core/package unification and migration tests: 8/8 passed
Frontend/Core tests: 42/42 passed
TypeScript + Vite build: passed
```

تم أيضًا تطبيق جميع Core migrations محليًا، وتشغيل Core Worker محليًا، والتحقق من:

```text
GET /api/core/health                 -> 200
GET /api/core/packages/health        -> 200، binding = CORE_DB
GET /api/core/packages/my-wallet     -> 401 دون توكن، وهي نتيجة صحيحة
```

## ترتيب التطبيق على الإنتاج — لا تغيّره

> مهم: لا ترفع الواجهة قبل ترحيل بيانات الباقات؛ وإلا قد تظهر محافظ العميلات فارغة مؤقتًا.

### 1. فك التحديث والتحقق المحلي

```powershell
cd C:\Users\nawaf\Downloads\queens-salon-web

Expand-Archive `
  -Path C:\Users\nawaf\Downloads\queens-core-unified-packages-phase2-3.zip `
  -DestinationPath . `
  -Force

npm run verify:core:unified
```

### 2. تطبيق مخطط Core D1 الجديد

```powershell
npx wrangler d1 migrations apply queens-salon-core `
  --remote `
  --config .\wrangler.core.jsonc
```

### 3. Dry Run لترحيل الباقات

```powershell
npm run migrate:packages-to-core:dry

Get-Content .\packages-to-core-main.sql.report.json
```

يجب مراجعة التقرير والتأكد من عدم وجود تعارضات هوية. السكربت يتوقف تلقائيًا عند وجود تطابق غامض ولا يكتب شيئًا على الإنتاج في وضع Dry Run.

### 4. تطبيق الترحيل

```powershell
npm run migrate:packages-to-core
```

قبل الكتابة، ينشئ السكربت مجلدًا باسم شبيه بـ:

```text
packages-core-backup-<timestamp>
```

ويحفظ داخله:

```text
core-before.sql
packages-source.sql
```

### 5. نشر Core Worker فقط

```powershell
npx wrangler deploy --config .\wrangler.core.jsonc

npm run verify:client-workers
```

النتائج الصحيحة للمسارات المحمية دون توكن هي `401`، وليست `404`.

### 6. رفع الكود إلى GitHub/Vercel

```powershell
git add --pathspec-from-file=CORE-UNIFIED-PACKAGES-PATCH-FILES.txt

git commit -m "feat: unify packages and sessions into core d1"

git push origin main
```

## ما لا يجب فعله الآن

- لا تنشر `wrangler.packages.jsonc`.
- لا تحذف قاعدة `queens-salon-packages` القديمة.
- لا تحذف Packages Worker القديم قبل نجاح الاختبارات الإنتاجية الكاملة.
- لا تغيّر `VITE_CORE_WORKER_URL`.
- لا تعيد إضافة `VITE_PACKAGES_WORKER_URL`.

تبقى القاعدة القديمة **نسخة رجوع للقراءة فقط** حتى نهاية المرحلة الثامنة.

## معيار إغلاق هذه المرحلة على الإنتاج

تُعد المرحلة مغلقة بعد تحقق الآتي:

1. Migration `0011` مطبقة على Core D1.
2. تقرير Dry Run بلا تعارضات.
3. أعداد الباقات والحركات المنقولة مطابقة للتقرير.
4. Core Worker منشور.
5. `/api/core/packages/health` يعمل.
6. عميلة لديها باقة قديمة ترى رصيدها نفسه.
7. شراء/خصم/إعادة جلسة يكتب في Core D1 فقط.
8. لا توجد طلبات من المتصفح إلى `queens-salon-packages-api`.

## المرحلة التالية ضمن الخطة المتفق عليها

بعد إغلاق النقل على الإنتاج ننتقل مباشرة إلى المرحلة الرابعة والخامسة: توحيد بقية Core API وتحويل صفحات الحجز والعميل ولوحة التحكم من Firestore إلى Core D1 دون FallBack تشغيلي.
