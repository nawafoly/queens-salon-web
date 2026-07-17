# استكمال ربط بوابة العميل — Queens Salon

## النتيجة التنفيذية

تم تحويل بوابة العميل من شاشة تجمع قيماً ثابتة ومصادر متفرقة إلى بوابة تعتمد على مصادر البيانات التشغيلية نفسها التي تستخدمها لوحة التحكم:

- **Firebase Authentication:** لإثبات هوية المستخدم وتوفير `Firebase UID` فقط.
- **Core D1:** العميلات، الحجوزات، عناصر الحجز، الفواتير، الدفعات، الاسترجاعات، النقاط، سجل النقاط، والعروض.
- **Packages D1:** كتالوج الباقات، باقات العميلة، الأرصدة، الحجز المؤقت للجلسات، الاستهلاك، الإعادة، وسجل الحركات.
- **Firestore:** بقي فقط في المسارات القديمة التي لم تُرحّل ضمن هذه المهمة، وفي استيراد بيانات Excel عند تعطيل Core D1. لا يوجد fallback تلقائي من D1 إلى Firestore عند فشل الشبكة.

## 1. الأسباب الجذرية للمشكلات السابقة

1. صفحة الملف الشخصي كانت تعرض أرقاماً شكلية أو مشتقة محلياً مثل 300 نقطة و6 حجوزات، بدل قراءة سجل تشغيلي موحد.
2. تعريف العميل لم يكن موحداً دائماً؛ بعض السجلات تعتمد UID وبعضها رقم الهاتف أو البريد أو `clientId` قديم.
3. بوابة العميل ولوحة التحكم لم تكونا تقرآن كل الوحدات من مصدر حقيقة واحد.
4. Packages Worker القديم لم يكن متوافقاً بالكامل مع استدعاءات الواجهة، خصوصاً فرق `bookingId` و`clientPackageId` ومعالجة أكثر من جلسة داخل الحجز نفسه.
5. لم يكن هناك سجل حركات نقاط idempotent؛ لذلك لم تكن إعادة الحفظ والاسترجاعات الجزئية آمنة محاسبياً.
6. العروض لم تتضمن جميع خصائص النشر والجدولة والاستهداف المطلوبة.
7. شريط تطبيق العميل كان يستهلك مساحة رئيسية لـInstagram بدل «باقاتي».
8. رسائل فشل Packages Worker كانت نتيجة واجهة خادم ومخطط D1 غير منشورين، وليست Empty State حقيقية.
9. لوحة العميلات الإدارية لم تجمع الدفعات والاسترجاعات والنقاط والعروض المستخدمة في سجل موحد.

## 2. مصدر الحقيقة المعتمد

| الوحدة | مصدر الحقيقة | الملاحظات |
|---|---|---|
| الهوية | Firebase Auth UID | يتم حله إلى سجل Core D1 canonical مع alias للبريد/الهاتف والبيانات القديمة |
| بيانات العميلة | Core D1 `clients` و`client_aliases` | UID هو الأولوية، ثم alias، ثم البريد، ثم الهاتف؛ لا اعتماد على الاسم |
| الحجوزات | Core D1 | البوابة ولوحة التحكم تقرآن الحجوزات نفسها |
| الدفعات والفواتير | Core D1 | تظهر في سجل العميلة الإداري وحالة الحجز |
| الاسترجاعات | Core D1 | Contra-revenue وليست مصروفاً؛ تؤثر على حالة الحجز والنقاط والجلسات |
| النقاط والولاء | Core D1 `loyalty_point_transactions` | سجل حركات idempotent وليس رقماً ثابتاً |
| كتالوج الباقات | Packages D1 `package_catalog` | لا توجد نسخة تشغيلية موازية في Firestore |
| باقات العميلة والجلسات | Packages D1 | الرصيد وسجل الحركة من المصدر نفسه للإدارة والعميلة |
| العروض | Core D1 `discounts` | النشر والتواريخ والحالة والترتيب والاستهداف محفوظة في الخادم |

## 3. توحيد هوية العميلة

الدالة `resolveSelfClient` تستخدم الترتيب التالي:

1. `firebase_uid` المطابق للتوكن.
2. `client_aliases` المرتبط بالـUID.
3. البريد الموثق في التوكن.
4. رقم الهاتف بعد التطبيع.
5. إنشاء سجل Canonical جديد فقط عندما لا يوجد تطابق آمن.

