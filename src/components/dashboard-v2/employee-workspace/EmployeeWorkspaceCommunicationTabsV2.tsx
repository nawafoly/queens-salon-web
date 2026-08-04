import { useState } from "react";
import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
} from "../index";
import type { EmployeeWorkspaceTabProps } from "./types";
import {
  WorkspaceCardV2,
  WorkspaceChoicePillsV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStateShowcaseV2,
  WorkspaceStatusBadgeV2,
  WorkspaceTableV2,
  WorkspaceTabHeaderV2,
} from "./EmployeeWorkspacePrimitivesV2";

export function MessagesTabV2({ readOnly, markDirty, requestConfirm }: EmployeeWorkspaceTabProps) {
  const [message, setMessage] = useState("");
  const [viewState, setViewState] = useState("ready");
  const [failed, setFailed] = useState(false);

  const send = () => {
    if (!message.trim() || readOnly) return;
    setMessage("");
    setFailed(false);
    markDirty();
  };

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2 title="الرسائل" description="محادثة داخلية كاملة بحالة الموظفة والقراءة والمرفقات وإعادة محاولة الإرسال." badge={<WorkspaceStatusBadgeV2 tone="gold">رسالتان غير مقروءتين</WorkspaceStatusBadgeV2>} />

      <WorkspaceCardV2 title="حالة المحادثة" description="تبديل حالات النموذج دون مغادرة Design System.">
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2 id="dsv2-ew-message-state" label="حالة العرض">
            <DashboardSelectV2 id="dsv2-ew-message-state" value={viewState} options={[{ value: "ready", label: "محادثة موجودة" }, { value: "empty", label: "لا توجد رسائل" }, { value: "loading", label: "تحميل" }]} onChange={setViewState} />
          </DashboardFieldV2>
          <div className="dsv2-ew-conversation-status">
            <span className="dsv2-ew-presence" aria-hidden="true" />
            <div><strong>وسام عداوي</strong><small>نشطة الآن · آخر قراءة 11:32 ص</small></div>
          </div>
        </div>
      </WorkspaceCardV2>

      {viewState === "ready" ? (
        <WorkspaceCardV2 title="المحادثة الداخلية" description="الرسائل محفوظة ضمن ملف الموظفة وسجل الإدارة." className="dsv2-ew-chat-card">
          <div className="dsv2-ew-chat-head">
            <div className="dsv2-ew-chat-avatar">و</div>
            <div><strong>وسام عداوي</strong><span>أخصائية شعر · الحساب نشط</span></div>
            <WorkspaceStatusBadgeV2 tone="success">متصلة</WorkspaceStatusBadgeV2>
          </div>
          <div className="dsv2-ew-messages" aria-live="polite">
            <div className="dsv2-ew-message dsv2-ew-message--admin">
              <span className="dsv2-ew-message__sender">الإدارة</span>
              <p>تم اعتماد جدولك الجديد ابتداءً من يوم السبت. راجعي تفاصيل الشفت من ملفك.</p>
              <small>10:14 ص · مقروءة ✓✓</small>
            </div>
            <div className="dsv2-ew-message dsv2-ew-message--employee">
              <span className="dsv2-ew-message__sender">وسام</span>
              <p>تم، شكرًا. هل يشمل التعديل يوم الخميس أيضًا؟</p>
              <small>10:22 ص · مقروءة</small>
            </div>
            <div className="dsv2-ew-message dsv2-ew-message--admin">
              <span className="dsv2-ew-message__sender">الإدارة</span>
              <p>نعم، الخميس سيكون من 02:00 م إلى 10:00 م خلال شهر أغسطس.</p>
              <small>10:28 ص · مقروءة ✓✓</small>
            </div>
            <div className="dsv2-ew-message dsv2-ew-message--employee" data-unread="true">
              <span className="dsv2-ew-message__sender">وسام</span>
              <p>ممتاز، أرسلت كذلك طلب استئذان ليوم 14 أغسطس.</p>
              <small>11:31 ص · غير مقروءة</small>
            </div>
            {failed ? (
              <div className="dsv2-ew-message dsv2-ew-message--failed">
                <p>تعذر إرسال الرسالة التجريبية.</p>
                <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => setFailed(false)}>إعادة المحاولة</button>
              </div>
            ) : null}
          </div>
          <div className="dsv2-ew-composer">
            <DashboardFieldV2 id="dsv2-ew-message-input" label="كتابة رسالة">
              <textarea id="dsv2-ew-message-input" className="dsv2-textarea" value={message} placeholder="اكتب رسالة داخلية للموظفة..." disabled={readOnly} onChange={(event) => setMessage(event.target.value)} />
            </DashboardFieldV2>
            <div className="dsv2-ew-composer__actions">
              <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={readOnly}>إرفاق ملف</button>
              <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={readOnly || !message.trim()} onClick={send}>إرسال</button>
              <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnly} onClick={() => setFailed(true)}>محاكاة فشل الإرسال</button>
            </div>
          </div>
        </WorkspaceCardV2>
      ) : viewState === "empty" ? (
        <div className="dsv2-ew-inline-empty dsv2-ew-inline-empty--large"><strong>لا توجد رسائل بعد</strong><span>ابدأ محادثة داخلية لتظهر هنا مع حالة القراءة والوقت.</span><button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" disabled={readOnly}>بدء محادثة</button></div>
      ) : <WorkspaceStateShowcaseV2 />}

      <WorkspaceCardV2 title="إدارة المحادثة" description="إجراءات السجل والحالة غير المقروءة.">
        <div className="dsv2-ew-action-list dsv2-ew-action-list--horizontal">
          <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={readOnly}>تعليم الكل كمقروء</button>
          <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={readOnly}>تنزيل سجل المحادثة</button>
          <button type="button" className="dsv2-btn dsv2-btn--danger" disabled={readOnly} onClick={() => requestConfirm({ title: "إغلاق المحادثة؟", description: "سيبقى السجل محفوظًا، لكن لن يمكن إرسال رسائل جديدة حتى إعادة الفتح.", confirmLabel: "إغلاق المحادثة", tone: "danger" })}>إغلاق المحادثة</button>
        </div>
      </WorkspaceCardV2>
    </div>
  );
}

