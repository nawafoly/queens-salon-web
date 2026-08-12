import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, text) {
  fs.writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`[leave-permission-ui] ${label}: expected 1 match, found ${count}`);
  }
  return text.replace(before, after);
}

function patchModal() {
  const path = 'src/components/LeaveRequestModal.tsx';
  let text = read(path);

  text = replaceOnce(
    text,
`      title={isPartialLeave ? "تسجيل استئذان" : "تسجيل إجازة"}
      description={isPartialLeave ? "حدّد فترة الاستئذان؛ هذه الفترة فقط ستُحجب من الحجز." : "حدّد نوع الإجازة وفترتها، ثم راجع أثرها على الرصيد والراتب قبل الاعتماد."}
      eyebrow={isPartialLeave ? "الاستئذانات" : "طلبات الإجازات"}`,
`      title="تسجيل إجازة أو استئذان"
      description={isPartialLeave ? "حدّد فترة الاستئذان؛ هذه الفترة فقط ستُحجب من الحجز." : "اختر إجازة أو استئذان، ثم أدخل البيانات المطلوبة للاعتماد."}
      eyebrow="الحضور والإجازات"`,
    'modal header'
  );

  text = replaceOnce(
    text,
`        <DashboardFieldV2 id="leave-type-v2" label="نوع الإجازة" required>
          <DashboardSelectV2
            id="leave-type-v2"
            value={type}
            options={LEAVE_TYPE_OPTIONS}
            onChange={(value) => {
              setType(value);
              setErrors([]);
            }}
          />
        </DashboardFieldV2>

        <DashboardFieldV2 id="leave-duration-kind-v2" label="نوع التسجيل" required>
          <DashboardSelectV2
            id="leave-duration-kind-v2"
            value={durationKind}
            options={[
              { value: "full_day", label: "يوم كامل" },
              { value: "partial", label: "استئذان" },
            ]}
            onChange={(value) => {
              const next = value === "partial" ? "partial" : "full_day";
              setDurationKind(next);
              if (next === "partial") {
                setToDate(fromDate);
                setDeductFromBalance(false);
                setAffectsPayroll(false);
              }
              setErrors([]);
            }}
          />
        </DashboardFieldV2>`,
`        <DashboardFieldV2 id="leave-duration-kind-v2" label="نوع التسجيل" required>
          <DashboardSelectV2
            id="leave-duration-kind-v2"
            value={durationKind}
            options={[
              { value: "full_day", label: "إجازة" },
              { value: "partial", label: "استئذان" },
            ]}
            onChange={(value) => {
              const next = value === "partial" ? "partial" : "full_day";
              setDurationKind(next);
              if (next === "partial") {
                setToDate(fromDate);
                setDeductFromBalance(false);
                setAffectsPayroll(false);
              }
              setErrors([]);
            }}
          />
        </DashboardFieldV2>

        {!isPartialLeave ? (
          <DashboardFieldV2 id="leave-type-v2" label="نوع الإجازة" required>
            <DashboardSelectV2
              id="leave-type-v2"
              value={type}
              options={LEAVE_TYPE_OPTIONS}
              onChange={(value) => {
                setType(value);
                setErrors([]);
              }}
            />
          </DashboardFieldV2>
        ) : null}`,
    'registration choice first'
  );

  text = replaceOnce(
    text,
`    if (!type) result.push("اختر نوع الإجازة.");`,
`    if (!isPartialLeave && !type) result.push("اختر نوع الإجازة.");`,
    'leave type validation only for leave'
  );
  text = text.replace('الاستئذان يجب أن تكون في يوم واحد.', 'الاستئذان يجب أن يكون في يوم واحد.');
  text = text.replace('حدد وقت بداية صحيح للإجازة الجزئية.', 'حدد وقت بداية صحيح للاستئذان.');
  text = text.replace('حدد وقت نهاية صحيح للإجازة الجزئية.', 'حدد وقت نهاية صحيح للاستئذان.');

  text = replaceOnce(
    text,
`        <section className="leave-request-v2__summary" aria-label="ملخص الإجازة">
          <div className="leave-request-v2__summary-item">
            <span>النوع</span>
            <strong>{selectedTypeLabel}</strong>
          </div>
          <div className="leave-request-v2__summary-item">
            <span>{isPartialLeave ? "الفترة" : "عدد الأيام"}</span>
            <strong>{isPartialLeave ? \`${'${partialStartTime}'} – ${'${partialEndTime}'}\` : days > 0 ? \`${'${days}'} يوم\` : "—"}</strong>
          </div>
          <div className="leave-request-v2__summary-item">
            <span>الرصيد المتاح</span>
            <strong>{availableBalance == null ? "غير محدد" : \`${'${availableBalance}'} يوم\`}</strong>
          </div>
        </section>`,
`        <section className="leave-request-v2__summary" aria-label="ملخص التسجيل">
          <div className="leave-request-v2__summary-item">
            <span>التسجيل</span>
            <strong>{isPartialLeave ? "استئذان" : "إجازة"}</strong>
          </div>
          <div className="leave-request-v2__summary-item">
            <span>{isPartialLeave ? "التاريخ" : "نوع الإجازة"}</span>
            <strong>{isPartialLeave ? fromDate || "—" : selectedTypeLabel}</strong>
          </div>
          <div className="leave-request-v2__summary-item">
            <span>{isPartialLeave ? "الفترة" : "عدد الأيام"}</span>
            <strong>{isPartialLeave ? \`${'${partialStartTime}'} – ${'${partialEndTime}'}\` : days > 0 ? \`${'${days}'} يوم\` : "—"}</strong>
          </div>
          {!isPartialLeave ? (
            <div className="leave-request-v2__summary-item">
              <span>الرصيد المتاح</span>
              <strong>{availableBalance == null ? "غير محدد" : \`${'${availableBalance}'} يوم\`}</strong>
            </div>
          ) : null}
        </section>`,
    'summary semantics'
  );

  text = replaceOnce(
    text,
`              <h3 id="leave-policy-title-v2">سياسة الاحتساب</h3>`,
`              <h3 id="leave-policy-title-v2">{isPartialLeave ? "أثر الاستئذان" : "سياسة الاحتساب"}</h3>`,
    'policy heading'
  );

  text = replaceOnce(
    text,
`            <span className={\`dsv2-badge ${'${affectsPayroll ? "dsv2-badge--danger" : "dsv2-badge--success"}'}\`}>
              {affectsPayroll ? "تؤثر على الراتب" : "لا تؤثر على الراتب"}
            </span>`,
`            <span className={\`dsv2-badge ${'${affectsPayroll ? "dsv2-badge--danger" : "dsv2-badge--success"}'}\`}>
              {isPartialLeave ? "لا خصم — حجب وقتي" : affectsPayroll ? "تؤثر على الراتب" : "لا تؤثر على الراتب"}
            </span>`,
    'permission impact badge'
  );

  text = replaceOnce(
    text,
`          <div className="dsv2-ew-switch-list leave-request-v2__switch-list">
            <WorkspaceSwitchV2
              checked={deductFromBalance}
              onChange={setDeductFromBalance}
              disabled={isPartialLeave || !isOtherLeaveType}
              label="خصم من رصيد الإجازات"
              description={
                deductFromBalance
                  ? "سيتم خصم عدد الأيام من رصيد الموظفة عند الاعتماد."
                  : "لن يتم خصم هذه المدة من رصيد الإجازات."
              }
            />
            <WorkspaceSwitchV2
              checked={affectsPayroll}
              onChange={setAffectsPayroll}
              disabled={isPartialLeave || !isOtherLeaveType}
              label="تؤثر على الراتب"
              description={
                affectsPayroll
                  ? "ستدخل هذه الأيام ضمن الخصم في دورة الرواتب."
                  : "ستُستبعد هذه الأيام من الغياب والخصم في الراتب."
              }
            />
          </div>`,
`          {!isPartialLeave ? (
            <div className="dsv2-ew-switch-list leave-request-v2__switch-list">
              <WorkspaceSwitchV2
                checked={deductFromBalance}
                onChange={setDeductFromBalance}
                disabled={!isOtherLeaveType}
                label="خصم من رصيد الإجازات"
                description={
                  deductFromBalance
                    ? "سيتم خصم عدد الأيام من رصيد الموظفة عند الاعتماد."
                    : "لن يتم خصم هذه المدة من رصيد الإجازات."
                }
              />
              <WorkspaceSwitchV2
                checked={affectsPayroll}
                onChange={setAffectsPayroll}
                disabled={!isOtherLeaveType}
                label="تؤثر على الراتب"
                description={
                  affectsPayroll
                    ? "ستدخل هذه الأيام ضمن الخصم في دورة الرواتب."
                    : "ستُستبعد هذه الأيام من الغياب والخصم في الراتب."
                }
              />
            </div>
          ) : null}`,
    'hide leave switches for permission'
  );

  text = replaceOnce(
    text,
`          label="ملاحظة"
          hint="اختياري — تظهر الملاحظة في سجل الإجازة والمراجعة."`,
`          label={isPartialLeave ? "سبب الاستئذان" : "ملاحظة"}
          hint={isPartialLeave ? "اختياري — يظهر السبب في سجل الاستئذان." : "اختياري — تظهر الملاحظة في سجل الإجازة والمراجعة."}`,
    'permission note semantics'
  );

  write(path, text);
}

