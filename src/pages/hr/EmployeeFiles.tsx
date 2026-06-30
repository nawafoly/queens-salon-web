import { useEffect, useMemo, useRef, useState } from "react";

import {
  createEmployeeFileRecord,
  createEmployeeNotification,
  listEmployeeDirectory,
  listEmployeeFiles,
  listEmployeeFilesByEmployee,
  listEmployeeNotifications,
  markEmployeeFilesRead,
  markEmployeeNotificationsRead,
  type EmployeeDirectoryEntry,
  type EmployeeFile,
} from "../../services/employeeHub";
import {
  getEmployeeFileStatusLabel,
  getEmployeeFileTypeLabel,
} from "../../helpers/hr/employeeFiles";
import { uploadFileToR2 } from "../../services/r2Upload";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
  onPortalChange?: () => void | Promise<void>;
};

export default function EmployeeFilesPage({ session, onPortalChange }: Props) {
  const [items, setItems] = useState<EmployeeFile[]>([]);
  const [directory, setDirectory] = useState<EmployeeDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [direction, setDirection] = useState<EmployeeFile["direction"]>("outbound");
  const [status, setStatus] = useState<EmployeeFile["status"]>("active");
  const [targetEmployeeUid, setTargetEmployeeUid] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const canChooseRecipient = ["owner", "admin", "hr"].includes(cleanText(session.role).toLowerCase());

  const load = async () => {
    if (!session.uid) return;
    setLoading(true);
    try {
      const [files, dir] = await Promise.all([
        canChooseRecipient
          ? listEmployeeFiles()
          : listEmployeeFilesByEmployee({
              employeeUid: session.uid,
              employeeId: session.employeeId,
            }),
        canChooseRecipient ? listEmployeeDirectory() : Promise.resolve([]),
      ]);
      setItems(files);
      setDirectory(dir);

      if (!canChooseRecipient) {
        await markEmployeeFilesRead({
          employeeUid: session.uid,
          employeeId: session.employeeId,
          readerUid: session.uid,
        });

        const notifications = await listEmployeeNotifications({
          targetUid: session.uid,
          targetEmployeeId: session.employeeId,
          limitCount: 200,
        });
        const unreadIds = notifications
          .filter((note) => !note.isRead && (note.route === "/employee/files" || note.type === "file"))
          .map((note) => note.id);
        if (unreadIds.length) {
          await markEmployeeNotificationsRead({ notificationIds: unreadIds, readerUid: session.uid });
        }
        await Promise.resolve(onPortalChange?.());
      }
    } catch (e) {
      setMessage(cleanText((e as any)?.message || "Failed to load files."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.uid]);

  const visibleFiles = useMemo(() => {
    const canSeeAll = ["owner", "admin", "hr"].includes(cleanText(session.role).toLowerCase());
    if (canSeeAll) return items;
    return items.filter((row) => row.employeeUid === session.uid || row.employeeId === session.employeeId);
  }, [items, session.employeeId, session.role, session.uid]);

  const handleSubmit = async () => {
    if (!session.uid) return;
    if (!pickedFile) {
      setMessage("Pick a file first.");
      return;
    }
    if (!cleanText(title)) {
      setMessage("Title is required.");
      return;
    }

    const employeeUid = canChooseRecipient ? cleanText(targetEmployeeUid) || session.uid : session.uid;
    const directoryEntry = directory.find((item) => item.employeeKey === employeeUid || item.linkedUid === employeeUid || item.employeeId === employeeUid);

    setBusy(true);
    setMessage("");
    try {
      const uploaded = await uploadFileToR2({
        file: pickedFile,
        keyPrefix: "employee-files",
        ownerId: employeeUid || session.uid,
      });

      await createEmployeeFileRecord({
        employeeUid,
        employeeId: directoryEntry?.employeeId || session.employeeId || session.uid,
        direction,
        title,
        fileName: pickedFile.name,
        mimeType: pickedFile.type || "application/octet-stream",
        storageKey: uploaded.storageKey,
        storageUrl: uploaded.storageUrl,
        notes,
        status,
        createdByUid: session.uid,
        createdByName: session.displayName,
      });

      await createEmployeeNotification({
        targetUid: employeeUid,
        targetEmployeeId: directoryEntry?.employeeId || employeeUid,
        type: "file",
        title: "ملف جديد",
        body: `${title}${pickedFile.name ? ` — ${pickedFile.name}` : ""}`,
        route: "/employee/files",
      }).catch(() => {});

      setTitle("");
      setNotes("");
      setDirection("outbound");
      setStatus("active");
      setPickedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
      await Promise.resolve(onPortalChange?.());
      setMessage("File record created.");
    } catch (e) {
      setMessage(cleanText((e as any)?.message || "Failed to create file record."));
    } finally {
      setBusy(false);
    }
  };

  if (!session.user) {
    return (
      <div className="employee-card">
        <h2>Files</h2>
        <p>No authenticated employee session.</p>
      </div>
    );
  }

  return (
    <div className="employee-panel">
      <div className="employee-panel-head">
        <div>
          <p className="employee-panel-kicker">File tracking</p>
          <h2>Files</h2>
          <p className="employee-panel-subtitle">Inbound and outbound files with R2 uploads and status tracking.</p>
        </div>
        <button className="employee-button" type="button" onClick={() => void load()} disabled={loading || busy}>
          Refresh
        </button>
      </div>

      {message ? <div className="employee-alert">{message}</div> : null}

      <div className="employee-card">
        <div className="employee-card-head">
          <h3>New file record</h3>
          <span>{canChooseRecipient ? "HR" : "Self"}</span>
        </div>

        <div className="employee-form-grid">
          {canChooseRecipient ? (
            <label className="employee-field">
              <span>Employee</span>
              <select value={targetEmployeeUid} onChange={(e) => setTargetEmployeeUid(e.target.value)}>
                <option value="">Select employee</option>
                {directory.map((item) => (
                  <option key={item.employeeId} value={item.employeeKey || item.linkedUid || item.employeeId}>
                    {item.name || item.employeeId}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="employee-field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contract, warning, CV..." />
          </label>
          <label className="employee-field">
            <span>Direction</span>
            <select value={direction} onChange={(e) => setDirection(e.target.value as EmployeeFile["direction"])}>
              <option value="outbound">Outbound</option>
              <option value="inbound">Inbound</option>
            </select>
          </label>
          <label className="employee-field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as EmployeeFile["status"])}>
              <option value="active">Active</option>
              <option value="read">Read</option>
              <option value="replaced">Replaced</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="employee-field employee-field--wide">
            <span>Notes</span>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="employee-field employee-field--wide">
            <span>Select file</span>
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => setPickedFile(e.target.files?.[0] || null)}
            />
          </label>
        </div>

        <div className="employee-actions">
          <button className="employee-button employee-button--accent" type="button" onClick={() => void handleSubmit()} disabled={busy}>
            Upload and save
          </button>
        </div>
      </div>

      <section className="employee-card">
        <div className="employee-card-head">
          <h3>Files</h3>
          <span>{visibleFiles.length}</span>
        </div>

        <div className="employee-list">
          {visibleFiles.map((row) => (
            <article key={row.id} className="employee-list-item employee-file-item">
              <div className="employee-file-item__head">
                <strong>{row.title}</strong>
                {!canChooseRecipient ? (
                  <span
                    className={`employee-file-badge ${
                      Array.isArray(row.readBy) && row.readBy.includes(session.uid) ? "" : "is-unread"
                    }`}
                  >
                    {Array.isArray(row.readBy) && row.readBy.includes(session.uid) ? "مقروء" : "جديد"}
                  </span>
                ) : null}
              </div>
              <span>
                {row.direction || "outbound"} | {getEmployeeFileStatusLabel(row.status, row.status !== "replaced")} | {row.employeeUid}
              </span>
              <small>{getEmployeeFileTypeLabel(row.fileType)} | {row.fileName || "No file name"}</small>
              {row.storageUrl ? (
                <a href={row.storageUrl} target="_blank" rel="noreferrer">
                  Open file
                </a>
              ) : null}
            </article>
          ))}
          {!visibleFiles.length ? <div className="employee-muted">No files found.</div> : null}
        </div>
      </section>
    </div>
  );
}