عند الربط، يتم حفظ alias للـUID حتى لا تنشأ باقة أو حجوزات تحت هوية ثانية في الزيارات اللاحقة. إذا وُجد أكثر من تطابق بالبريد أو الهاتف يعاد خطأ تعارض واضح بدلاً من دمج بيانات عميلتين عشوائياً.

## 4. النقاط والولاء

### قاعدة الحساب

- **نقطة واحدة لكل ريال كامل** من قيمة الحجز المكتمل.
- لا تمنح نقاط للحجز `pending` أو `confirmed`.
- سجل الاكتساب: `loyalty_earn_<bookingId>`.
- سجل عكس الاسترجاع: `loyalty_refund_<refundId>`.
- الاسترجاعات المتعددة لنفس الحجز تُحسب تراكمياً لمنع خطأ التقريب في الاسترجاع الجزئي.
- إجمالي النقاط المعكوسة لا يتجاوز النقاط المكتسبة من الحجز.
- تعديلات الإدارة تُسجل كـ`adjustment` مع سبب وUID المنفذ و`operationId` فريد.
- إعادة إرسال نفس `operationId` لا تضيف الحركة مرتين بسبب unique idempotency index و`INSERT OR IGNORE`.

### المستويات

- برونزي: 0+
- فضي: 300+
- ذهبي: 900+
- VIP: 1800+

يحسب الخادم الرصيد والمكتسب والمستخدم والمعكوس والمستوى والتقدم للمستوى التالي من سجل الحركات نفسه.

## 5. خصم وإعادة جلسات الباقات

- عند إنشاء الحجز تُحجز الجلسة فقط كـ`reserved`.
- عند إكمال الحجز تنتقل كل جلسات عناصر السلة المرتبطة بالحجز إلى `used` مرة واحدة.
- إعادة تنفيذ الإكمال لا تخصم جلسة أخرى.
- عند الإلغاء أو الاسترجاع الكامل تعاد الجلسات المحجوزة/المستخدمة إلى `remaining` مرة واحدة.
- عند إلغاء الاسترجاع الكامل أو تحويله إلى جزئي يعاد تطبيق حالة الجلسة المناسبة عبر endpoint `reapply`.
- كل حركة تحتوي `bookingId` و`clientPackageId` و`cartItemId` وسبب ومنفذ.
- الحجز الذي يحتوي خدمتين من الباقة يعالج كل عنصر، وليس أول جلسة فقط.

## 6. استهداف العروض

العرض لا يظهر للعميلة إلا عند تحقق كل الشروط التالية:

- `active = 1`
- `published = 1`
- الحالة ليست `draft` أو `disabled` أو `expired`
- `starts_at` فارغ أو أقل/يساوي الوقت الحالي
- `ends_at` فارغ أو أكبر/يساوي الوقت الحالي
- `target_scope = all` أو معرف العميلة/UID موجود في `target_client_ids_json`

زر العرض يستخدم عقد الاستعلام المدعوم فعلياً في صفحة الحجز:

```text
/booking?scope=offers&pick=offer:<offerId>
```

وبذلك يفتح الحجز مع العرض المحدد بدلاً من إعادة البحث يدوياً.

## 7. المسارات الجديدة أو المحدثة

### بوابة العميل

- `/client`
- `/client/bookings`
- `/client/booking` → تحويل متوافق إلى `/booking`
- `/client/packages`
- `/client/offers`
- `/client/profile`
- `/profile` → تحويل متوافق

### Core Worker

- `GET /api/core/client/portal`
- `GET/PATCH /api/core/client/me`
- `GET /api/core/client/bookings`
- `GET /api/core/client/loyalty`
- `GET /api/core/client/offers`
- `GET /api/core/clients/:clientId/overview` — Owner/Admin فقط
- `POST /api/core/clients/:clientId/loyalty-adjustments` — Owner/Admin فقط

### Packages Worker

- `GET /api/packages/my-wallet`
- `GET /api/packages/my-catalog`
- `GET/POST/PATCH/DELETE /api/packages/admin/catalog...`
- `GET /api/packages/admin/session-dashboard`
- `POST /api/packages/redemption/reapply`
- مسارات الاستهلاك والإعادة الحالية أصبحت تدعم كل عناصر الحجز بشكل idempotent.

## 8. تجربة الجوال

