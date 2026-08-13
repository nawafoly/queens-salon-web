from pathlib import Path
import re

overview_path = Path("src/pages/hr/EmployeeOverview.tsx")
css_path = Path("src/styles/dashboard-v2/pages/employee-portal-overview.css")

overview = overview_path.read_text(encoding="utf-8")
css = css_path.read_text(encoding="utf-8")

new_markup = r'''      <section className={`employee-attendance-card employee-attendance-card--${attendanceStatus}`} data-status={attendanceStatus}>
        <div className="employee-section-title">
          <div>
            <small><FontAwesomeIcon icon={faClock} /> الحضور والانصراف</small>
            <h2>تسجيل الدوام</h2>
            <p>{attendanceDateLabel}</p>
          </div>
          <span className="employee-gps-chip"><i aria-hidden="true" /> GPS + تصوير حسب الفرع</span>
        </div>

        <div className="employee-attendance-console">
          <div className="employee-attendance-side employee-attendance-side--in">
            <span>الحضور</span>
            <strong>{checkInTime}</strong>
            <em className={attendance?.checkInAtClient ? "is-done" : ""}>
              {attendance?.checkInAtClient ? "تم الحضور" : "لم يتم الحضور"}
            </em>
          </div>

          <div className="employee-punch-control">
            <button
              type="button"
              className={`employee-punch-button employee-punch-button--${punchTone}`}
              onClick={() => void handleAttendancePunch(punchAction)}
              disabled={punchDisabled}
              aria-label={attendanceBusy ? "جاري التسجيل" : punchLabel}
              aria-describedby="employee-punch-hint"
            >
              <span><FontAwesomeIcon icon={faFingerprint} /></span>
            </button>
            <strong>{attendanceBusy ? "جاري التسجيل..." : punchLabel}</strong>
          </div>

          <div className="employee-attendance-side employee-attendance-side--out">
            <span>الانصراف</span>
            <strong>{checkOutTime}</strong>
            <em className={attendance?.checkOutAtClient ? "is-done" : ""}>
              {attendance?.checkOutAtClient ? "تم الانصراف" : "لم يتم الانصراف"}
            </em>
          </div>
        </div>

        <div className={`employee-attendance-status employee-attendance-status--${attendanceStatus}`} role="status" aria-live="polite">
          <span>
            {attendanceMessage || (
              attendanceLoading
                ? "جاري تحديث حالة اليوم..."
                : attendanceStatus === "checked_out"
                  ? "تم تسجيل الحضور والانصراف"
                  : attendanceStatus === "checked_in"
                    ? "تم تسجيل الحضور"
                    : "لم يتم تسجيل الحضور"
            )}
          </span>
        </div>

        <div className="employee-attendance-hint" id="employee-punch-hint">
          {punchHint || (
            attendanceStatus === "checked_in"
              ? "اضغط البصمة لتسجيل الانصراف وإكمال دوام اليوم."
              : attendanceStatus === "checked_out"
                ? "تم اكتمال دوام اليوم وحفظ الحضور والانصراف."
                : "اضغط البصمة لتسجيل الحضور، والضغطة التالية في نفس اليوم تسجل الانصراف تلقائيًا."
          )}
        </div>

        {shouldShowAttendanceNote && hasAttendanceVerificationMeta ? (
          <div className="employee-attendance-note is-meta-only" aria-label="بيانات التحقق من الحضور">
            <div>
              {visibleZoneName ? <small>{visibleZoneName}</small> : null}
              {visibleAccuracyLabel ? <small>{visibleAccuracyLabel}</small> : null}
              {visibleDistance !== null ? <small>المسافة: {visibleDistance} م</small> : null}
            </div>
          </div>
        ) : null}
      </section>

'''

overview_pattern = re.compile(
    r'      <section className=\{`employee-attendance-card employee-attendance-card--\$\{attendanceStatus\}`\} data-status=\{attendanceStatus\}>.*?(?=      <section className="employee-overview-block">)',
    re.S,
)
overview, count = overview_pattern.subn(new_markup, overview, count=1)
if count != 1:
    raise SystemExit(f"attendance markup replacement count={count}")