function patchLiveAttendance() {
  const path = 'src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx';
  let text = read(path);
  text = replaceOnce(
    text,
`                      تسجيل إجازة`,
`                      تسجيل إجازة أو استئذان`,
    'attendance action label'
  );
  text = text.replace('استئذان معتمدة — الفترة فقط محجوبة', 'استئذان معتمد — الفترة فقط محجوبة');
  write(path, text);
}

function patchDashboardPermissionCreation() {
  const path = 'src/pages/DashboardEmployees.tsx';
  let text = read(path);

  text = replaceOnce(
    text,
`import { reviewPermissionRequest } from "../services/employeePermissionRequests";`,
`import { createPermissionRequest, reviewPermissionRequest } from "../services/employeePermissionRequests";`,
    'permission service import'
  );

  const anchor = `    if (isPartialLeave) {
      if (fromDate !== toDate) throw new Error("الاستئذان يجب أن تكون في يوم واحد.");
      if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(partialStartTime) || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(partialEndTime)) {
        throw new Error("وقت الاستئذان غير صحيح.");
      }
      if (partialStartTime >= partialEndTime) throw new Error("وقت نهاية الاستئذان يجب أن يكون بعد البداية.");
    }

    setSaving(true);`;

  const replacement = `    if (isPartialLeave) {
      if (fromDate !== toDate) throw new Error("الاستئذان يجب أن يكون في يوم واحد.");
      if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(partialStartTime) || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(partialEndTime)) {
        throw new Error("وقت الاستئذان غير صحيح.");
      }
      if (partialStartTime >= partialEndTime) throw new Error("وقت نهاية الاستئذان يجب أن يكون بعد البداية.");

      setSaving(true);
      setErrorMsg("");
      try {
        const permission = await createPermissionRequest({
          employeeUid: employeeUidLocal,
          employeeId: selectedEmployeeId,
          employeeName,
          date: fromDate,
          startTime: partialStartTime,
          expectedReturnTime: partialEndTime,
          reason: cleanText(payload.note) || "استئذان إداري",
          note: cleanText(payload.note) || undefined,
          source: "admin_direct",
          financialEffect: "none",
          createdByUid: authUser.uid,
          createdByName: authUser.displayName || authUser.email,
        });

        await Promise.all([load(), loadSelectedEmployeeAttendance({ force: true })]);
        window.dispatchEvent(new Event("queens:staff-updated"));
        void writeAuditLog({
          action: "permission_approved",
          entityType: "employee_permission_request",
          entityId: permission.id,
          source: "dashboard",
          description: "تسجيل استئذان معتمد وربطه بالحضور والحجز",
          after: {
            employeeUid: employeeUidLocal,
            employeeId: selectedEmployeeId,
            date: fromDate,
            startTime: partialStartTime,
            endTime: partialEndTime,
            financialEffect: "none",
          },
          meta: {
            staffId: selectedEmployeeId,
            staffName: employeeName,
          },
        });
        return;
      } catch (error) {
        setErrorMsg(toFirestoreErrorMessage(error, "تعذر تسجيل الاستئذان وربطه بالحضور والحجز."));
        throw error;
      } finally {
        setSaving(false);
      }
    }

    setSaving(true);`;

  text = replaceOnce(text, anchor, replacement, 'admin permission creation path');
  write(path, text);
}

patchModal();
patchLiveAttendance();
patchDashboardPermissionCreation();
console.log('[leave-permission-ui] patch applied');
