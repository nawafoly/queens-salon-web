# تقرير تنفيذ نظام طلبات الموظفات الموحد

## 1. النتيجة

تم تنفيذ نظام طلبات موظفات موحد داخل مشروع **Malikat / Queens Salon** وفق المعمارية:

`React Frontend → Cloudflare Core Worker → Core D1`

ويُستخدم Firebase فقط للحصول على هوية المستخدم وFirebase ID Token. لم تتم إضافة أي Firestore fallback لبيانات الطلبات أو دورة العمل.

لم يتم تنفيذ `commit` أو `push` أو `deploy`.

---

## 2. السبب الجذري للنقص السابق

كانت نافذة **طلب جديد** تعرض سبعة خيارات، لكن معظمها كان مجرد روابط إلى صفحات عامة مثل الرسائل أو الراتب أو الحضور. لم يكن هناك:

- كيان موحد للطلبات داخل D1.
- رقم مرجعي يصدر من الخادم.
- دورة حالات قابلة للتدقيق.
- سجل أحداث وتعليقات ومرفقات موحد.
- فصل بين الموافقة وبين التنفيذ الفعلي.
- صلاحيات API مستقلة لكل مرحلة.
- مركز موحد لدى HR.
- ربط تشغيلي كامل بالحضور، الاستئذانات، الإجازات، الأوفرتايم، السلف والاستقالة.

---

## 3. المعمارية المنفذة

### طبقة الواجهة

- خدمة TypeScript واحدة للتعامل مع Core API.
- صفحة موحدة للموظفة لإنشاء الطلبات ومتابعتها.
- صفحة تفاصيل تحتوي على البيانات، القرار، المرفقات، التعليقات والسجل الزمني.
- مركز HR للاستلام والمراجعة والتعيين والقرار والتنفيذ.
- إشعارات داخل التطبيق مرتبطة مباشرة برقم الطلب ومساره.

### طبقة Core Worker

- Routes آمنة تحت `/api/core/hr`.
- فحص Firebase ID Token من آلية المصادقة الحالية.
- التحقق من ملكية الطلب للموظفة.
- التحقق من الصلاحية في الخادم، وليس عبر إخفاء الأزرار فقط.
- Optimistic locking بواسطة `version`.
- Idempotency للإنشاء، الإجراءات، التعليقات، المرفقات والتنفيذ.
- سجل أحداث يحتوي على هوية المنفذ والدور والبريد وIP وUser-Agent ولقطات قبل/بعد.

### طبقة البيانات

- Core D1 هو مصدر بيانات الطلبات.
- R2 هو مصدر الملفات الثنائية، وD1 يحتفظ بالبيانات المرجعية فقط.
- `malikat-attendance` D1 هو المصدر الفعلي لتصحيحات بصمات الحضور عند توفر binding `ATTENDANCE_DB`.
- Core D1 يحتفظ بآثار الاستئذانات والإجازات والرواتب والتدقيق.

---

## 4. الملفات الجديدة

1. `migrations/core/0020_employee_requests.sql`
2. `workers/core/repositories/employee-requests.js`
3. `src/services/employeeRequests.ts`
4. `src/pages/hr/EmployeeRequests.tsx`
5. `src/pages/hr/AdminEmployeeRequests.tsx`
6. `src/styles/EmployeeRequests.css`
7. `docs/EMPLOYEE-REQUESTS-IMPLEMENTATION-AR.md`

## 5. الملفات المعدلة

1. `workers/core/index.js`
2. `workers/core/repositories/files.js`
3. `workers/core/repositories/payroll.js`
4. `src/helpers/permissions.ts`
5. `src/services/employeeHub.ts`
6. `src/pages/EmployeePortal.tsx`
7. `src/pages/AdminHrDashboard.tsx`
8. `src/types/hrCoreApi.ts`
9. `src/helpers/hr/attendanceCalendarData.ts`
10. `src/pages/hr/EmployeeOverview.tsx`
11. `src/pages/hr/EmployeePayroll.tsx`
12. `src/pages/hr/EmployeeNotifications.tsx`
13. `src/pages/hr/portalUtils.ts`

---

## 6. Migration الجديدة

الملف:

`migrations/core/0020_employee_requests.sql`

### الجداول الجديدة

#### `employee_request_counters`

عدادات آمنة لإصدار أرقام الطلبات حسب السنة والنوع.

#### `employee_requests`

السجل الرئيسي، ويشمل:

- رقم الطلب.
- الموظفة والـUID.
- نوع الطلب.
- الحالة والأولوية.
- `payload_json`.
- المسؤول المعين.
- القرار وسبب الرفض.
- مرجع النظام التشغيلي.
- حالة ومحاولات التنفيذ.
- idempotency key.
- version.
- جميع تواريخ المراحل.
- الخروج والعودة الفعليين.
- آخر يوم عمل.