export function FilesTabV2({ readOnly, markDirty, openDialog, requestConfirm }: EmployeeWorkspaceTabProps) {
  const [category, setCategory] = useState("all");
  const [viewState, setViewState] = useState("ready");
  const [dragging, setDragging] = useState(false);

  const files = [
    { name: "الهوية الوطنية", type: "هوية", uploaded: "15 مايو 2025", expires: "06 يونيو 2030", status: "ساري", tone: "success" as const },
    { name: "عقد العمل", type: "عقود", uploaded: "15 مايو 2025", expires: "14 مايو 2027", status: "ساري", tone: "success" as const },
    { name: "شهادة صحية", type: "شهادات", uploaded: "02 يناير 2026", expires: "15 سبتمبر 2026", status: "قريب الانتهاء", tone: "gold" as const },
    { name: "شهادة مهنية", type: "شهادات", uploaded: "20 مارس 2024", expires: "20 مارس 2026", status: "منتهي", tone: "danger" as const },
  ].filter((file) => category === "all" || file.type === category);

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2 title="الملفات" description="تصنيف ورفع وسحب وإفلات ومعاينة وتنزيل واستبدال وحذف، مع حالات الصلاحية والفراغ والخطأ." badge={<WorkspaceStatusBadgeV2 tone="gold">ملف قريب الانتهاء</WorkspaceStatusBadgeV2>} />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="إجمالي الملفات" value="4" />
        <WorkspaceMetricV2 label="السارية" value="2" tone="success" />
        <WorkspaceMetricV2 label="قريب الانتهاء" value="1" tone="gold" />
        <WorkspaceMetricV2 label="المنتهية" value="1" tone="danger" />
      </div>

      <div className="dsv2-ew-files-layout">
        <WorkspaceCardV2 title="تصنيفات المستندات" description="تصفية القائمة حسب النوع." className="dsv2-ew-file-categories">
          <nav className="dsv2-ew-category-list" aria-label="تصنيفات الملفات">
            {[
              ["all", "كل المستندات", "4"],
              ["هوية", "الهوية", "1"],
              ["عقود", "العقود", "1"],
              ["شهادات", "الشهادات", "2"],
              ["أخرى", "أخرى", "0"],
            ].map(([value, label, count]) => (
              <button key={value} type="button" data-active={category === value ? "true" : "false"} onClick={() => setCategory(value)}><span>{label}</span><strong>{count}</strong></button>
            ))}
          </nav>
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="رفع ملف" description="السحب والإفلات أو اختيار ملف من الجهاز." className="dsv2-ew-file-uploader">
          <button
            type="button"
            className="dsv2-ew-dropzone"
            data-dragging={dragging ? "true" : "false"}
            disabled={readOnly}
            onDragEnter={() => setDragging(true)}
            onDragLeave={() => setDragging(false)}
            onDrop={() => { setDragging(false); markDirty(); }}
            onClick={() => openDialog("file")}
          >
            <span className="dsv2-ew-dropzone__icon">↑</span>
            <strong>{dragging ? "أفلِت الملف هنا" : "اسحب الملف وأفلته هنا"}</strong>
            <small>أو اضغط لاختيار ملف — حتى 10 ميجابايت</small>
          </button>
          <button type="button" className="dsv2-btn dsv2-btn--accent" disabled={readOnly} onClick={() => openDialog("file")}>رفع مستند جديد</button>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2 title="قائمة المستندات" description="حقول انتهاء وملاحظات وإجراءات كاملة لكل مستند.">
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2 id="dsv2-ew-file-category" label="التصنيف">
            <DashboardSelectV2 id="dsv2-ew-file-category" value={category} options={[{ value: "all", label: "كل المستندات" }, { value: "هوية", label: "الهوية" }, { value: "عقود", label: "العقود" }, { value: "شهادات", label: "الشهادات" }, { value: "أخرى", label: "أخرى" }]} onChange={setCategory} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-files-state" label="حالة النموذج">
            <DashboardSelectV2 id="dsv2-ew-files-state" value={viewState} options={[{ value: "ready", label: "بيانات جاهزة" }, { value: "loading", label: "تحميل" }, { value: "empty", label: "بدون ملفات" }, { value: "error", label: "خطأ" }]} onChange={setViewState} />
          </DashboardFieldV2>
        </div>

        {viewState === "ready" ? (
          <WorkspaceTableV2
            headers={["اسم المستند", "النوع", "تاريخ الرفع", "تاريخ الانتهاء", "الملاحظات", "الحالة", "الإجراءات"]}
            rows={files.map((file) => [
              <strong>{file.name}</strong>, file.type, file.uploaded, file.expires, file.status === "قريب الانتهاء" ? "يحتاج تجديد خلال 42 يومًا" : "—", <WorkspaceStatusBadgeV2 tone={file.tone}>{file.status}</WorkspaceStatusBadgeV2>,
              <div className="dsv2-ew-file-actions">
                <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm">معاينة</button>
                <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm">تنزيل</button>
                <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly} onClick={() => openDialog("file")}>استبدال</button>
                <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnly} onClick={() => requestConfirm({ title: `حذف ${file.name}؟`, description: "سيُحذف الملف من ملف الموظفة بعد التأكيد، مع تسجيل العملية في سجل التدقيق.", confirmLabel: "حذف الملف", tone: "danger", onConfirm: markDirty })}>حذف</button>
              </div>,
            ])}
            emptyText="لا توجد مستندات في هذا التصنيف."
          />
        ) : viewState === "loading" ? <WorkspaceStateShowcaseV2 /> : viewState === "empty" ? <div className="dsv2-ew-inline-empty dsv2-ew-inline-empty--large"><strong>لا توجد ملفات</strong><span>ارفع أول مستند للموظفة ليظهر هنا.</span></div> : <WorkspaceNoticeV2 title="تعذر تحميل الملفات" description="تعذر الوصول إلى مساحة التخزين. أعد المحاولة دون تغيير الملفات الحالية." tone="danger" action={<button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => setViewState("ready")}>إعادة المحاولة</button>} />}
      </WorkspaceCardV2>

      <WorkspaceCardV2 title="بيانات مستند تجريبي" description="مثال لحقول الاسم والنوع والانتهاء والملاحظات باستخدام مكونات V2.">
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2 id="dsv2-ew-document-name" label="اسم المستند"><input id="dsv2-ew-document-name" className="dsv2-input" defaultValue="شهادة صحية" disabled={readOnly} onChange={markDirty} /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-document-type" label="النوع"><DashboardSelectV2 id="dsv2-ew-document-type" defaultValue="certificate" disabled={readOnly} options={[{ value: "identity", label: "هوية" }, { value: "contract", label: "عقد" }, { value: "certificate", label: "شهادة" }, { value: "other", label: "أخرى" }]} onChange={markDirty} /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-document-expiry" label="تاريخ الانتهاء"><DashboardDatePickerV2 id="dsv2-ew-document-expiry" defaultValue="2026-09-15" disabled={readOnly} onChange={markDirty} /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-document-note" label="الملاحظات"><input id="dsv2-ew-document-note" className="dsv2-input" defaultValue="يلزم التجديد قبل انتهاء الصلاحية" disabled={readOnly} onChange={markDirty} /></DashboardFieldV2>
        </div>
      </WorkspaceCardV2>
    </div>
  );
}
