import DashboardNumberInputV2 from "../../components/dashboard-v2/DashboardNumberInputV2";
import { DashboardTimeInputV2 } from "../../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import {
  WorkspaceCardV2,
  WorkspaceHelpButtonV2,
  WorkspaceHelpDrawerV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  type WorkspaceHelpTopicV2,
  WorkspaceSwitchV2,
  WorkspaceTableV2,
  WorkspaceTabHeaderV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import { CoreHrService } from "../../services/CoreHrService";
import {
  SCHEDULE_EXCEPTION_CHANGED_EVENT,
  buildScheduleExceptionRestorePayload,
  filterScheduleExceptionsForView,
  getScheduleExceptionAction,
  getScheduleExceptionRestoreConfirmationMessage,
  isCancelledScheduleException,
  isOperationalScheduleException,
  type ScheduleExceptionFilter,
} from "./shiftExceptionRestore";
import type {
  CoreResolvedShift,
  CoreScheduleException,
  CoreShiftAssignment,
  CoreShiftChangePreview,
  CoreShiftPayrollAdjustment,
  CoreShiftPayrollPeriodLock,
  CoreShiftTemplate,
} from "../../types/hrCoreApi";

const SHIFT_CONTROL_HELP_TOPICS = {
  overview: {
    title: "قوالب الشفتات والاستثناءات",
    description: "إنشاء مصدر وقت الدوام وسياساته، ثم معالجة الحالات المؤقتة دون كسر الجدول الأساسي.",
    purpose: "قالب الشفت هو التعريف المركزي ليوم العمل: اسمه، وقت بدايته ونهايته، فترة سماح التأخير، وإمكانية إغلاق بصمة الحضور بعد مدة محددة. بعد إنشاء القالب يتم توزيعه على الموظفات وأيام الأسبوع. أما الاستثناء فيتقدم على الجدول لفترة قصيرة فقط، ثم يعود النظام تلقائيًا إلى الجدول الأساسي.",
    useWhen: "تريد إنشاء شفت صباحي أو مسائي يُستخدم أكثر من مرة، تعديل سياسة حضور مشتركة، أو تسجيل تغيير مؤقت مثل رمضان أو تدريب.",
    notFor: "تغيير يوم راحة أسبوعية ثابت أو تسجيل إجازة سنوية/مرضية؛ يوم الراحة من الأسبوع التشغيلي والإجازة من رصيد الإجازات.",
    example: {
      title: "شفت مسائي مع دوام رمضان",
      situation: "الدوام العادي 3:00 م إلى 11:00 م، سماح التأخير 15 دقيقة، وإغلاق بصمة الحضور بعد 30 دقيقة. في رمضان فقط يصبح الدوام 2:00 م إلى 10:00 م.",
      action: "أنشئ قالب «المسائي» بالسياسات العادية ووزعه على أيام الموظفة. لرمضان أنشئ استثناءً للفترة المطلوبة بساعات 2:00 م إلى 10:00 م بدل تعديل القالب العام.",
      result: "تستخدم جميع الأيام العادية القالب المسائي، وتستخدم أيام رمضان وقت الاستثناء فقط، ثم يعود الدوام تلقائيًا إلى 3:00 م بعد انتهاء الفترة.",
    },
    steps: [
      { title: "أنشئ القالب", description: "حدد اسم الشفت ووقته وسياسة التأخير وإغلاق بصمة الحضور." },
      { title: "وزّعه على الجدول", description: "ارجع للأسبوع التشغيلي واختر القالب لأيام عمل الموظفة." },
      { title: "استخدم الاستثناء عند الحاجة", description: "لراحة يوم أو شفت بديل أو وقت مؤقت استخدم الاستثناء بدل تعديل القالب العام." },
      { title: "راجع الشفت المطبق", description: "اختر تاريخًا وتأكد من المصدر والوقت النهائي قبل الاعتماد." },
    ],
    important: "تعديل قالب مستخدم ينعكس على كل الموظفات والأيام المرتبطة به؛ لا تعدله لمعالجة حالة تخص موظفة أو يومًا واحدًا.",
  },
  appliedShift: {
    title: "الشفت المطبق الآن",
    description: "معاينة النتيجة النهائية التي سيستخدمها الحضور والراتب في تاريخ محدد.",
    purpose: "يجمع هذا القسم جميع المصادر ويعرض القرار النهائي لليوم: يبدأ بالاستثناء إن وجد، ثم جدول الأسبوع، ثم التعيين الاحتياطي للبيانات القديمة. يوضح أيضًا وقت البداية والنهاية وسياسة التأخير وإغلاق البصمة، حتى تعرف بالضبط لماذا ظهر اليوم بهذا الشكل.",
    useWhen: "تلاحظ أن يومًا ظهر بوقت غير متوقع، تريد التأكد من أولوية استثناء، أو تراجع سبب احتساب تأخير أو غياب.",
    notFor: "إجراء التعديل نفسه؛ هذه شاشة تحقق ومعاينة، والتعديل يتم من القالب أو الأسبوع التشغيلي أو الاستثناء.",
    example: {
      title: "استثناء يتقدم على الجدول",
      situation: "الثلاثاء في الجدول الأسبوعي مرتبط بالشفت المسائي 3:00 م إلى 11:00 م، لكن يوجد استثناء تدريب في نفس التاريخ من 10:00 ص إلى 2:00 م.",
      action: "اختر تاريخ الثلاثاء في «الشفت المطبق الآن» وراجع خانة المصدر والوقت.",
      result: "سيظهر المصدر «استثناء» والوقت 10:00 ص إلى 2:00 م؛ لأن الاستثناء أعلى أولوية. بعد انتهاء الاستثناء يعود الثلاثاء إلى الشفت المسائي.",
    },
    steps: [
      { title: "اختر التاريخ", description: "حدد اليوم الذي تريد معرفة شفته الفعلي." },
      { title: "راجع المصدر", description: "تحقق هل النتيجة جاءت من استثناء، جدول أسبوعي، أو تعيين احتياطي." },
      { title: "راجع السياسة", description: "تأكد من وقت الدوام ومرونة الحضور ووقت إغلاق بصمة الحضور." },
      { title: "صحح المصدر", description: "عند وجود خطأ عدّل المصدر الذي ظهر في المعاينة بدل تغيير سجل الحضور يدويًا." },
    ],
    important: "المعاينة لا تحفظ أي تغيير؛ هدفها تفسير النتيجة النهائية قبل تعديل المصدر الصحيح.",
  },
  fallbackAssignment: {
    title: "تعيين الشفت الاحتياطي",
    description: "مسار توافق للموظفات القديمة التي لا يوجد لها أسبوع تشغيلي مكتمل.",
    purpose: "يحفظ شفتًا افتراضيًا على مستوى الموظفة ويستخدمه فقط عندما لا يجد النظام استثناءً ولا جدولًا أسبوعيًا صالحًا لذلك اليوم. وجوده يمنع ضياع وقت الدوام للبيانات القديمة أثناء الانتقال إلى النظام الجديد، لكنه ليس المسار المفضل للموظفات الجديدة.",
    useWhen: "لديك موظفة قديمة ما زالت بياناتها تعتمد على تعيين شفت عام، أو تحتاج فترة انتقالية قبل استكمال أسبوعها التشغيلي.",
    notFor: "إنشاء جدول موظفة جديدة أو توزيع أيام الراحة؛ استخدم الأسبوع التشغيلي لأنه أوضح وأدق.",
    example: {
      title: "موظفة قديمة بلا جدول أسبوعي",
      situation: "ملف موظفة قديم يحتوي حضورًا ورواتب، لكنه لا يحتوي توزيع شفتات لكل يوم.",
      action: "اختر قالب «المسائي»، حدد بداية التطبيق كتعيين دائم، افحص التداخلات ثم احفظ. بعد إنشاء الأسبوع التشغيلي سيصبح هو المصدر الأعلى.",
      result: "يستطيع النظام حل وقت الدوام للأيام التي لا يوجد لها جدول، دون أن يمنع الانتقال لاحقًا إلى الأسبوع التشغيلي.",
    },
    steps: [
      { title: "اختر القالب", description: "حدد شفتًا جاهزًا يناسب بيانات الموظفة القديمة." },
      { title: "حدد المدة", description: "اختر دائمًا أو مؤقتًا وحدد بداية ونهاية التطبيق بدقة." },
      { title: "افحص التداخل", description: "راجع أي تعيين سابق أو فترة رواتب مقفلة قبل الحفظ." },
      { title: "خطط للانتقال", description: "أنشئ الأسبوع التشغيلي عند توفر البيانات ثم أوقف الاعتماد على التعيين الاحتياطي." },
    ],
    important: "الاستثناء وجدول الأسبوع يتقدمان على هذا التعيين. لا تعتبره بديلًا دائمًا عن توزيع الشفتات الأسبوعي.",
  },
  employeeAssignments: {
    title: "تعيينات الموظفة",
    description: "عرض سجل تعيينات الشفت الاحتياطية الحالية والقادمة والمنتهية.",
    purpose: "يوضح هذا السجل أي قالب احتياطي عُيّن للموظفة، متى بدأ، متى ينتهي، وما حالته. يفيد في اكتشاف التداخلات، مراجعة سبب استخدام شفت قديم، وإنهاء تعيين لم يعد مطلوبًا دون تعديل قالب الشفت نفسه.",
    useWhen: "تراجع موظفة قديمة، تريد معرفة لماذا استُخدم شفت احتياطي، أو تحتاج إنهاء/تعديل تعيين مؤقت.",
    notFor: "عرض توزيع الشفت اليومي؛ ذلك موجود في الأسبوع التشغيلي، وهذه القائمة تخص التعيينات الاحتياطية فقط.",
    example: {
      title: "تعيين مؤقت ثم عودة للتعيين الدائم",
      situation: "للموظفة تعيين دائم مسائي، وتم تعيين شفت صباحي مؤقت من 1 إلى 15 أغسطس.",
      action: "راجع القائمة للتأكد من أن المؤقت له تاريخ نهاية صحيح ولا يتداخل مع تعيين آخر غير مقصود.",
      result: "يُستخدم الصباحي خلال الفترة المحددة، ثم يعود التعيين الدائم بعد 15 أغسطس إذا لم يوجد أسبوع تشغيلي أو استثناء أعلى أولوية.",
    },
    steps: [
      { title: "راجع الحالة", description: "نشط يعني مطبق الآن، مجدول يعني سيبدأ لاحقًا، ومنتهٍ يعني انتهت فترته." },
      { title: "راجع المدة", description: "تأكد من البداية والنهاية وعدم وجود فجوة أو تداخل غير مقصود." },
      { title: "عدّل أو أنهِ", description: "غيّر التعيين نفسه ولا تعدّل القالب العام إذا كانت المشكلة تخص موظفة واحدة." },
    ],
    important: "وجود تعيين هنا لا يلغي أولوية الاستثناء أو جدول الأسبوع، لذلك راجع «الشفت المطبق الآن» لمعرفة النتيجة النهائية.",
  },
  shiftTemplate: {
    title: "إنشاء قالب شفت",
    description: "تعريف وقت يوم العمل وسياسة الحضور مرة واحدة لإعادة استخدامها.",
    purpose: "القالب يجمع كل القواعد المشتركة ليوم العمل في سجل واحد: الاسم، رمز الشفت، وقت البداية والنهاية، مدة الاستراحة، فترة سماح التأخير، وإغلاق بصمة الحضور. عندما تختاره في أي يوم لا يعيد المستخدم كتابة هذه الإعدادات، ويضمن النظام أن الحضور والراتب يستخدمان نفس السياسة.",
    useWhen: "لديك نمط دوام متكرر مثل صباحي، مسائي، أو شفت رمضان سيُستخدم مع أكثر من موظفة أو أكثر من يوم.",
    notFor: "تغيير ساعات موظفة ليوم واحد أو فترة قصيرة؛ أنشئ استثناءً بدل إنشاء/تعديل قالب عام.",
    example: {
      title: "قالب الشفت المسائي",
      situation: "العمل من 3:00 م إلى 11:00 م، فترة سماح التأخير 15 دقيقة، وإغلاق بصمة الحضور بعد 30 دقيقة.",
      action: "أنشئ قالبًا باسم «الشفت المسائي»، أدخل الوقت، اجعل السماح 15، فعّل إغلاق الحضور وأدخل 30. بعد ذلك وزعه على أيام العمل.",
      result: "إذا حضرت الموظفة 3:11 وخرجت 11:11 فلا يبقى تأخير غير معوض. إذا خرجت 11:05 يبقى 6 دقائق تأخير. بعد 3:30 تُغلق بصمة الحضور إذا كان الإغلاق مفعلًا، مع بقاء الإدارة قادرة على التصحيح.",
    },
    steps: [
      { title: "سمّ الشفت", description: "استخدم اسمًا واضحًا مثل الصباحي 8-4 أو المسائي 3-11." },
      { title: "حدد الوقت", description: "أدخل بداية ونهاية الدوام الفعليتين، بما في ذلك الشفت الذي يتجاوز منتصف الليل إن كان مدعومًا." },
      { title: "حدد المرونة", description: "فترة سماح التأخير تسمح بالدخول خلال النافذة، لكنها لا تلغي الدقائق غير المعوضة عند نهاية الدوام." },
      { title: "حدد إغلاق البصمة", description: "فعّل الإغلاق وحدد المدة التي بعدها لا تقبل بصمة حضور الموظفة." },
      { title: "راجع قبل التوزيع", description: "تأكد أن مدة الإغلاق ليست أقل من فترة السماح وأن القالب نشط." },
    ],
    important: "لا يوجد سماح خروج مبكر. الخروج قبل وقت نهاية الشفت يُحسب نقصًا من أول دقيقة، والتأخير لا يُعفى إلا بمقدار ما عُوّض بعد نهاية الشفت.",
  },
  shiftException: {
    title: "استثناء الشفت",
    description: "تغيير مؤقت ليوم أو فترة دون تعديل القالب أو الجدول الأساسي.",
    purpose: "الاستثناء يضع قاعدة مؤقتة أعلى من الأسبوع التشغيلي خلال تواريخ محددة. يمكن أن يجعل الفترة راحة/إغلاقًا معتمدًا، يبدلها إلى قالب شفت آخر، أو يحدد وقتًا مخصصًا. عند انتهاء الفترة يختفي أثره تلقائيًا ويعود النظام إلى الجدول الأصلي.",
    useWhen: "دوام رمضان، تدريب، مناسبة، تبديل شفت مؤقت، إغلاق فرع، أو تغيير ساعات ليوم/فترة محددة.",
    notFor: "راحة أسبوعية تتكرر دائمًا أو إجازة تخص رصيد الموظفة؛ استخدم الأسبوع التشغيلي أو نظام الإجازات.",
    example: {
      title: "تدريب يوم واحد",
      situation: "الموظفة شفتها المعتاد 3:00 م إلى 11:00 م، لكن يوم 12 أغسطس لديها تدريب من 10:00 ص إلى 2:00 م.",
      action: "أنشئ استثناءً ليوم 12 أغسطس بنوع وقت مخصص، وأدخل 10:00 ص إلى 2:00 م مع ملاحظة «تدريب».",
      result: "يحسب الحضور ذلك اليوم على وقت التدريب فقط، وفي يوم 13 أغسطس يعود النظام تلقائيًا إلى الشفت المسائي المعتاد.",
    },
    steps: [
      { title: "اختر النوع", description: "حدد راحة/إغلاق، شفت بديل، أو وقتًا مخصصًا." },
      { title: "حدد الفترة", description: "اختر تاريخ البداية والنهاية؛ اجعلهما متطابقين لاستثناء يوم واحد." },
      { title: "أدخل المصدر الصحيح", description: "اختر القالب البديل أو الساعات المخصصة حسب نوع الاستثناء." },
      { title: "افحص الاستثناء", description: "راجع أثره والمصدر النهائي قبل الحفظ." },
    ],
    important: "الاستثناء أعلى أولوية من جدول الأسبوع خلال مدته. استخدم ملاحظة واضحة لأن أثره يصل إلى الحضور والراتب.",
  },
  templatesList: {
    title: "قائمة قوالب الشفتات",
    description: "مراجعة القوالب العامة المحفوظة والسياسات المرتبطة بكل قالب.",
    purpose: "تعرض القائمة جميع القوالب التي يمكن توزيعها على الموظفات، مع وقت كل قالب، فترة السماح، إعداد إغلاق البصمة، وحالته. من هنا تعرف أي قالب مستخدم قبل فتحه للتعديل، وتمنع إنشاء قوالب مكررة بأسماء مختلفة لنفس الوقت.",
    useWhen: "تريد مراجعة القوالب المتاحة، تعديل سياسة عامة، تعطيل قالب قديم، أو اختيار القالب الصحيح قبل توزيعه.",
    notFor: "تغيير يوم موظفة بعينها؛ تعديل القالب ينعكس على كل استخداماته وليس على موظفة واحدة فقط.",
    example: {
      title: "تعديل سماح قالب مستخدم",
      situation: "قالب «المسائي» مستخدم لدى خمس موظفات، وفترة السماح الحالية 15 دقيقة.",
      action: "قبل تغييرها إلى 20 دقيقة، راجع أن القرار مقصود لكل الموظفات والأيام المرتبطة بالقالب، ثم افتح القالب وعدله.",
      result: "من تاريخ اعتماد التعديل ستستخدم جميع الأيام المرتبطة بالقالب السياسة الجديدة؛ لذلك لا تستخدم هذا الإجراء لمعالجة حالة فردية.",
    },
    steps: [
      { title: "راجع الاسم والوقت", description: "تأكد أن القالب ليس نسخة مكررة من قالب قائم." },
      { title: "راجع السياسة", description: "افحص فترة السماح وإغلاق البصمة قبل التعديل." },
      { title: "عدّل بحذر", description: "تذكر أن التعديل يؤثر في كل الموظفات والأيام التي تستخدم القالب." },
      { title: "عطّل بدل الحذف", description: "عند إيقاف استخدام قالب قديم عطّله مع الحفاظ على السجل التاريخي." },
    ],
    important: "لا تحذف أو تغيّر قالبًا مستخدمًا في فترات رواتب مقفلة دون مراجعة الأثر التاريخي.",
  },
  exceptionsList: {
    title: "استثناءات الموظفة",
    description: "مراجعة التغييرات المؤقتة المسجلة وتواريخها ومصادرها.",
    purpose: "تعرض هذه القائمة كل استثناء مسجل للموظفة، سواء كان إغلاقًا، شفتًا بديلًا، أو وقتًا مخصصًا. تساعدك على اكتشاف استثناء قديم ما زال يغطي تاريخًا غير مقصود، ومعرفة لماذا لم يستخدم النظام جدول الأسبوع في يوم معين.",
    useWhen: "تراجع سبب ظهور يوم كشفت مختلف، تريد إلغاء استثناء انتهت الحاجة إليه، أو تتحقق من عدم وجود فترات متداخلة.",
    notFor: "إدارة الراحة الأسبوعية أو قوالب الشفتات العامة؛ هذه القائمة تخص الاستثناءات المؤقتة للموظفة فقط.",
    example: {
      title: "استثناء خاطئ يغطي يومين",
      situation: "تم تسجيل تدريب ليوم 5 أغسطس، لكن تاريخ النهاية وُضع 6 أغسطس بالخطأ.",
      action: "افتح الاستثناء من القائمة وعدّل النهاية إلى 5 أغسطس، أو ألغِه ثم أنشئ السجل الصحيح.",
      result: "يوم 5 يستخدم وقت التدريب، ويوم 6 يعود إلى جدول الأسبوع بدل الاستمرار على الاستثناء الخاطئ.",
    },
    steps: [
      { title: "راجع الفترة", description: "تأكد من تاريخ البداية والنهاية وعدم تغطية أيام إضافية." },
      { title: "راجع النوع والوقت", description: "تأكد أن الإغلاق أو الشفت البديل أو الوقت المخصص هو المقصود." },
      { title: "عدّل أو ألغِ", description: "عند الإلغاء يعود النظام إلى المصدر التالي: جدول الأسبوع ثم التعيين الاحتياطي." },
    ],
    important: "الراحة الأسبوعية الثابتة لا تظهر هنا؛ تُدار من الأسبوع التشغيلي. والإجازات الفعلية تُدار من نظام الإجازات.",
  },
} satisfies Record<string, WorkspaceHelpTopicV2>;