#### `employee_request_events`

سجل زمني غير قابل للتعديل عبر API، ويحتوي على:

- الحالة السابقة واللاحقة.
- المنفذ ودوره وبريده.
- الملاحظة.
- payload.
- before/after snapshots.
- request idempotency key.
- IP وUser-Agent.

#### `employee_request_comments`

تعليقات ظاهرة للموظفة وملاحظات داخلية، مع idempotency لمنع التكرار.

#### `employee_request_attachments`

مراجع R2 فقط، مع idempotency والتحقق من ملكية الملف وتصنيفه.

#### `employee_overtime_records`

سجلات الأوفرتايم المطلوبة والمعتمدة وربطها بدورة الراتب.

#### `salary_advances`

السلفة، المبلغ الموافق عليه، المدفوع، المتبقي، طريقة الاستقطاع والمرجع المالي.

#### `salary_advance_installments`

الأقساط المجدولة وربطها بقيد الراتب وحالة الاستقطاع.

### امتدادات الجداول الحالية

- ربط `employee_permission_requests` بالطلب الموحد بواسطة `employee_request_id`.
- دعم الإجازة الكاملة والجزئية وربطها بالطلب داخل `employee_leaves`.

---

## 7. دورة الحالات

الحالات المدعومة:

- `submitted`
- `received`
- `under_review`
- `needs_info`
- `approved`
- `rejected`
- `executing`
- `completed`
- `cancelled`

المسارات الرئيسية:

- إرسال → استلام → مراجعة → موافقة → تنفيذ → إكمال.
- إرسال → استلام → طلب معلومات → رد الموظفة → مراجعة.
- إرسال → استلام/مراجعة → رفض.
- إلغاء قبل بدء التنفيذ.
- إعادة فتح الطلب المرفوض أو الملغي بصلاحية مستقلة.

لا يسمح Worker بالقفز إلى حالة غير صالحة.

---

## 8. API Routes

### الموظفة

- `GET /api/core/hr/employee-requests/mine`
- `POST /api/core/hr/employee-requests/mine`
- `GET /api/core/hr/employee-requests/:id`
- `POST /api/core/hr/employee-requests/:id/comments`
- `POST /api/core/hr/employee-requests/:id/attachments`
- `POST /api/core/hr/employee-requests/:id/answer-info`
- `POST /api/core/hr/employee-requests/:id/cancel`

### HR والإدارة

- `GET /api/core/hr/employee-requests`
- `POST /api/core/hr/employee-requests`
- `GET /api/core/hr/employee-requests/stats`
- `POST /api/core/hr/employee-requests/:id/receive`
- `POST /api/core/hr/employee-requests/:id/assign`
- `POST /api/core/hr/employee-requests/:id/start-review`
- `POST /api/core/hr/employee-requests/:id/request-info`
- `POST /api/core/hr/employee-requests/:id/approve`
- `POST /api/core/hr/employee-requests/:id/reject`
- `POST /api/core/hr/employee-requests/:id/execute`
- `POST /api/core/hr/employee-requests/:id/complete`
- `POST /api/core/hr/employee-requests/:id/cancel`
- `POST /api/core/hr/employee-requests/:id/reopen`
- `POST /api/core/hr/employee-requests/:id/record-exit`
- `POST /api/core/hr/employee-requests/:id/record-return`

### الإشعارات والراتب

- `GET /api/core/hr/employee-request-notifications`
- `POST /api/core/hr/employee-request-notifications/:id/read`
- `POST /api/core/hr/employee-request-notifications/read-all`
- `GET /api/core/hr/employee-request-payroll-impact/mine`

---

## 9. الصلاحيات الجديدة

- `employee_requests.own.view`
- `employee_requests.own.create`
- `employee_requests.own.comment`
- `employee_requests.own.cancel`
- `employee_requests.view`
- `employee_requests.manage`
- `employee_requests.receive`
- `employee_requests.assign`
- `employee_requests.request_info`
- `employee_requests.approve`
- `employee_requests.reject`
- `employee_requests.execute`
- `employee_requests.complete`
- `employee_requests.internal_notes`
- `employee_requests.resignation.execute`
- `employee_requests.salary_advance.approve`
- `employee_requests.attendance_correction.execute`
- `employee_requests.reopen`

تمت إضافة الصلاحيات إلى سجل الواجهة وسجل D1، مع defaults للأدوار الداخلية المناسبة.

---

## 10. مسارات الواجهة

### الموظفة

- `/employee/requests`
- `/employee/requests/:requestId`
- `/employee/requests?new=attendance_correction`
- `/employee/requests?new=permission`
- `/employee/requests?new=overtime`
- `/employee/requests?new=salary_advance`
- `/employee/requests?new=leave`
- `/employee/requests?new=exit_return`
- `/employee/requests?new=resignation`