- الغلاف محصور في `.client-app-shell` ولا يطبق على `/dashboard` أو `/admin` أو `/employee`.
- `max-width: 480px` على بوابة العميل فقط.
- `min-height: 100dvh`.
- دعم `safe-area-inset-top` و`safe-area-inset-bottom`.
- Bottom Navigation ثابت وموحد: الرئيسية، حجوزاتي، حجز جديد، باقاتي، حسابي.
- Instagram أزيل من التنقل الرئيسي.
- مساحة سفلية تمنع تغطية المحتوى.
- منع التمدد الأفقي داخل الغلاف.
- عناصر التحكم الأساسية لا تقل عن 44px.
- حالات الباقات تفرق بين Loading وError وEmpty؛ فشل الشبكة لا يتحول إلى «0 جلسة».

## 9. سجل العميلة في لوحة التحكم

نافذة العميلة في `/dashboard/clients` تعرض الآن من Core D1:

- صافي المدفوع.
- الاسترجاعات.
- آخر نشاط.
- رصيد ومستوى وحركات النقاط.
- إضافة/خصم نقاط إدارياً مع سبب وتدقيق وصلاحية خادم.
- الدفعات والاسترجاعات الأخيرة.
- العروض المستخدمة.
- الباقات والأرصدة وسجل الجلسات من Packages D1.
- الحجوزات الحالية الموجودة في الصفحة.

كما تم إصلاح CSS الجوال داخل نافذة العميلة حتى لا يؤدي إخفاء جدول الكمبيوتر إلى إخفاء لوحة الباقات نفسها.

## 10. الملفات الرئيسية المعدلة أو المضافة

### الواجهة

- `src/App.tsx`
- `src/index.css`
- `src/pages/Profile.tsx`
- `src/pages/Booking.tsx` — عقد preselection موجود وتم ربط العروض به
- `src/pages/DashboardClients.tsx`
- `src/pages/DashboardBookings.tsx`
- `src/pages/DashboardOffers.tsx`
- `src/pages/DashboardIncome.tsx`
- `src/pages/settings/SettingsCatalog.tsx`
- `src/components/packages/MyPackagesPanel.tsx`
- `src/components/packages/ClientPackagesPanel.tsx`
- `src/features/internal-booking-v2/BookingInternalV2.tsx`
- `src/features/internal-booking-v2/PackageSessionsManager.tsx`
- `src/styles/AdminDashboardClients.css`
- `src/styles/SessionPackages.css`

### Services والأنواع

- `src/services/ClientPortalService.ts`
- `src/services/CoreClientService.ts`
- `src/services/CoreOfferService.ts`
- `src/services/PackageOperationsService.ts`
- `src/services/PackageService.ts`
- `src/services/coreBookingMappers.ts`
- `src/services/firestoreOffers.ts`
- `src/services/firestoreIncome.ts`
- `src/services/firestoreExpenses.ts`
- `src/types/coreApi.ts`

### Workers

- `workers/core/index.js`
- `workers/core/repositories/client-portal.js`
- `workers/core/repositories/discounts.js`
- `workers/core/repositories/finance.js`
- `workers/core/repositories/refunds.js`
- `workers/packages/d1.js`
- `workers/packages/routes.js`

### Migrations

- `migrations/core/0009_remove_refund_expense_shadows.sql`
- `migrations/core/0010_client_portal_loyalty_offers.sql`
- `migrations/packages/0002_package_catalog_management.sql`
- `migrations/packages/0003_package_transaction_audit.sql`

### الاختبارات والإعدادات

- `workers/frontend-core-migration.test.mjs`
- `workers/packages-d1-worker.test.mjs`
- `.env.web`
- `.gitignore`

## 11. نتائج التحقق

### اختبارات آلية

- Core Worker: **52/52 ناجحة**.
- Packages Worker: **33/33 ناجحة**.
- Frontend/Core migration regression: **36/36 ناجحة**.
- TypeScript: `npx tsc --noEmit --project tsconfig.app.json` **ناجح**.
- Build: `npm run build` **ناجح**.
- D1-only guards: Packages وCore وFrontend migration **ناجحة**.
- ESLint للملفات الخلفية والخدمة الجديدة (`CoreClientService`, Core index, client portal repository): **ناجح بلا أخطاء**.

### اختبار Worker + D1 محلي فعلي

تم تشغيل Core Worker محلياً مع D1 حقيقية محلية وبيانات عميلة/حجز/دفعات/استرجاعات/عرض:

- Snapshot العميل أعاد الحجز الحقيقي والعرض المستهدف فقط.
- حجز مكتمل بقيمة 2.50 ريال منح نقطتين.
- استرجاعان تراكميان بقيمة 1.00 ريال عكسا نقطة واحدة؛ الرصيد النهائي نقطة.
- Admin overview: Owner عاد `200`.
- Staff عاد `403`.
- Client عاد `403`.
- تعديل إداري +5 نقاط ثم إعادة الطلب بنفس `operationId`: الرصيد تغير من 1 إلى 6 وبقي 6 في الإعادة، أي لا يوجد تكرار.
- اختبار Packages D1 المحلي: جلستان محجوزتان لنفس الحجز → استهلاك الجلستين → إعادة الطلب بلا خصم إضافي → استعادة الجلستين → إعادة تطبيقهما، والرصيد النهائي متسق.

### حدود التحقق

- النسخة المرفوعة لا تحتوي مجلد `.git`؛ لذلك تعذر تنفيذ `git status` و`git diff` و`git log` داخل بيئة الفحص. يجب تنفيذها في مستودعك المحلي قبل فك التصحيح.
- لم يتم تعديل قاعدة D1 البعيدة أو حسابات الإنتاج من بيئة الفحص لعدم استخدام صلاحياتك الحية. الاختبارات الفعلية تمت على Workers وD1 محليتين.
- `npm run lint` على كامل المستودع كبير جداً وتجاوز وقت التنفيذ، كما أن ملفات الواجهة القديمة تحتوي ديناً سابقاً من `any` ومتغيرات غير مستخدمة. فحص الملفات الخلفية الجديدة نجح، بينما فحص صفحات الواجهة المتأثرة أظهر **162 مشكلة lint قديمة/تراكمية**. هذا لا يمنع TypeScript أو البناء، لكنه ليس من الصحيح الادعاء أن lint العام نظيف.
- التحقق البصري الإنتاجي بحساب عميلة حقيقي يجب تنفيذه بعد نشر migrations والـWorkers وVercel؛ لا يُعتبر نجاح البناء وحده إثباتاً للبيانات الحية.

## 12. أوامر النشر الدقيقة

> الترتيب مهم: migrations أولاً، ثم Worker، ثم بناء Vercel.

```powershell
cd C:\Users\nawaf\Downloads\queens-salon-web

npx wrangler d1 migrations apply queens-salon-core `
  --remote `
  --config .\wrangler.core.jsonc

npx wrangler deploy --config .\wrangler.core.jsonc

npx wrangler d1 migrations apply queens-salon-packages `
  --remote `
  --config .\wrangler.packages.jsonc

npx wrangler deploy --config .\wrangler.packages.jsonc
```

ثم:

```powershell
npm run test:core:worker
npm run test:packages:worker
npm run test:frontend:core
npm run build
```

متغيرات Vercel Production المطلوبة:

```env
VITE_USE_CORE_D1=true
VITE_CORE_WORKER_URL=https://queens-salon-core-api.maedin.workers.dev
VITE_USE_PACKAGES_D1=true
VITE_PACKAGES_WORKER_URL=https://queens-salon-packages-api.maedin.workers.dev
```

ثم رفع Git:

```powershell
git status
git diff --stat
git add .
git commit -m "feat: complete client portal D1 integration"
git push origin main
```

## 13. تحقق الإنتاج بعد النشر

نفذ السيناريو التالي بعميلة اختبار واحدة، ولا تستخدم بيانات عميلة حقيقية للحذف أو الاسترجاع التجريبي:

1. سجل دخول العميلة وافتح `/client/profile` وتأكد أن الرصيد والعدادات ليست ثابتة.
2. أنشئ حجزاً من `/client/booking` وتأكد من ظهوره في `/dashboard/bookings`.
3. أكد الحجز ثم أكمله من الإدارة؛ تحقق من تغير الحالة والنقاط مرة واحدة.
4. أعد حفظ الحجز المكتمل؛ يجب ألا تتكرر النقاط أو الجلسة.
5. نفذ استرجاعاً جزئياً ثم كاملاً؛ تحقق من عكس النقاط والجلسة ومن عدم ظهور الاسترجاع كمصروف.
6. أنشئ باقة وأسندها للعميلة؛ تحقق من ظهورها في `/client/packages`.
7. أنشئ عرضاً `draft` ثم `active/published` ثم منتهي التاريخ؛ تحقق من الظهور والاختفاء الصحيحين.
8. اضغط «احجزي الآن» من العرض وتأكد أن صفحة الحجز تستقبل `offer:<id>`.
9. افتح سجل العميلة من `/dashboard/clients` وتأكد من الدفعات والاسترجاعات والنقاط والباقات والعروض المستخدمة.
10. اختبر 320 و360 و390 و412 و430 و480px ثم Tablet وDesktop، وتأكد أن `/dashboard` لم يكتسب `max-width: 480px`.