type ShiftControlSectionProps = {
  isVisible: boolean;
  employeeId: string;
  employeeUid?: string;
  employeeIds?: string[];
  employeeName?: string;
  canManage: boolean;
};

type TemplateForm = {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  lateGraceMinutes: string;
  attendanceLockEnabled: boolean;
  attendanceLockAfterMinutes: string;
  overtimeAfterMinutes: string;
  active: boolean;
};

type AssignmentForm = {
  id: string;
  shiftTemplateId: string;
  effectiveFrom: string;
  effectiveTo: string;
  assignmentType: "permanent" | "temporary";
  replaceOverlaps: boolean;
  reason: string;
};

type ExceptionForm = {
  dateFrom: string;
  dateTo: string;
  exceptionType: "shift" | "off" | "custom";
  shiftTemplateId: string;
  startTime: string;
  endTime: string;
  note: string;
};

function todayKey() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function boolish(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function uniqueCleanTexts(values: unknown[]) {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function isFullShiftIdentifier(value: unknown) {
  return /^[A-Za-z0-9_-]{20,}$/.test(cleanText(value));
}

function isCoreEmployeeIdentifier(value: unknown) {
  const id = cleanText(value);
  return Boolean(
    id &&
      !id.startsWith("app_user_") &&
      /^[A-Za-z0-9_-]+$/.test(id)
  );
}

function readAliasValue(row: unknown, camelKey: string, snakeKey: string = camelKey) {
  const record = (row || {}) as Record<string, unknown>;
  return record[camelKey] ?? record[snakeKey];
}

function parseSnapshot(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function templateForAssignment(assignment: CoreShiftAssignment | null | undefined, templates: CoreShiftTemplate[]) {
  const templateId = cleanText(assignment?.shiftTemplateId || (assignment as Record<string, unknown> | null | undefined)?.shift_template_id);
  return templates.find((template) => template.id === templateId) || null;
}

function assignmentShiftName(assignment: CoreShiftAssignment | null | undefined, templates: CoreShiftTemplate[]) {
  const template = templateForAssignment(assignment, templates);
  const snapshot = parseSnapshot(assignment?.snapshotJson || (assignment as Record<string, unknown> | null | undefined)?.snapshot_json);
  return cleanText(assignment?.shiftName || (assignment as Record<string, unknown> | null | undefined)?.shift_name || template?.name || snapshot.name || snapshot.shiftName || snapshot.shift_name);
}

function assignmentShiftRecord(assignment: CoreShiftAssignment | null | undefined, templates: CoreShiftTemplate[]) {
  const template = templateForAssignment(assignment, templates);
  const snapshot = parseSnapshot(assignment?.snapshotJson || (assignment as Record<string, unknown> | null | undefined)?.snapshot_json);
  return { ...(snapshot || {}), ...(template || {}), ...(assignment || {}) } as Record<string, unknown>;
}

function isAssignmentActiveOnDate(assignment: CoreShiftAssignment, dateKey: string) {
  const status = cleanText(assignment.status);
  const fromDate = cleanText(assignment.effectiveFrom || (assignment as Record<string, unknown>).effective_from);
  const toDate = cleanText(assignment.effectiveTo || (assignment as Record<string, unknown>).effective_to);
  if (status === "cancelled") return false;
  if (!fromDate) return false;
  return fromDate <= dateKey && (!toDate || toDate >= dateKey);
}

function resolvedShiftRank(row?: CoreResolvedShift | null) {
  const source = cleanText(row?.source).toLowerCase();
  const exceptionType = cleanText(row?.exceptionType || row?.exception_type).toLowerCase();
  if (source === "exception" && exceptionType === "off") return 5;
  if (source === "exception") return 4;
  if (source === "assignment") return 3;
  if (source && source !== "none") return 2;
  return 0;
}

function pickBestResolvedShift(rows: Array<CoreResolvedShift | null | undefined>) {
  return rows
    .filter(Boolean)
    .sort((left, right) => resolvedShiftRank(right) - resolvedShiftRank(left))[0] || null;
}


function numberInput(value: unknown, fallback = "0") {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? String(number) : fallback;
}

function readNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function shiftPreviewDescription(preview: CoreShiftChangePreview) {
  const affectedDays = readNumber(preview.affectedDays ?? preview.affected_days);
  const overlaps = readNumber(preview.overlappingAssignmentsCount ?? preview.overlapping_assignments_count);
  const lockedPeriods = readNumber(preview.lockedPeriodsCount ?? preview.locked_periods_count);

  const affectedText = affectedDays === 1
    ? "سيتم تعديل يوم واحد فقط."
    : affectedDays > 1
      ? `سيتم تعديل ${affectedDays} أيام.`
      : "لن تتغير أيام حضور حالية حسب الفحص.";

  const overlapText = overlaps
    ? `يوجد ${overlaps} تعيين شفت متداخل وسيتم إغلاقه تلقائيًا لنفس الموظفة فقط.`
    : "لا توجد تعيينات شفت متداخلة.";

  const lockedText = lockedPeriods
    ? `تنبيه: يوجد ${lockedPeriods} فترة مقفلة. راجع أثر التعديل على الرواتب أو الحضور قبل الحفظ.`
    : "لا توجد فترات مقفلة تمنع الحفظ.";

  return `${affectedText} ${overlapText} ${lockedText}`;
}

function formatWindow(row?: Partial<CoreShiftTemplate | CoreShiftAssignment | CoreScheduleException | CoreResolvedShift> | null) {
  const record = row as Record<string, unknown> | null | undefined;
  const start = cleanText(record?.templateStartTime || record?.template_start_time || record?.startTime || record?.start_time);
  const end = cleanText(record?.templateEndTime || record?.template_end_time || record?.endTime || record?.end_time);
  if (!start && !end) return "بدون وقت";
  return `${start || "--:--"} - ${end || "--:--"}`;
}

function statusLabel(value: unknown) {
  const status = cleanText(value);
  if (status === "published") return "منشور";
  if (status === "draft") return "مسودة";
  if (status === "cancelled") return "ملغي";
  if (status === "approved") return "معتمد";
  if (status === "active") return "نشط";
  return status || "غير محدد";
}

function assignmentStatus(assignment: CoreShiftAssignment) {
  const today = todayKey();
  const status = cleanText(assignment.status);
  if (status === "cancelled") return "ملغي";
  if (assignment.effectiveTo && assignment.effectiveTo < today) return "منتهي";
  if (assignment.effectiveFrom > today) return "مجدول";
  if (status === "published") return "نشط";
  return statusLabel(status);
}

function assignmentTone(assignment: CoreShiftAssignment): "success" | "gold" | "danger" | "default" {
  const label = assignmentStatus(assignment);
  if (label === "نشط") return "success";
  if (label === "مجدول") return "gold";
  if (label === "ملغي") return "danger";
  return "default";
}

function exceptionTypeLabel(type: string) {
  if (type === "shift") return "شفت بديل";
  if (type === "off") return "راحة";
  if (type === "custom") return "وقت مخصص";
  return type || "استثناء";
}

function emptyTemplateForm(): TemplateForm {
  return {
    id: "",
    name: "",
    code: "",
    startTime: "10:00",
    endTime: "18:00",
    breakMinutes: "0",
    lateGraceMinutes: "15",
    attendanceLockEnabled: false,
    attendanceLockAfterMinutes: "30",
    overtimeAfterMinutes: "0",
    active: true,
  };
}

function emptyAssignmentForm(): AssignmentForm {
  return {
    id: "",
    shiftTemplateId: "",
    effectiveFrom: todayKey(),
    effectiveTo: "",
    assignmentType: "permanent",
    replaceOverlaps: true,
    reason: "تعيين شفت من إدارة الموظفات",
  };
}

function emptyExceptionForm(): ExceptionForm {
  const today = todayKey();
  return {
    dateFrom: today,
    dateTo: today,
    exceptionType: "shift",
    shiftTemplateId: "",
    startTime: "10:00",
    endTime: "18:00",
    note: "استثناء من إدارة الموظفات",
  };
}

export default function ShiftControlSection({
  isVisible,
  employeeId,
  employeeUid = "",
  employeeIds = [],
  employeeName,
  canManage,
}: ShiftControlSectionProps) {
  const [templates, setTemplates] = useState<CoreShiftTemplate[]>([]);
  const [assignments, setAssignments] = useState<CoreShiftAssignment[]>([]);
  const [exceptions, setExceptions] = useState<CoreScheduleException[]>([]);
  const [locks, setLocks] = useState<CoreShiftPayrollPeriodLock[]>([]);
  const [adjustments, setAdjustments] = useState<CoreShiftPayrollAdjustment[]>([]);
  const [resolvedDate, setResolvedDate] = useState(todayKey());
  const [resolvedShift, setResolvedShift] = useState<CoreResolvedShift | null>(null);
  const [preview, setPreview] = useState<CoreShiftChangePreview | null>(null);
  const [allowLockedPeriodAdjustment, setAllowLockedPeriodAdjustment] = useState(false);
  const [templateForm, setTemplateForm] = useState<TemplateForm>(() => emptyTemplateForm());
  const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>(() => emptyAssignmentForm());
  const [exceptionForm, setExceptionForm] = useState<ExceptionForm>(() => emptyExceptionForm());
  const [exceptionFilter, setExceptionFilter] = useState<ScheduleExceptionFilter>("current");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [helpTopic, setHelpTopic] = useState<WorkspaceHelpTopicV2 | null>(null);
  const assignmentEditorRef = useRef<HTMLDivElement | null>(null);

  const focusAssignmentEditor = useCallback(() => {
    window.setTimeout(() => {
      assignmentEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  const shiftEmployeeIdsKey = uniqueCleanTexts([employeeUid, employeeId, ...employeeIds])
    .filter(isCoreEmployeeIdentifier)
    .join("|");
  const shiftEmployeeIds = useMemo(
    () => shiftEmployeeIdsKey.split("|").filter(Boolean),
    [shiftEmployeeIdsKey]
  );

  const activeTemplates = useMemo(() => templates.filter((template) => boolish(template.active)), [templates]);
  const templateOptions = useMemo(() => {
    const source = activeTemplates.length ? activeTemplates : templates;
    return source.map((template) => ({
      value: template.id,
      label: `${template.name || template.id} - ${formatWindow(template)}`,
    }));
  }, [activeTemplates, templates]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === assignmentForm.shiftTemplateId) || null,
    [assignmentForm.shiftTemplateId, templates],
  );

  const openAssignment = useMemo(
    () => assignments.find((assignment) => isAssignmentActiveOnDate(assignment, resolvedDate)) || null,
    [assignments, resolvedDate],
  );

  const targetShiftEmployeeId = useMemo(() => {
    const currentAssignmentEmployeeId = cleanText(openAssignment?.employeeId || (openAssignment as Record<string, unknown> | null)?.employee_id);
    return currentAssignmentEmployeeId || shiftEmployeeIds.find(isFullShiftIdentifier) || shiftEmployeeIds[0] || employeeId;
  }, [employeeId, openAssignment, shiftEmployeeIds]);

  const load = useCallback(async () => {
    if (!isVisible || !shiftEmployeeIds.length) return;
    setLoading(true);
    setError("");
    try {
      const [templateRows, assignmentGroups, exceptionGroups, lockRows, adjustmentGroups, resolvedBatch] = await Promise.all([
        CoreHrService.listShiftTemplates({ active: "all" }),
        Promise.all(shiftEmployeeIds.map((id) => CoreHrService.listShiftAssignments({ employeeId: id }).catch(() => [] as CoreShiftAssignment[]))),
        Promise.all(shiftEmployeeIds.map((id) => CoreHrService.listScheduleExceptions({ employeeId: id }).catch(() => [] as CoreScheduleException[]))),
        CoreHrService.listShiftPayrollPeriodLocks(),
        Promise.all(shiftEmployeeIds.map((id) => CoreHrService.listShiftPayrollAdjustments({ employeeId: id }).catch(() => [] as CoreShiftPayrollAdjustment[]))),
        CoreHrService.resolveEmployeeShiftsRange({
          employeeIds: shiftEmployeeIds,
          dateFrom: resolvedDate,
          dateTo: resolvedDate,
        }).catch(() => ({ rows: [] as CoreResolvedShift[] })),
      ]);

      const mergeById = <T extends { id: string }>(groups: T[][]) => Array.from(
        new Map(groups.flat().filter((row) => cleanText(row.id)).map((row) => [row.id, row])).values()
      );

      setTemplates(templateRows);
      setAssignments(mergeById(assignmentGroups));
      setExceptions(mergeById(exceptionGroups));
      setLocks(lockRows);
      setAdjustments(mergeById(adjustmentGroups));
      setResolvedShift(pickBestResolvedShift(resolvedBatch.rows));

      const firstTemplateId = templateRows.find((template) => boolish(template.active))?.id || templateRows[0]?.id || "";
      setAssignmentForm((current) => ({ ...current, shiftTemplateId: current.shiftTemplateId || firstTemplateId }));
      setExceptionForm((current) => ({ ...current, shiftTemplateId: current.shiftTemplateId || firstTemplateId }));
    } catch (err) {
      console.warn("shift control load failed", err);
      setError("تعذر تحميل الشفتات من Core.");
    } finally {
      setLoading(false);
    }
  }, [isVisible, resolvedDate, shiftEmployeeIds]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewAssignment = async () => {
    if (!targetShiftEmployeeId || !assignmentForm.effectiveFrom) return null;
    const previewTo = assignmentForm.assignmentType === "permanent"
      ? assignmentForm.effectiveFrom
      : assignmentForm.effectiveTo || assignmentForm.effectiveFrom;
    const result = await CoreHrService.previewShiftChange({
      employeeId: targetShiftEmployeeId,
      changeType: "assignment",
      effectiveFrom: assignmentForm.effectiveFrom,
      effectiveTo: previewTo,
    });
    setPreview(result);
    return result;
  };

  const previewException = async () => {
    if (!targetShiftEmployeeId || !exceptionForm.dateFrom) return null;
    const result = await CoreHrService.previewShiftChange({
      employeeId: targetShiftEmployeeId,
      changeType: "exception",
      dateFrom: exceptionForm.dateFrom,
      dateTo: exceptionForm.dateTo || exceptionForm.dateFrom,
    });
    setPreview(result);
    return result;
  };

  const previewAllowsSave = (result: CoreShiftChangePreview | null) => {
    const lockedCount = readNumber(result?.lockedPeriodsCount ?? result?.locked_periods_count);
    if (lockedCount > 0 && !allowLockedPeriodAdjustment) {
      setError("يوجد فترة رواتب مقفلة. فعّل خيار تسجيل تسوية بعد الإقفال قبل الحفظ.");
      return false;
    }
    return true;
  };

  const saveTemplate = async () => {
    if (!canManage) return;
    if (!templateForm.name.trim()) {
      setError("اسم الشفت مطلوب.");
      return;
    }
    const lateGraceMinutes = Number(templateForm.lateGraceMinutes || 0);
    const attendanceLockAfterMinutes = Number(templateForm.attendanceLockAfterMinutes || 0);
    if (templateForm.attendanceLockEnabled && attendanceLockAfterMinutes < lateGraceMinutes) {
      setError("مدة إغلاق البصمة يجب أن تكون مساوية لفترة سماح التأخير أو أكبر منها.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.saveShiftTemplate({
        id: templateForm.id || undefined,
        name: templateForm.name.trim(),
        code: templateForm.code.trim() || null,
        startTime: templateForm.startTime,
        endTime: templateForm.endTime,
        crossesMidnight: false,
        breakMinutes: Number(templateForm.breakMinutes || 0),
        breakPaid: false,
        lateGraceMinutes,
        earlyLeaveGraceMinutes: 0,
        attendanceLockEnabled: templateForm.attendanceLockEnabled,
        attendanceLockAfterMinutes,
        overtimeAfterMinutes: Number(templateForm.overtimeAfterMinutes || 0),
        active: templateForm.active,
        reason: "تحديث قالب شفت من مساحة الموظفة V2",
      });
      setTemplateForm(emptyTemplateForm());
      setMessage("تم حفظ قالب الشفت.");
      await load();
    } catch (err) {
      console.warn("save shift template failed", err);
      setError("تعذر حفظ قالب الشفت.");
    } finally {
      setSaving(false);
    }
  };

  const editTemplate = (template: CoreShiftTemplate) => {
    setTemplateForm({
      id: template.id,
      name: template.name || "",
      code: template.code || "",
      startTime: template.startTime || "10:00",
      endTime: template.endTime || "18:00",
      breakMinutes: numberInput(template.breakMinutes),
      lateGraceMinutes: numberInput(template.lateGraceMinutes),
      attendanceLockEnabled: boolish(template.attendanceLockEnabled),
      attendanceLockAfterMinutes: numberInput(template.attendanceLockAfterMinutes, "30"),
      overtimeAfterMinutes: numberInput(template.overtimeAfterMinutes),
      active: boolish(template.active),
    });
  };

  const editAssignment = (assignment: CoreShiftAssignment) => {
    if (assignmentStatus(assignment) === "ملغي") {
      setError("لا يمكن تعديل تعيين ملغي. أنشئ تعيينًا جديدًا بدلًا من تعديل سجل ملغي.");
      return;
    }
    const assignmentEnd = cleanText(assignment.effectiveTo || (assignment as Record<string, unknown>).effective_to);
    setAssignmentForm({
      id: assignment.id,
      shiftTemplateId: cleanText(assignment.shiftTemplateId || (assignment as Record<string, unknown>).shift_template_id),
      effectiveFrom: cleanText(assignment.effectiveFrom || (assignment as Record<string, unknown>).effective_from) || todayKey(),
      effectiveTo: assignmentEnd,
      assignmentType: assignmentEnd ? "temporary" : cleanText(assignment.assignmentType || (assignment as Record<string, unknown>).assignment_type) === "temporary" ? "temporary" : "permanent",
      replaceOverlaps: true,
      reason: cleanText(assignment.reason) || "تعديل تعيين شفت من إدارة الموظفات",
    });
    setPreview(null);
    setError("");
    setMessage("وضع التعديل نشط: عدّل التعيين ثم اضغط حفظ التعديل.");
    focusAssignmentEditor();
  };

  const startNewAssignment = () => {
    setAssignmentForm((current) => ({
      ...emptyAssignmentForm(),
      shiftTemplateId: current.shiftTemplateId || selectedTemplate?.id || activeTemplates[0]?.id || templates[0]?.id || "",
    }));
    setPreview(null);
    setMessage("جاهز لتعيين شفت جديد. سيتم إغلاق أي تداخل سابق لنفس الموظفة تلقائيًا.");
    focusAssignmentEditor();
  };

  const saveAssignment = async () => {
    if (!canManage) return;
    if (!assignmentForm.shiftTemplateId || !assignmentForm.effectiveFrom || !assignmentForm.reason.trim()) {
      setError("الشفت وتاريخ البداية وسبب التغيير مطلوبة.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await previewAssignment();
      if (!previewAllowsSave(result)) return;
      const normalizedEffectiveTo = assignmentForm.assignmentType === "permanent" ? null : assignmentForm.effectiveTo || null;
      const payload = {
        employeeId: targetShiftEmployeeId,
        shiftTemplateId: assignmentForm.shiftTemplateId,
        effectiveFrom: assignmentForm.effectiveFrom,
        effectiveTo: normalizedEffectiveTo,
        assignmentType: assignmentForm.assignmentType,
        status: "published",
        replaceOverlaps: true,
        reason: assignmentForm.reason,
        snapshot: selectedTemplate || {},
        allowLockedPeriodAdjustment,
      };
      if (assignmentForm.id) {
        await CoreHrService.updateShiftAssignment(assignmentForm.id, payload);
        setMessage("تم تعديل تعيين الشفت للموظفة.");
      } else {
        await CoreHrService.createShiftAssignment(payload);
        setMessage("تم تعيين الشفت للموظفة.");
      }
      setAssignmentForm(emptyAssignmentForm());
      await load();
    } catch (err) {
      console.warn("save shift assignment failed", err);
      const detail = cleanText((err as Error)?.message);
      setError(detail.includes("securetoken") || detail.includes("auth/")
        ? "تعذر حفظ تعيين الشفت لأن جلسة Firebase لا تستطيع تجديد الرمز. سجّل خروج ثم دخول أو أصلح قيود Firebase API Key."
        : "تعذر حفظ تعيين الشفت. راجع التداخلات أو الصلاحيات.");
    } finally {
      setSaving(false);
    }
  };

  const cancelAssignment = async (assignment: CoreShiftAssignment) => {
    if (!canManage) return;
    if (!window.confirm(`إلغاء تعيين الشفت ${assignment.shiftName || "الحالي"}؟`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.cancelShiftAssignment(assignment.id, "إلغاء من مساحة الموظفة V2", { allowLockedPeriodAdjustment });
      setMessage("تم إلغاء تعيين الشفت.");
      await load();
    } catch (err) {
      console.warn("cancel assignment failed", err);
      const detail = cleanText((err as Error)?.message);
      setError(detail.includes("securetoken") || detail.includes("auth/")
        ? "تعذر إلغاء التعيين لأن جلسة Firebase لا تستطيع تجديد الرمز. سجّل خروج ثم دخول أو أصلح قيود Firebase API Key."
        : "تعذر إلغاء تعيين الشفت.");
    } finally {
      setSaving(false);
    }
  };

  const closeAssignment = async (assignment: CoreShiftAssignment) => {
    if (!canManage) return;
    if (!window.confirm(`إنهاء تعيين الشفت بتاريخ ${todayKey()}؟`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.updateShiftAssignment(assignment.id, {
        effectiveTo: todayKey(),
        reason: "إنهاء شفت من مساحة الموظفة V2",
        allowLockedPeriodAdjustment,
      });
      setMessage("تم إنهاء الشفت.");
      await load();
    } catch (err) {
      console.warn("close assignment failed", err);
      setError("تعذر إنهاء الشفت.");
    } finally {
      setSaving(false);
    }
  };

  const createException = async () => {
    if (!canManage) return;
    if (!exceptionForm.dateFrom || !exceptionForm.dateTo) {
      setError("تاريخ الاستثناء مطلوب.");
      return;
    }
    if (exceptionForm.exceptionType === "shift" && !exceptionForm.shiftTemplateId) {
      setError("اختر شفت بديل.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await previewException();
      if (!previewAllowsSave(result)) return;
      await CoreHrService.createScheduleException({
        employeeId: targetShiftEmployeeId,
        dateFrom: exceptionForm.dateFrom,
        dateTo: exceptionForm.dateTo,
        exceptionType: exceptionForm.exceptionType,
        shiftTemplateId: exceptionForm.exceptionType === "shift" ? exceptionForm.shiftTemplateId : null,
        enabled: exceptionForm.exceptionType !== "off",
        startTime: exceptionForm.exceptionType === "custom" ? exceptionForm.startTime : null,
        endTime: exceptionForm.exceptionType === "custom" ? exceptionForm.endTime : null,
        note: exceptionForm.note,
        status: "approved",
        allowLockedPeriodAdjustment,
      });
      setExceptionForm(emptyExceptionForm());
      setMessage("تم حفظ الاستثناء.");
      await load();
    } catch (err) {
      console.warn("create exception failed", err);
      setError("تعذر حفظ الاستثناء.");
    } finally {
      setSaving(false);
    }
  };

  const cancelException = async (exception: CoreScheduleException) => {
    if (!canManage) return;
    if (!window.confirm(`إلغاء استثناء ${exception.dateFrom}؟`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.updateScheduleException(exception.id, {
        status: "cancelled",
        enabled: false,
        note: "إلغاء من مساحة الموظفة V2",
        allowLockedPeriodAdjustment,
      });
      setMessage("تم إلغاء الاستثناء.");
      await load();
    } catch (err) {
      console.warn("cancel exception failed", err);
      setError("تعذر إلغاء الاستثناء.");
    } finally {
      setSaving(false);
    }
  };

  const restoreException = async (exception: CoreScheduleException) => {
    if (!canManage) return;
    if (!isCancelledScheduleException(exception)) {
      setError("يمكن استعادة الاستثناءات الملغاة فقط.");
      return;
    }
    const payload = buildScheduleExceptionRestorePayload(exception);
    const confirmation = getScheduleExceptionRestoreConfirmationMessage(exception, todayKey());
    if (!window.confirm(confirmation)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.createScheduleException({
        ...payload,
        allowLockedPeriodAdjustment,
      });
      await load();
      window.dispatchEvent(
        new CustomEvent(SCHEDULE_EXCEPTION_CHANGED_EVENT, {
          detail: {
            employeeId: payload.employeeId,
            restoredFromExceptionId: exception.id,
          },
        })
      );
      setMessage("تمت استعادة الاستثناء كسجل Core نشط جديد.");
    } catch (err) {
      console.warn("restore exception failed", err);
      const code = cleanText((err as { code?: string })?.code);
      const detail = cleanText((err as Error)?.message);
      setError(code.includes("schedule_exception_conflict")
        ? "يوجد استثناء نشط آخر يتداخل مع هذا الاستثناء. راجعه أولًا قبل الاستعادة."
        : detail.includes("securetoken") || detail.includes("auth/")
          ? "تعذر استعادة الاستثناء لأن جلسة Firebase لا تستطيع تجديد الرمز. سجّل خروج ثم دخول أو أصلح قيود Firebase API Key."
          : "تعذر استعادة الاستثناء من Core. راجع التداخلات أو الصلاحيات.");
    } finally {
      setSaving(false);
    }
  };

  const visibleExceptions = useMemo(
    () => filterScheduleExceptionsForView(exceptions, exceptionFilter),
    [exceptionFilter, exceptions]
  );
  const exceptionFilterOptions: Array<{ value: ScheduleExceptionFilter; label: string }> = [
    { value: "current", label: "الحالية" },
    { value: "cancelled", label: "الملغاة" },
    { value: "all", label: "الكل" },
  ];

  if (!isVisible) return null;

  const source = cleanText(resolvedShift?.source);
  const resolvedExceptionType = cleanText(resolvedShift?.exceptionType || resolvedShift?.exception_type);
  const resolvedShiftName = cleanText(resolvedShift?.shiftName || resolvedShift?.shift_name);
  const openAssignmentName = assignmentShiftName(openAssignment, templates);
  const openAssignmentWindow = openAssignment ? formatWindow(assignmentShiftRecord(openAssignment, templates)) : "لا يوجد";
  const selectedTemplateWindow = selectedTemplate ? formatWindow(selectedTemplate) : "اختر شفت";
  const resolvedLabel = source === "exception"
    ? "استثناء يومي"
    : source === "weekly_schedule"
      ? "جدول الدوام الأسبوعي"
      : source === "assignment"
        ? "شفت افتراضي"
        : "لا يوجد";
  const resolvedStatus = resolvedExceptionType === "off" || (source === "weekly_schedule" && Number(resolvedShift?.active) !== 1)
    ? "مغلق اليوم"
    : source === "none" || !source
      ? "لا يوجد شفت Core"
      : "مطبق";
  const nextException = exceptions
    .filter(isOperationalScheduleException)
    .filter((exception) => cleanText(exception.dateFrom || (exception as Record<string, unknown>).date_from) >= todayKey())
    .sort((left, right) => cleanText(left.dateFrom || (left as Record<string, unknown>).date_from).localeCompare(cleanText(right.dateFrom || (right as Record<string, unknown>).date_from)))[0] || null;
  const activeOrUpcomingAssignments = assignments.filter((assignment) => {
    const label = assignmentStatus(assignment);
    return label === "نشط" || label === "مجدول";
  });
  const cancelledAssignments = assignments.filter((assignment) => assignmentStatus(assignment) === "ملغي");
  const archivedAssignments = assignments.filter((assignment) => !activeOrUpcomingAssignments.includes(assignment) && assignmentStatus(assignment) !== "ملغي");
  const renderAssignmentRow = (assignment: CoreShiftAssignment) => {
    const label = assignmentStatus(assignment);
    const isCancelled = label === "ملغي";
    return [
      <strong key="name">{assignmentShiftName(assignment, templates) || assignment.shiftTemplateId || "شفت"}</strong>,
      formatWindow(assignmentShiftRecord(assignment, templates)),
      `${assignment.effectiveFrom} - ${assignment.effectiveTo || "مفتوح"}`,
      <WorkspaceStatusBadgeV2 key="status" tone={assignmentTone(assignment)}>{label}</WorkspaceStatusBadgeV2>,
      <div key="actions" className="dsv2-cluster">
        <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => editAssignment(assignment)} disabled={!canManage || saving || isCancelled}>تعديل هذا التعيين</button>
        <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void closeAssignment(assignment)} disabled={!canManage || saving || label !== "نشط"}>إنهاء اليوم</button>
        <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void cancelAssignment(assignment)} disabled={!canManage || saving || isCancelled}>إلغاء</button>
      </div>,
    ];
  };

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-live-shifts">
      <WorkspaceTabHeaderV2
        title="قوالب الشفتات والاستثناءات"
        description="أنشئ القوالب وسياسات الحضور هنا، ثم وزّعها على أيام الأسبوع من جدول الدوام الموجود في نفس الصفحة."
        badge={
          <div className="dsv2-cluster">
            <WorkspaceStatusBadgeV2 tone={canManage ? "success" : "gold"}>{canManage ? "قابل للتعديل" : "عرض فقط"}</WorkspaceStatusBadgeV2>
            <WorkspaceHelpButtonV2 label="شرح قوالب الشفتات والاستثناءات" onClick={() => setHelpTopic(SHIFT_CONTROL_HELP_TOPICS.overview)} />
          </div>
        }
      />

      {error ? <WorkspaceNoticeV2 title="تعذر تنفيذ العملية" description={error} tone="danger" /> : null}
      {message ? <WorkspaceNoticeV2 title="تم التحديث" description={message} tone="success" /> : null}

      <WorkspaceCardV2
        title="الشفت المطبق الآن"
        description="هذه هي المعلومة الأساسية: الشفت الذي سيُستخدم في الحضور والراتب لهذا اليوم."
        actions={
          <>
            <WorkspaceHelpButtonV2 label="شرح الشفت المطبق الآن" onClick={() => setHelpTopic(SHIFT_CONTROL_HELP_TOPICS.appliedShift)} />
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => void load()} disabled={loading || saving}>تحديث</button>
          </>
        }
      >
        <div className="dsv2-filter-bar">
          <DashboardFieldV2 id="shift-resolved-date" label="تاريخ الفحص">
            <DashboardDatePickerV2 id="shift-resolved-date" value={resolvedDate} onChange={setResolvedDate} disabled={loading || saving} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="shift-resolved-employee" label="الموظفة">
            <input id="shift-resolved-employee" className="dsv2-input" value={employeeName || employeeId} readOnly />
          </DashboardFieldV2>
        </div>
        <div className="dsv2-grid dsv2-grid--metrics">
          <WorkspaceMetricV2
            label="الشفت"
            value={resolvedShiftName || (source === "assignment" ? openAssignmentName : "") || (resolvedStatus === "مغلق اليوم" ? "راحة أسبوعية" : "لا يوجد")}
            note={source === "assignment" && openAssignment ? `${openAssignment.effectiveFrom} - ${openAssignment.effectiveTo || "مفتوح"}` : resolvedStatus}
            tone={source === "exception" ? "gold" : source === "weekly_schedule" || source === "assignment" ? "success" : "neutral"}
          />
          <WorkspaceMetricV2 label="الوقت" value={source === "assignment" && openAssignment ? openAssignmentWindow : formatWindow(resolvedShift)} note="وقت الدوام الفعلي" tone="dark" />
          <WorkspaceMetricV2 label="المصدر" value={resolvedLabel} note={source === "exception" ? exceptionTypeLabel(resolvedExceptionType) : "الاستثناء ثم جدول الأسبوع ثم الشفت الافتراضي"} tone={source === "exception" ? "gold" : source === "weekly_schedule" || source === "assignment" ? "success" : "neutral"} />
          <WorkspaceMetricV2
            label="مرونة الحضور"
            value={`${readNumber(resolvedShift?.lateGraceMinutes ?? resolvedShift?.late_grace_minutes)} دقيقة`}
            note="تسمح بالحضور المتأخر، لكن الدقائق غير المعوضة تُحسب"
            tone="gold"
          />
          <WorkspaceMetricV2
            label="إغلاق البصمة"
            value={boolish(resolvedShift?.attendanceLockEnabled ?? resolvedShift?.attendance_lock_enabled)
              ? `بعد ${readNumber(resolvedShift?.attendanceLockAfterMinutes ?? resolvedShift?.attendance_lock_after_minutes)} دقيقة`
              : "غير مفعّل"}
            note="إغلاق بصمة الحضور فقط؛ الانصراف يبقى متاحًا"
            tone={boolish(resolvedShift?.attendanceLockEnabled ?? resolvedShift?.attendance_lock_enabled) ? "danger" : "neutral"}
          />
        </div>
      </WorkspaceCardV2>

      <details className="dsv2-details-block">
        <summary>التعيينات القديمة والاحتياطية</summary>
        <WorkspaceNoticeV2
          title="للتوافق مع البيانات القديمة فقط"
          description="المصدر الأساسي الآن هو جدول الدوام الأسبوعي. استخدم التعيين الاحتياطي فقط لموظفة قديمة لا يوجد لها جدول أسبوعي، واستخدم الاستثناء لتغيير يوم أو فترة محددة."
          tone="gold"
        />
        <div ref={assignmentEditorRef}>
        <WorkspaceCardV2
          title={assignmentForm.id ? "تعديل تعيين احتياطي" : "تعيين شفت احتياطي"}
          description={assignmentForm.id ? "تعديل تعيين قديم موجود." : "لا يُستخدم عند وجود جدول دوام أسبوعي للموظفة."}
          actions={<WorkspaceHelpButtonV2 label="شرح تعيين الشفت الاحتياطي" onClick={() => setHelpTopic(SHIFT_CONTROL_HELP_TOPICS.fallbackAssignment)} />}
        >
          {assignmentForm.id ? (
            <WorkspaceNoticeV2
              title="وضع التعديل نشط"
              description="التعديل الآن على التعيين الذي اخترته من جدول تعيينات الموظفة. اضغط حفظ التعديل أو إلغاء التعديل."
              tone="gold"
            />
          ) : null}
          <div className="dsv2-form-grid">
            <DashboardFieldV2 id="shift-assignment-template" label="الشفت المطلوب" required>
              <DashboardSelectV2 id="shift-assignment-template" options={templateOptions} value={assignmentForm.shiftTemplateId} onChange={(value) => setAssignmentForm((current) => ({ ...current, shiftTemplateId: value }))} disabled={!canManage || saving || !templateOptions.length} placeholder="اختر الشفت" />
            </DashboardFieldV2>
            <DashboardFieldV2 id="shift-assignment-from" label="يبدأ من" required>
              <DashboardDatePickerV2 id="shift-assignment-from" value={assignmentForm.effectiveFrom} onChange={(value) => setAssignmentForm((current) => ({ ...current, effectiveFrom: value }))} disabled={!canManage || saving} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="shift-assignment-type" label="المدة">
              <DashboardSelectV2
                id="shift-assignment-type"
                options={[{ value: "permanent", label: "دائم / مفتوح" }, { value: "temporary", label: "مؤقت / له نهاية" }]}
                value={assignmentForm.assignmentType}
                onChange={(value) => setAssignmentForm((current) => ({
                  ...current,
                  assignmentType: value === "temporary" ? "temporary" : "permanent",
                  effectiveTo: value === "temporary" ? current.effectiveTo : "",
                }))}
                disabled={!canManage || saving}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="shift-assignment-to" label="ينتهي في">
              <DashboardDatePickerV2
                id="shift-assignment-to"
                value={assignmentForm.assignmentType === "permanent" ? "" : assignmentForm.effectiveTo}
                onChange={(value) => setAssignmentForm((current) => ({ ...current, effectiveTo: value, assignmentType: value ? "temporary" : current.assignmentType }))}
                disabled={!canManage || saving || assignmentForm.assignmentType === "permanent"}
                clearable
              />
            </DashboardFieldV2>
          </div>
          {assignmentForm.assignmentType === "permanent" ? (
            <WorkspaceNoticeV2
              title="تعيين مفتوح"
              description="عند اختيار دائم يتم تجاهل تاريخ النهاية وحفظ التعيين كمفتوح. إذا تحتاج نهاية محددة اختر مؤقت."
              tone="gold"
            />
          ) : null}
          <DashboardFieldV2 id="shift-assignment-reason" label="سبب التغيير" required>
            <input id="shift-assignment-reason" className="dsv2-input" value={assignmentForm.reason} onChange={(event) => setAssignmentForm((current) => ({ ...current, reason: event.target.value }))} disabled={!canManage || saving} />
          </DashboardFieldV2>
          {preview ? (
            <WorkspaceNoticeV2
              title="تأثير الحفظ المتوقع"
              description={shiftPreviewDescription(preview)}
              tone={readNumber(preview.lockedPeriodsCount ?? preview.locked_periods_count) ? "danger" : "success"}
            />
          ) : null}
          <div className="dsv2-cluster">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => void previewAssignment()} disabled={!canManage || saving || !assignmentForm.shiftTemplateId}>فحص قبل الحفظ</button>
            {assignmentForm.id ? <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={startNewAssignment} disabled={saving}>إلغاء التعديل</button> : null}
            <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void saveAssignment()} disabled={!canManage || saving || !templateOptions.length}>{assignmentForm.id ? "حفظ تعديل الشفت" : "تعيين الشفت"}</button>
          </div>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2
        title="تعيينات الموظفة"
        description="يعرض الحالي والقادم فقط. السجل القديم موجود أسفل الجدول لتقليل التشويش."
        actions={<WorkspaceHelpButtonV2 label="شرح تعيينات الموظفة" onClick={() => setHelpTopic(SHIFT_CONTROL_HELP_TOPICS.employeeAssignments)} />}
      >
        <WorkspaceTableV2
          headers={["الشفت", "الوقت", "الفترة", "الحالة", "الإجراء"]}
          rows={activeOrUpcomingAssignments.map(renderAssignmentRow)}
          emptyText="لا يوجد شفت نشط أو قادم لهذه الموظفة."
        />
        {archivedAssignments.length ? (
          <details className="dsv2-details-block">
            <summary>عرض السجل التاريخي والمنتهي ({archivedAssignments.length})</summary>
            <WorkspaceTableV2
              headers={["الشفت", "الوقت", "الفترة", "الحالة", "الإجراء"]}
              rows={archivedAssignments.map(renderAssignmentRow)}
              emptyText="لا يوجد سجل تاريخي."
            />
          </details>
        ) : null}
        {cancelledAssignments.length ? (
          <details className="dsv2-details-block">
            <summary>عرض التعيينات الملغية ({cancelledAssignments.length})</summary>
            <WorkspaceTableV2
              headers={["الشفت", "الوقت", "الفترة", "الحالة", "الإجراء"]}
              rows={cancelledAssignments.map(renderAssignmentRow)}
              emptyText="لا توجد تعيينات ملغية."
            />
          </details>
        ) : null}
      </WorkspaceCardV2>
      </details>

      <details className="dsv2-details-block" open>
        <summary>إدارة قوالب الشفتات والاستثناءات</summary>
        <div className="dsv2-grid dsv2-grid--two">
          <WorkspaceCardV2
            title={templateForm.id ? "تعديل قالب شفت" : "إنشاء قالب شفت"}
            description="القالب عام ويؤثر على أي موظفة تستخدمه. لا تعدله إلا إذا تريد تغيير القالب نفسه للجميع."
            actions={<WorkspaceHelpButtonV2 label="شرح إنشاء قالب الشفت" onClick={() => setHelpTopic(SHIFT_CONTROL_HELP_TOPICS.shiftTemplate)} />}
          >
            <WorkspaceNoticeV2
              title="تنبيه"
              description="لتغيير شفت يوم أسبوعي استخدم جدول الدوام أعلى هذه الصفحة. لتغيير يوم أو فترة محددة استخدم الاستثناء؛ تعديل القالب يغيّر السياسة العامة لكل من يستخدمه."
              tone="gold"
            />
            <div className="dsv2-form-grid">
              <DashboardFieldV2 id="shift-template-name" label="اسم الشفت" required>
                <input id="shift-template-name" className="dsv2-input" value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} disabled={!canManage || saving} placeholder="الشفت الصباحي" />
              </DashboardFieldV2>
              <DashboardFieldV2 id="shift-template-code" label="الكود">
                <input id="shift-template-code" className="dsv2-input" value={templateForm.code} onChange={(event) => setTemplateForm((current) => ({ ...current, code: event.target.value }))} disabled={!canManage || saving} placeholder="AM" />
              </DashboardFieldV2>
              <DashboardFieldV2 id="shift-template-start" label="البداية">
                <DashboardTimeInputV2 id="shift-template-start" className="dsv2-input" value={templateForm.startTime} onChange={(event) => setTemplateForm((current) => ({ ...current, startTime: event.target.value }))} disabled={!canManage || saving} />
              </DashboardFieldV2>
              <DashboardFieldV2 id="shift-template-end" label="النهاية">
                <DashboardTimeInputV2 id="shift-template-end" className="dsv2-input" value={templateForm.endTime} onChange={(event) => setTemplateForm((current) => ({ ...current, endTime: event.target.value }))} disabled={!canManage || saving} />
              </DashboardFieldV2>
              <DashboardFieldV2 id="shift-template-late" label="فترة سماح التأخير">
                <DashboardNumberInputV2 id="shift-template-late" className="dsv2-input" min="0" max="240" value={templateForm.lateGraceMinutes} onChange={(event) => setTemplateForm((current) => ({ ...current, lateGraceMinutes: event.target.value }))} disabled={!canManage || saving} />
              </DashboardFieldV2>
              <DashboardFieldV2 id="shift-template-lock-after" label="إغلاق بصمة الحضور بعد">
                <DashboardNumberInputV2 id="shift-template-lock-after" className="dsv2-input" min={Number(templateForm.lateGraceMinutes || 0)} max="1440" value={templateForm.attendanceLockAfterMinutes} onChange={(event) => setTemplateForm((current) => ({ ...current, attendanceLockAfterMinutes: event.target.value }))} disabled={!canManage || saving || !templateForm.attendanceLockEnabled} />
              </DashboardFieldV2>
            </div>
            <WorkspaceNoticeV2
              title="لا يوجد سماح خروج مبكر"
              description="الخروج قبل نهاية الشفت يُحسب من أول دقيقة. سماح التأخير مرونة للحضور فقط، ويجب تعويض التأخير عند الانصراف."
              tone="neutral"
            />
            <WorkspaceSwitchV2
              checked={templateForm.attendanceLockEnabled}
              onChange={(value) => setTemplateForm((current) => ({ ...current, attendanceLockEnabled: value }))}
              disabled={!canManage || saving}
              label="إغلاق بصمة الحضور المتأخرة"
              description="عند تجاوز المدة المحددة تُقفل بصمة الحضور وتُسجل الموظفة غائبة تلقائيًا، بينما يبقى تسجيل الانصراف متاحًا لمن بصمت حضورًا."
            />
            <WorkspaceSwitchV2 checked={templateForm.active} onChange={(value) => setTemplateForm((current) => ({ ...current, active: value }))} disabled={!canManage || saving} label="القالب نشط" />
            <div className="dsv2-cluster">
              <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setTemplateForm(emptyTemplateForm())} disabled={saving}>تفريغ</button>
              <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void saveTemplate()} disabled={!canManage || saving}>حفظ القالب</button>
            </div>
          </WorkspaceCardV2>

          <WorkspaceCardV2
            title="استثناء شفت"
            description="استخدمه لراحة يوم، شفت بديل، أو وقت مخصص لفترة محددة."
            actions={<WorkspaceHelpButtonV2 label="شرح استثناء الشفت" onClick={() => setHelpTopic(SHIFT_CONTROL_HELP_TOPICS.shiftException)} />}
          >
            <div className="dsv2-form-grid">
              <DashboardFieldV2 id="shift-exception-type" label="نوع الاستثناء">
                <DashboardSelectV2
                  id="shift-exception-type"
                  options={[{ value: "shift", label: "شفت بديل" }, { value: "custom", label: "وقت مخصص" }, { value: "off", label: "راحة" }]}
                  value={exceptionForm.exceptionType}
                  onChange={(value) => setExceptionForm((current) => ({ ...current, exceptionType: value === "custom" ? "custom" : value === "off" ? "off" : "shift" }))}
                  disabled={!canManage || saving}
                />
              </DashboardFieldV2>
              <DashboardFieldV2 id="shift-exception-template" label="الشفت البديل">
                <DashboardSelectV2 id="shift-exception-template" options={templateOptions} value={exceptionForm.shiftTemplateId} onChange={(value) => setExceptionForm((current) => ({ ...current, shiftTemplateId: value }))} disabled={!canManage || saving || exceptionForm.exceptionType !== "shift" || !templateOptions.length} placeholder="اختر الشفت" />
              </DashboardFieldV2>
              <DashboardFieldV2 id="shift-exception-from" label="من تاريخ" required>
                <DashboardDatePickerV2 id="shift-exception-from" value={exceptionForm.dateFrom} onChange={(value) => setExceptionForm((current) => ({ ...current, dateFrom: value, dateTo: current.dateTo || value }))} disabled={!canManage || saving} />
              </DashboardFieldV2>
              <DashboardFieldV2 id="shift-exception-to" label="إلى تاريخ" required>
                <DashboardDatePickerV2 id="shift-exception-to" value={exceptionForm.dateTo} onChange={(value) => setExceptionForm((current) => ({ ...current, dateTo: value }))} disabled={!canManage || saving} />
              </DashboardFieldV2>
              <DashboardFieldV2 id="shift-exception-start" label="بداية مخصصة">
                <DashboardTimeInputV2 id="shift-exception-start" className="dsv2-input" value={exceptionForm.startTime} onChange={(event) => setExceptionForm((current) => ({ ...current, startTime: event.target.value }))} disabled={!canManage || saving || exceptionForm.exceptionType !== "custom"} />
              </DashboardFieldV2>
              <DashboardFieldV2 id="shift-exception-end" label="نهاية مخصصة">
                <DashboardTimeInputV2 id="shift-exception-end" className="dsv2-input" value={exceptionForm.endTime} onChange={(event) => setExceptionForm((current) => ({ ...current, endTime: event.target.value }))} disabled={!canManage || saving || exceptionForm.exceptionType !== "custom"} />
              </DashboardFieldV2>
            </div>
            <DashboardFieldV2 id="shift-exception-note" label="ملاحظة">
              <input id="shift-exception-note" className="dsv2-input" value={exceptionForm.note} onChange={(event) => setExceptionForm((current) => ({ ...current, note: event.target.value }))} disabled={!canManage || saving} />
            </DashboardFieldV2>
            <div className="dsv2-cluster">
              <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => void previewException()} disabled={!canManage || saving}>فحص الاستثناء</button>
              <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void createException()} disabled={!canManage || saving}>حفظ الاستثناء</button>
            </div>
          </WorkspaceCardV2>
        </div>

        <div className="dsv2-grid dsv2-grid--two">
          <WorkspaceCardV2
            title="قوالب الشفتات"
            description="القوالب الفعلية المحملة من Core."
            actions={<WorkspaceHelpButtonV2 label="شرح قائمة قوالب الشفتات" onClick={() => setHelpTopic(SHIFT_CONTROL_HELP_TOPICS.templatesList)} />}
          >
            <WorkspaceTableV2
              headers={["القالب", "الوقت", "مرونة الحضور", "إغلاق البصمة", "الحالة", "الإجراء"]}
              rows={templates.map((template) => [
                <strong key="name">{template.name}</strong>,
                formatWindow(template),
                `${readNumber(template.lateGraceMinutes)} دقيقة`,
                boolish(template.attendanceLockEnabled) ? `بعد ${readNumber(template.attendanceLockAfterMinutes)} دقيقة` : "غير مفعّل",
                <WorkspaceStatusBadgeV2 key="status" tone={boolish(template.active) ? "success" : "danger"}>{boolish(template.active) ? "نشط" : "متوقف"}</WorkspaceStatusBadgeV2>,
                <button key="edit" type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => editTemplate(template)} disabled={!canManage || saving}>تعديل القالب</button>,
              ])}
              emptyText="لا توجد قوالب شفتات."
            />
          </WorkspaceCardV2>

          <WorkspaceCardV2
            title="استثناءات الموظفة"
            description="الأولوية للاستثناء قبل الشفت الأساسي."
            actions={
              <div className="dsv2-cluster">
                <div className="dsv2-ew-segmented" role="tablist" aria-label="فلتر الاستثناءات">
                  {exceptionFilterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={exceptionFilter === option.value ? "is-active" : ""}
                      onClick={() => setExceptionFilter(option.value)}
                      disabled={loading || saving}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <WorkspaceHelpButtonV2 label="شرح استثناءات الموظفة" onClick={() => setHelpTopic(SHIFT_CONTROL_HELP_TOPICS.exceptionsList)} />
              </div>
            }
          >
            <WorkspaceTableV2
              headers={["النوع", "الفترة", "الوقت", "الحالة", "الإجراء"]}
              rows={visibleExceptions.map((exception) => {
                const action = getScheduleExceptionAction(exception);
                const isCancelled = isCancelledScheduleException(exception);
                const mutedClass = isCancelled && exceptionFilter === "all" ? "dsv2-ew-muted-row" : undefined;
                return [
                  <strong key="type" className={mutedClass}>{exceptionTypeLabel(exception.exceptionType)}</strong>,
                  <span key="range" className={mutedClass}>{exception.dateFrom} - {exception.dateTo}</span>,
                  <span key="window" className={mutedClass}>{exception.exceptionType === "off" ? "راحة" : formatWindow(exception)}</span>,
                  <WorkspaceStatusBadgeV2 key="status" tone={isCancelled ? "danger" : "success"}>{statusLabel(exception.status)}</WorkspaceStatusBadgeV2>,
                  action.kind === "restore"
                    ? <button key="restore" type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void restoreException(exception)} disabled={!canManage || saving}>{action.label}</button>
                    : <button key="cancel" type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void cancelException(exception)} disabled={!canManage || saving}>{action.label}</button>,
                ];
              })}
              emptyText="لا توجد استثناءات شفت لهذه الموظفة."
            />
          </WorkspaceCardV2>
        </div>
      </details>

      <WorkspaceHelpDrawerV2
        open={Boolean(helpTopic)}
        topic={helpTopic}
        onClose={() => setHelpTopic(null)}
      />
    </div>
  );
}