new_css = r'''/* Attendance */
.dashboard-v2 .employee-overview-v2-page .employee-attendance-card {
  display: grid;
  gap: var(--dsv2-space-4);
  padding: var(--dsv2-panel-padding);
  border: 1px solid var(--dsv2-border);
  border-radius: var(--dsv2-radius-xl);
  background: var(--dsv2-surface);
  box-shadow: var(--dsv2-shadow-sm);
}

.dashboard-v2 .employee-overview-v2-page .employee-section-title,
.dashboard-v2 .employee-overview-v2-page .employee-block-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--dsv2-section-head-gap);
}

.dashboard-v2 .employee-overview-v2-page .employee-section-title > div,
.dashboard-v2 .employee-overview-v2-page .employee-block-head {
  min-width: 0;
}

.dashboard-v2 .employee-overview-v2-page .employee-section-title small {
  color: var(--dsv2-muted);
  font-size: 0.65rem;
  font-weight: 900;
}

.dashboard-v2 .employee-overview-v2-page .employee-section-title h2,
.dashboard-v2 .employee-overview-v2-page .employee-block-head h2 {
  margin: var(--dsv2-space-2) 0 0;
  color: var(--dsv2-text);
  font-size: 1.15rem;
  font-weight: 950;
}

.dashboard-v2 .employee-overview-v2-page .employee-section-title p,
.dashboard-v2 .employee-overview-v2-page .employee-block-head p {
  margin: var(--dsv2-space-1) 0 0;
  color: var(--dsv2-muted);
  font-size: 0.66rem;
  font-weight: 700;
  line-height: 1.65;
}

.dashboard-v2 .employee-overview-v2-page .employee-gps-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--dsv2-space-2);
  min-height: 30px;
  padding-inline: var(--dsv2-space-3);
  border: 1px solid var(--dsv2-border-gold);
  border-radius: var(--dsv2-radius-pill);
  background: var(--dsv2-gold-softer);
  color: var(--dsv2-warning);
  font-size: 0.58rem;
  font-weight: 900;
  white-space: nowrap;
}

.dashboard-v2 .employee-overview-v2-page .employee-gps-chip i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsv2-green);
  box-shadow: 0 0 0 4px var(--dsv2-green-soft);
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-console {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 118px minmax(0, 1fr);
  align-items: center;
  gap: var(--dsv2-space-3);
  min-width: 0;
  padding: var(--dsv2-space-5) var(--dsv2-space-4);
  border: 1px solid var(--dsv2-border);
  border-radius: var(--dsv2-radius-xl);
  background: var(--dsv2-surface-soft);
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-side {
  display: grid;
  min-width: 0;
  justify-items: center;
  gap: var(--dsv2-space-2);
  text-align: center;
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-side > span {
  color: var(--dsv2-muted);
  font-size: 0.68rem;
  font-weight: 850;
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-side > strong {
  color: var(--dsv2-text);
  font-size: 1.16rem;
  font-weight: 950;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-side--in > strong {
  color: var(--dsv2-green);
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-side > em {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  justify-content: center;
  padding-inline: var(--dsv2-space-3);
  border-radius: var(--dsv2-radius-pill);
  background: var(--dsv2-surface);
  color: var(--dsv2-muted);
  font-size: 0.58rem;
  font-style: normal;
  font-weight: 800;
  line-height: 1.2;
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-side > em.is-done {
  background: var(--dsv2-green-soft);
  color: var(--dsv2-green);
}

.dashboard-v2 .employee-overview-v2-page .employee-punch-control {
  display: grid;
  justify-items: center;
  gap: var(--dsv2-space-2);
}

.dashboard-v2 .employee-overview-v2-page .employee-punch-control > strong {
  color: var(--dsv2-text);
  font-size: 0.7rem;
  font-weight: 950;
  text-align: center;
}

.dashboard-v2 .employee-overview-v2-page .employee-punch-button {
  display: grid;
  width: 96px;
  height: 96px;
  min-width: 96px;
  min-height: 96px;
  place-items: center;
  margin: 0;
  padding: 0;
  border: 1px solid var(--dsv2-border);
  border-radius: 50%;
  background: var(--dsv2-surface);
  color: var(--dsv2-text-soft);
  box-shadow: var(--dsv2-shadow-sm);
  font-family: inherit;
  cursor: pointer;
  transition: transform var(--dsv2-transition-fast), border-color var(--dsv2-transition-fast), box-shadow var(--dsv2-transition-fast);
}

.dashboard-v2 .employee-overview-v2-page .employee-punch-button:hover:not(:disabled) {
  border-color: var(--dsv2-border-gold);
  box-shadow: var(--dsv2-shadow-md);
  transform: translateY(-1px);
}

.dashboard-v2 .employee-overview-v2-page .employee-punch-button:active:not(:disabled) {
  transform: scale(0.97);
}

.dashboard-v2 .employee-overview-v2-page .employee-punch-button:focus-visible {
  outline: 3px solid var(--dsv2-gold-soft);
  outline-offset: 3px;
}

.dashboard-v2 .employee-overview-v2-page .employee-punch-button:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.dashboard-v2 .employee-overview-v2-page .employee-punch-button--out {
  border-color: var(--dsv2-burgundy-border);
  color: var(--dsv2-burgundy);
}

.dashboard-v2 .employee-overview-v2-page .employee-punch-button--done {
  border-color: var(--dsv2-green-border);
  background: var(--dsv2-green-soft);
  color: var(--dsv2-green);
}

.dashboard-v2 .employee-overview-v2-page .employee-punch-button > span {
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  border-radius: 50%;
  color: inherit;
  font-size: 2rem;
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-status {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: var(--dsv2-space-3) var(--dsv2-space-4);
  border: 1px solid var(--dsv2-border);
  border-radius: var(--dsv2-radius-pill);
  background: var(--dsv2-surface);
  color: var(--dsv2-text-soft);
  text-align: center;
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-status > span {
  font-size: 0.66rem;
  font-weight: 850;
  line-height: 1.5;
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-status--checked_in,
.dashboard-v2 .employee-overview-v2-page .employee-attendance-status--checked_out {
  border-color: var(--dsv2-green-border);
  color: var(--dsv2-green);
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-hint {
  display: flex;
  min-height: 74px;
  align-items: center;
  justify-content: center;
  padding: var(--dsv2-space-4) var(--dsv2-space-5);
  border: 1px solid var(--dsv2-border);
  border-radius: var(--dsv2-radius-lg);
  background: var(--dsv2-surface-soft);
  color: var(--dsv2-muted);
  font-size: 0.68rem;
  font-weight: 750;
  line-height: 1.8;
  text-align: center;
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-note {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: var(--dsv2-space-2) var(--dsv2-space-3);
  border: 0;
  background: transparent;
  color: var(--dsv2-muted);
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-note > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--dsv2-space-2);
}

.dashboard-v2 .employee-overview-v2-page .employee-attendance-note small {
  display: inline-flex;
  padding: var(--dsv2-space-1) var(--dsv2-space-2);
  border-radius: var(--dsv2-radius-xs);
  background: var(--dsv2-surface-soft);
  color: var(--dsv2-muted);
  font-size: 0.54rem;
  font-weight: 800;
}

@media (max-width: 560px) {
  .dashboard-v2 .employee-overview-v2-page .employee-attendance-card {
    gap: var(--dsv2-space-3);
  }

  .dashboard-v2 .employee-overview-v2-page .employee-section-title {
    align-items: flex-start;
    flex-direction: row;
  }

  .dashboard-v2 .employee-overview-v2-page .employee-section-title h2 {
    font-size: 1.08rem;
  }

  .dashboard-v2 .employee-overview-v2-page .employee-gps-chip {
    min-height: 28px;
    padding-inline: var(--dsv2-space-2);
    font-size: 0.53rem;
  }

  .dashboard-v2 .employee-overview-v2-page .employee-attendance-console {
    grid-template-columns: minmax(0, 1fr) 92px minmax(0, 1fr);
    gap: var(--dsv2-space-2);
    padding: var(--dsv2-space-4) var(--dsv2-space-2);
    border-radius: var(--dsv2-radius-lg);
  }

  .dashboard-v2 .employee-overview-v2-page .employee-punch-button {
    width: 82px;
    height: 82px;
    min-width: 82px;
    min-height: 82px;
  }

  .dashboard-v2 .employee-overview-v2-page .employee-punch-button > span {
    width: 48px;
    height: 48px;
    font-size: 1.72rem;
  }

  .dashboard-v2 .employee-overview-v2-page .employee-punch-control > strong {
    font-size: 0.62rem;
  }

  .dashboard-v2 .employee-overview-v2-page .employee-attendance-side > span {
    font-size: 0.6rem;
  }

  .dashboard-v2 .employee-overview-v2-page .employee-attendance-side > strong {
    font-size: 0.95rem;
  }

  .dashboard-v2 .employee-overview-v2-page .employee-attendance-side > em {
    min-height: 26px;
    padding-inline: var(--dsv2-space-2);
    font-size: 0.52rem;
  }

  .dashboard-v2 .employee-overview-v2-page .employee-attendance-hint {
    min-height: 68px;
    padding: var(--dsv2-space-3);
    font-size: 0.62rem;
  }
}

@media (max-width: 360px) {
  .dashboard-v2 .employee-overview-v2-page .employee-attendance-console {
    grid-template-columns: minmax(0, 1fr) 78px minmax(0, 1fr);
  }

  .dashboard-v2 .employee-overview-v2-page .employee-punch-button {
    width: 72px;
    height: 72px;
    min-width: 72px;
    min-height: 72px;
  }

  .dashboard-v2 .employee-overview-v2-page .employee-attendance-side > strong {
    font-size: 0.82rem;
  }
}

'''

css_pattern = re.compile(r'/\* Attendance \*/.*?(?=/\* Shared overview panels \*/)', re.S)
css, count = css_pattern.subn(new_css, css, count=1)
if count != 1:
    raise SystemExit(f"attendance css replacement count={count}")

css, count = re.subn(
    r'/\* Final integrated refinements: punch contrast \+ avatar framing\. \*/.*?(?=\.dashboard-v2 \.employee-overview-v2-page \.employee-app-intro__avatar\.employee-avatar \{)',
    '/* Final integrated refinements: avatar framing. */\n\n',
    css,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"obsolete punch refinement removal count={count}")

overview_path.write_text(overview, encoding="utf-8")
css_path.write_text(css, encoding="utf-8")
