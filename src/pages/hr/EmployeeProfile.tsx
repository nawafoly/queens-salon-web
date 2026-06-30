import { useEffect, useMemo, useRef, useState } from "react";

import {
  createEmployeeNotification,
  createLeaveRequest,
  listLeaveRequestsByEmployee,
  listEmployeeNotifications,
  listPayrollRecordsByEmployee,
  markEmployeeNotificationsRead,
  syncEmployeeRecordFromUser,
  type EmployeeLeaveRequest,
  type EmployeePayrollRecord,
} from "../../services/employeeHub";
import {
  calculateLeaveDaysCount,
  formatLeaveDateRange,
  getLeaveStatusMeta,
  getLeaveTypeLabel,
} from "../../helpers/hr/employeeLeave";
import { uploadFileToR2 } from "../../services/r2Upload";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
  initialTab?: "profile" | "leave" | "payroll";
  onPortalChange?: () => void | Promise<void>;
};

type ProfileState = {
  displayName: string;
  phone: string;
  department: string;
  title: string;
  avatarUrl: string;
  bio: string;
  employeeProfileEnabled: boolean;
  showOnAbout: boolean;
  showOnBooking: boolean;
};

function makeTempRequestDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function EmployeeProfilePage({ session, initialTab = "profile", onPortalChange }: Props) {
  const [activeTab, setActiveTab] = useState<Props["initialTab"]>(initialTab);
  const [profile, setProfile] = useState<ProfileState>({
    displayName: "",
    phone: "",
    department: "",
    title: "",
    avatarUrl: "",
    bio: "",
    employeeProfileEnabled: true,
    showOnAbout: true,
    showOnBooking: true,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState<EmployeeLeaveRequest[]>([]);
  const [payrollRecords, setPayrollRecords] = useState<EmployeePayrollRecord[]>([]);
  const [leaveForm, setLeaveForm] = useState({
    type: "annual" as EmployeeLeaveRequest["type"],
    fromDate: makeTempRequestDate(),
    toDate: makeTempRequestDate(),
    note: "",
  });
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const base = session.employeeDoc || session.staffDoc || session.userDoc || {};
    setProfile({
      displayName: cleanText(base.displayName || base.name || session.displayName || ""),
      phone: cleanText(base.phone || session.userDoc?.phone || ""),
      department: cleanText(base.department || ""),
      title: cleanText(base.title || ""),
      avatarUrl: cleanText(base.avatarUrl || base.photoURL || base.photoUrl || ""),
      bio: cleanText(base.bio || ""),
      employeeProfileEnabled: base.employeeProfileEnabled !== false,
      showOnAbout: base.showOnAbout !== false,
      showOnBooking: base.showOnBooking !== false,
    });
  }, [session.employeeDoc, session.staffDoc, session.userDoc, session.displayName]);

  const employeeLabel = useMemo(() => {
    return cleanText(profile.displayName || session.displayName || session.email || "Employee");
  }, [profile.displayName, session.displayName, session.email]);

  const loadHistory = async () => {
    if (!session.uid) return;
    setLeaveLoading(true);
    try {
      const [leaveRows, payrollRows] = await Promise.all([
        listLeaveRequestsByEmployee(session.uid),
        listPayrollRecordsByEmployee(session.uid),
      ]);
      setLeaveRequests(leaveRows);
      setPayrollRecords(payrollRows);
    } finally {
      setLeaveLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.uid]);

  useEffect(() => {
    if (!session.uid) return;
    if (activeTab !== "leave" && activeTab !== "payroll") return;

    const route = activeTab === "leave" ? "/employee/leave" : "/employee/payroll";
    void (async () => {
      try {
        const notifications = await listEmployeeNotifications({
          targetUid: session.uid,
          targetEmployeeId: session.employeeId,
          limitCount: 200,
        });
        const unreadIds = notifications
          .filter((note) => !note.isRead && (note.route === route || note.type === activeTab))
          .map((note) => note.id);
        if (unreadIds.length) {
          await markEmployeeNotificationsRead({ notificationIds: unreadIds, readerUid: session.uid });
          await Promise.resolve(onPortalChange?.());
        }
      } catch {
        // no-op
      }
    })();
  }, [activeTab, session.uid, session.employeeId, onPortalChange]);

  const saveProfile = async (nextPatch?: Partial<ProfileState>) => {
    if (!session.uid) return;
    const next = { ...profile, ...(nextPatch || {}) };

    if (!cleanText(next.displayName)) {
      setMessage("Display name is required.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await syncEmployeeRecordFromUser({
        uid: session.uid,
        email: session.email,
        displayName: next.displayName,
        phone: next.phone,
        role: session.role as any,
        active: true,
        employeeId: session.employeeId || session.uid,
        linkedEmployeeDocId: session.employeeId || session.uid,
        employeeProfileEnabled: next.employeeProfileEnabled,
        showOnAbout: next.showOnAbout,
        showOnBooking: next.showOnBooking,
        department: next.department,
        title: next.title,
        avatarUrl: next.avatarUrl,
        bio: next.bio,
      });

      setProfile(next);
      setMessage("Profile updated.");
    } catch (e) {
      setMessage(cleanText((e as any)?.message || "Failed to save profile."));
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarPick = async (file: File | null | undefined) => {
    if (!file) return;
    if (!session.uid) return;

    setSaving(true);
    setMessage("");
    try {
      const uploaded = await uploadFileToR2({
        file,
        keyPrefix: "employee-assets/avatars",
        ownerId: session.employeeId || session.uid,
      });
      await saveProfile({ avatarUrl: uploaded.storageUrl });
    } catch (e) {
      setMessage(cleanText((e as any)?.message || "Avatar upload failed."));
    } finally {
      setSaving(false);
    }
  };

  const submitLeaveRequest = async () => {
    if (!session.uid) return;
    if (!leaveForm.fromDate || !leaveForm.toDate) {
      setMessage("Select a valid leave range.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const days = calculateLeaveDaysCount(leaveForm.fromDate, leaveForm.toDate) || 1;

      await createLeaveRequest({
        employeeUid: session.uid,
        employeeId: session.employeeId || session.uid,
        employeeName: employeeLabel,
        type: leaveForm.type,
        fromDate: leaveForm.fromDate,
        toDate: leaveForm.toDate,
        note: leaveForm.note,
        days,
        createdByUid: session.uid,
        createdByName: employeeLabel,
      });

      await createEmployeeNotification({
        targetUid: session.uid,
        targetEmployeeId: session.employeeId || session.uid,
        type: "leave",
        title: "تم إرسال طلب إجازة",
        body: `من ${leaveForm.fromDate} إلى ${leaveForm.toDate}`,
        route: "/employee/leave",
      }).catch(() => {});

      setLeaveForm((p) => ({ ...p, note: "" }));
      await loadHistory();
      await Promise.resolve(onPortalChange?.());
      setMessage("Leave request submitted.");
    } catch (e) {
      setMessage(cleanText((e as any)?.message || "Leave request failed."));
    } finally {
      setSaving(false);
    }
  };

  if (!session.user) {
    return (
      <div className="employee-portal-card">
        <h2>Employee profile</h2>
        <p>No authenticated employee session was found.</p>
      </div>
    );
  }

  return (
    <div className="employee-panel">
      <div className="employee-panel-head">
        <div>
          <p className="employee-panel-kicker">Employee Portal</p>
          <h2>{employeeLabel}</h2>
          <p className="employee-panel-subtitle">
            {session.email || "No email"} | {session.role || "guest"} | {session.employeeId ? `ID ${session.employeeId}` : "No employee record"}
          </p>
        </div>
        <div className="employee-panel-actions">
          <button className="employee-button" type="button" onClick={() => void loadHistory()} disabled={saving || leaveLoading}>
            Refresh data
          </button>
          <button className="employee-button employee-button--ghost" type="button" onClick={() => avatarInputRef.current?.click()} disabled={saving}>
            Upload photo
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void handleAvatarPick(e.target.files?.[0])}
          />
        </div>
      </div>

      {message ? <div className="employee-alert">{message}</div> : null}

      <div className="employee-tabs">
        <button className={`employee-tab ${activeTab === "profile" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("profile")}>
          Profile
        </button>
        <button className={`employee-tab ${activeTab === "leave" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("leave")}>
          Leave
        </button>
        <button className={`employee-tab ${activeTab === "payroll" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("payroll")}>
          Payroll
        </button>
      </div>

      {activeTab === "profile" ? (
        <section className="employee-card-stack">
          <div className="employee-card employee-card--hero">
            <div className="employee-avatar">
              {profile.avatarUrl ? <img src={profile.avatarUrl} alt={employeeLabel} /> : <span>{employeeLabel.slice(0, 1).toUpperCase()}</span>}
            </div>

            <div className="employee-form-grid">
              <label className="employee-field">
                <span>Name</span>
                <input
                  value={profile.displayName}
                  onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
                />
              </label>
              <label className="employee-field">
                <span>Phone</span>
                <input
                  value={profile.phone}
                  onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                />
              </label>
              <label className="employee-field">
                <span>Department</span>
                <input
                  value={profile.department}
                  onChange={(e) => setProfile((p) => ({ ...p, department: e.target.value }))}
                />
              </label>
              <label className="employee-field">
                <span>Title</span>
                <input
                  value={profile.title}
                  onChange={(e) => setProfile((p) => ({ ...p, title: e.target.value }))}
                />
              </label>
              <label className="employee-field employee-field--wide">
                <span>Avatar URL</span>
                <input
                  value={profile.avatarUrl}
                  onChange={(e) => setProfile((p) => ({ ...p, avatarUrl: e.target.value }))}
                  placeholder="Paste a direct image URL or upload a file"
                />
              </label>
              <label className="employee-field employee-field--wide">
                <span>Bio</span>
                <textarea
                  rows={4}
                  value={profile.bio}
                  onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
                />
              </label>
              <label className="employee-check">
                <input
                  type="checkbox"
                  checked={profile.employeeProfileEnabled}
                  onChange={(e) => setProfile((p) => ({ ...p, employeeProfileEnabled: e.target.checked }))}
                />
                Employee profile enabled
              </label>
              <label className="employee-check">
                <input
                  type="checkbox"
                  checked={profile.showOnAbout}
                  onChange={(e) => setProfile((p) => ({ ...p, showOnAbout: e.target.checked }))}
                />
                Show on About page
              </label>
              <label className="employee-check">
                <input
                  type="checkbox"
                  checked={profile.showOnBooking}
                  onChange={(e) => setProfile((p) => ({ ...p, showOnBooking: e.target.checked }))}
                />
                Show on booking page
              </label>
            </div>

            <div className="employee-actions">
              <button className="employee-button employee-button--accent" type="button" onClick={() => void saveProfile()} disabled={saving}>
                Save profile
              </button>
            </div>
          </div>

          <div className="employee-card">
            <div className="employee-card-head">
              <h3>Recent leave requests</h3>
              <span>{leaveRequests.length}</span>
            </div>
            <div className="employee-list">
              {leaveRequests.map((item) => {
                const statusMeta = getLeaveStatusMeta(item.status);
                return (
                  <div key={item.id} className="employee-list-item">
                    <strong>{getLeaveTypeLabel(item.type)}</strong>
                    <span>{formatLeaveDateRange(item.fromDate, item.toDate)}</span>
                    <small>{statusMeta.label}</small>
                  </div>
                );
              })}
              {!leaveRequests.length ? <div className="employee-muted">No leave requests yet.</div> : null}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "leave" ? (
        <section className="employee-card-stack">
          <div className="employee-card">
            <div className="employee-card-head">
              <h3>Submit leave request</h3>
              <span>Pending</span>
            </div>

            <div className="employee-form-grid">
              <label className="employee-field">
                <span>Type</span>
                <select
                  value={leaveForm.type}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, type: e.target.value as EmployeeLeaveRequest["type"] }))}
                >
                  <option value="annual">Annual</option>
                  <option value="sick">Sick</option>
                  <option value="emergency">Emergency</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="employee-field">
                <span>From date</span>
                <input
                  type="date"
                  value={leaveForm.fromDate}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, fromDate: e.target.value }))}
                />
              </label>
              <label className="employee-field">
                <span>To date</span>
                <input
                  type="date"
                  value={leaveForm.toDate}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, toDate: e.target.value }))}
                />
              </label>
              <label className="employee-field employee-field--wide">
                <span>Note</span>
                <textarea
                  rows={4}
                  value={leaveForm.note}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, note: e.target.value }))}
                  placeholder="Optional note"
                />
              </label>
            </div>

            <div className="employee-actions">
              <button className="employee-button employee-button--accent" type="button" onClick={() => void submitLeaveRequest()} disabled={saving}>
                Submit request
              </button>
            </div>
          </div>

          <div className="employee-card">
            <div className="employee-card-head">
              <h3>History</h3>
              <span>{leaveLoading ? "..." : leaveRequests.length}</span>
            </div>
            <div className="employee-list">
              {leaveRequests.map((item) => {
                const statusMeta = getLeaveStatusMeta(item.status);
                return (
                  <div key={item.id} className="employee-list-item">
                    <strong>{getLeaveTypeLabel(item.type)}</strong>
                    <span>{formatLeaveDateRange(item.fromDate, item.toDate)}</span>
                    <small>{statusMeta.label}{item.note ? ` | ${item.note}` : ""}</small>
                  </div>
                );
              })}
              {!leaveRequests.length ? <div className="employee-muted">No leave requests yet.</div> : null}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "payroll" ? (
        <section className="employee-card-stack">
          <div className="employee-card">
            <div className="employee-card-head">
              <h3>Payroll records</h3>
              <span>{leaveLoading ? "..." : payrollRecords.length}</span>
            </div>
            <div className="employee-list">
              {payrollRecords.map((row) => (
                <div key={row.id} className="employee-list-item">
                  <strong>{row.monthKey}</strong>
                  <span>
                    Salary: {Number(row.salary || row.total || 0).toFixed(2)}
                  </span>
                  <small>
                    Base {Number(row.baseSalary || 0).toFixed(2)} | Overtime {Number(row.overtime || 0).toFixed(2)}
                  </small>
                </div>
              ))}
              {!payrollRecords.length ? <div className="employee-muted">No payroll snapshots yet.</div> : null}
            </div>
          </div>

          <div className="employee-card">
            <div className="employee-card-head">
              <h3>Notes</h3>
            </div>
            <div className="employee-copy">
              Payroll snapshots are stored monthly in `employee_payroll_records` using the `employeeId__YYYY-MM` pattern.
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
