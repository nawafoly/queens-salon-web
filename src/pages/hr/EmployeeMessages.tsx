import { useState } from "react";

import AdminMessagesV2 from "./AdminMessagesV2";
import ClientConnectInboxV2 from "./ClientConnectInboxV2";
import EmployeeMessagesLegacy from "./EmployeeMessagesLegacy";
import type { HrSession } from "./shared";

type Props = {
  session: HrSession;
  onPortalChange?: () => void | Promise<void>;
};

type MessagesMode = "clients" | "internal";

function isDashboardMessagesRoute() {
  if (typeof window === "undefined") return false;
  return /^\/dashboard(?:\/|$)/.test(window.location.pathname);
}

function MessagesModeTabs({
  mode,
  onChange,
  management,
}: {
  mode: MessagesMode;
  onChange: (mode: MessagesMode) => void;
  management: boolean;
}) {
  return (
    <nav className="malikat-messages-hub-tabs" aria-label="نوع الرسائل">
      <button
        type="button"
        className={mode === "clients" ? "is-active" : ""}
        onClick={() => onChange("clients")}
      >
        {management ? "محادثات العميلات" : "عميلاتي"}
      </button>
      <button
        type="button"
        className={mode === "internal" ? "is-active" : ""}
        onClick={() => onChange("internal")}
      >
        الرسائل الداخلية
      </button>
    </nav>
  );
}

export default function EmployeeMessagesPage(props: Props) {
  const dashboard = isDashboardMessagesRoute();
  const [mode, setMode] = useState<MessagesMode>("clients");

  if (dashboard) {
    return (
      <>
        <MessagesModeTabs mode={mode} onChange={setMode} management />
        {mode === "clients" ? (
          <ClientConnectInboxV2 session={props.session} management />
        ) : (
          <AdminMessagesV2 session={props.session} />
        )}
      </>
    );
  }

  return (
    <>
      <MessagesModeTabs mode={mode} onChange={setMode} management={false} />
      {mode === "clients" ? (
        <ClientConnectInboxV2 session={props.session} />
      ) : (
        <EmployeeMessagesLegacy {...props} />
      )}
    </>
  );
}