تم ربط الخيارات السبعة في نافذة **طلب جديد** بهذه النماذج بدل صفحات الرسائل المؤقتة.

### HR

- `/admin/requests`

ويشمل الإحصاءات، الفلاتر، قائمة الطلبات، التفاصيل، timeline، المرفقات والتعليقات والإجراءات.

---

## 11. التنفيذ التشغيلي للأنواع السبعة

### 1. تصحيح الحضور

- يعمل على `ATTENDANCE_DB` الفعلي عند توفره.
- يدعم الإضافة والتعديل والحذف.
- يعيد بناء `attendance_state`.
- يلغي ملخص الشهر المخزن ليعاد احتسابه.
- يحفظ snapshot قبل وبعد.
- يوجد fallback إلى Core attendance في بيئة التطوير التي لا تحتوي على binding خارجي.

### 2. الاستئذان

- ينشئ سجلًا داخل النظام الحالي `employee_permission_requests`.
- يسجل خروج وعودة الاستئذان.
- يدعم العبور بعد منتصف الليل.
- يمنع التداخل.
- يحدث ملخص الاستئذانات في الرواتب غير المعتمدة.
- يحافظ على منطق تغطية missing hours الحالي.

### 3. الأوفرتايم

- ينشئ سجل overtime معتمدًا.
- يحفظ المطلوب والمعتمد منفصلين.
- يمنع تداخل الفترات.
- لا يستخدم في الراتب قبل الاعتماد والتنفيذ.
- يحدث قيد الراتب المفتوح عند وجوده.

### 4. الصرف المعجل

- لا يكتمل دون مبلغ معتمد ومرجع صرف مالي.
- ينشئ سجل سلفة وجدول أقساط.
- يظهر الأصل والمدفوع والمتبقي.
- يربط القسط بدورة الراتب.
- عند تعليم الراتب مدفوعًا يتحول القسط إلى deducted ويتحدث رصيد السلفة.

### 5. الإجازة

- يمنع تداخل الإجازات.
- يتحقق من الرصيد السنوي ويخصمه عند التنفيذ فقط.
- يدعم يومًا كاملًا أو إجازة جزئية.
- الإجازة الكاملة تظهر في تقويم الحضور.
- الإجازة الجزئية تنشئ تغطية permission بالدقائق حتى لا تعتبر اليوم كله إجازة.

### 6. الخروج والعودة

- بعد الموافقة ينتقل إلى التنفيذ وينتظر الخروج الفعلي.
- يسجل `actual_exit_at` ثم `actual_return_at`.
- لا يكتمل دون العودة الفعلية.
- يحسب تأخر العودة.
- Cron يصدر تنبيهًا متكررًا يوميًا دون تكرار نفس الحدث داخل اليوم.

### 7. الاستقالة

- الموافقة لا تعطل الحساب.
- التنفيذ يتطلب آخر يوم عمل فعلي وتأكيد إخلاء الطرف والإنهاء.
- لا يسمح بالتنفيذ قبل التاريخ.
- عند التنفيذ فقط يتم تعطيل الملف الوظيفي وملف staff والحساب.
- لا يتم حذف السجلات التاريخية.
- Cron يصدر تذكيرًا باقتراب آخر يوم عمل.

---

## 12. الإشعارات

تم استخدام `notification_records` الحالي بدل إنشاء نظام منفصل.

الأحداث المغطاة تشمل:

- إرسال الطلب.
- الاستلام والتعيين والمراجعة.
- طلب معلومات ورد الموظفة.
- الموافقة والرفض.
- بدء التنفيذ والإكمال.
- التعليقات.
- فشل التنفيذ.
- تأخر العودة.
- اقتراب آخر يوم عمل.

كل إشعار مرتبط برقم الطلب ومساره، ولا يرسل للمستخدم إشعارًا عن الإجراء الذي نفذه بنفسه، ولا يتكرر لنفس event والمستلم.

---

## 13. المرفقات والأمان

- الملفات الثنائية في R2 فقط.
- D1 يحتفظ بالـmetadata والمرجع.
- الموظفة لا تستطيع الوصول إلى ملفات موظفة أخرى.
- رفع الموظفة يُجبر من Worker على:
  - `category = employee_request`
  - `visibility = private`
  - `employeeId` الخاص بالحساب
  - storage key مولد من الخادم
- الحد الأقصى للمرفق 10 ميجابايت مفروض في الواجهة وWorker.
- لا يمكن ربط metadata تخص موظفة أخرى أو تصنيفًا آخر بالطلب.

---

## 14. نتائج التحقق المنفذة

### فحص JavaScript

نجح `node --check` للملفات المعدلة والجديدة في Worker.

### فحص TypeScript/TSX

نجح فحص التحويل النحوي بواسطة TypeScript لجميع ملفات TS/TSX المعدلة والجديدة.

### SQL

تم تطبيق جميع ملفات Core migrations وعددها 22 على SQLite نظيف، بما فيها `0020_employee_requests.sql`، دون أخطاء.

### سيناريوهات تشغيلية منفذة

نجحت السيناريوهات التالية على قواعد بيانات مؤقتة خارج المشروع:

- إنشاء وتنفيذ الأنواع السبعة حتى `completed`.
- أرقام مرجعية مستقلة لكل نوع.
- 37 إشعارًا و51 حدثًا في سيناريو الدورة الكاملة.
- إجازة جزئية 4 ساعات مع خصم 0.5 يوم وتغطية 240 دقيقة.
- منع تكرار التعليق والمرفق بنفس idempotency key.
- تنبيه تأخر العودة دون تكرار.
- تحديث الأوفرتايم والسلفة في قيد الراتب.
- استقطاع القسط عند دفع الراتب وتحديث السلفة إلى repaid.
- فشل تنفيذ السلفة دون مرجع مالي ثم نجاح إعادة المحاولة.
- إعادة فتح الطلب المرفوض.
- إضافة وتعديل وحذف بصمة داخل `malikat-attendance` الفعلي، مع تحديث `attendance_state` وعدم إنشاء سجل مزيف في Core.

### `npm run build`

لم يمكن تشغيل البناء الكامل داخل بيئة التسليم لأن الملف المرفوع لا يحتوي على `node_modules`، ومحاولة تنزيل الحزم من registry في البيئة الحالية لم تكتمل. لم يتم الادعاء بأن البناء الكامل نجح هنا.

يجب تشغيل البناء على جهاز المشروع بعد تطبيق الحزمة:

```powershell
npm ci
npm run build
```

كما أن اختبارات Worker الأصلية التي تعتمد على `miniflare` و`jose` تحتاج تثبيت dependencies أولًا.

---

## 15. أوامر التطبيق محليًا

بعد نسخ الملفات إلى المشروع:

```powershell
cd C:\Users\nawaf\Downloads\queens-salon-web

npm ci
npm run build

npx wrangler d1 migrations apply queens-salon-core `
  --config wrangler.core.jsonc `
  --local

npm run dev:core
```

وفي نافذة أخرى:

```powershell
cd C:\Users\nawaf\Downloads\queens-salon-web
npm run dev
```

---

## 16. أوامر الإنتاج بعد المراجعة فقط

نعم، التعديل يحتاج **Core D1 migration** و**Core Worker deploy** لأنه أضاف جداول ومسارات ومنطق تنفيذ جديدًا.

بعد نجاح المراجعة المحلية والبناء:

```powershell
cd C:\Users\nawaf\Downloads\queens-salon-web

npx wrangler d1 migrations apply queens-salon-core `
  --config wrangler.core.jsonc `
  --remote

npx wrangler deploy --config wrangler.core.jsonc
```

بعد ذلك يرفع frontend بالطريقة المعتادة للمشروع.

---

## 17. قائمة المراجعة اليدوية

- تسجيل دخول موظفة مرتبطة بملف employee.
- فتح جميع النماذج السبعة.
- إرسال كل نوع والتحقق من الرقم المرجعي.
- فتح `/employee/requests` وتفاصيل الطلب.
- تسجيل دخول HR وفتح `/admin/requests`.
- الاستلام ثم المراجعة ثم طلب معلومات.
- رد الموظفة ثم الموافقة.
- تنفيذ الأثر التشغيلي لكل نوع.
- التحقق من الإشعارات والـbadge.
- التحقق من رفض الطلب وسبب الرفض.
- التحقق من منع الموظفة من فتح طلب موظفة أخرى.
- التحقق من منع إجراءات HR من حساب موظفة.
- التحقق من التصحيح داخل شاشة الحضور الفعلية.
- التحقق من الإجازة في التقويم.
- التحقق من الأوفرتايم والسلفة داخل الراتب.
- التحقق من أن الموافقة على الاستقالة لا تعطل الحساب قبل التنفيذ.
- التحقق من عرض الجوال والكمبيوتر وRTL.

---

## 18. نقاط لم تنفذ تلقائيًا

- لم يتم إرسال بريد إلكتروني؛ لا توجد ضمن الملفات المفحوصة خدمة بريد مؤكدة وآمنة لهذا المسار، والإشعارات داخل التطبيق مكتملة.
- لم يتم تشغيل build النهائي بسبب عدم توفر dependencies في بيئة التسليم، ويجب تشغيله محليًا بالأوامر أعلاه.
- لم يتم تطبيق migration عن بعد ولم يتم deploy أو commit أو push، التزامًا بنطاق المهمة.
