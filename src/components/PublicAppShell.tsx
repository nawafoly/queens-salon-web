import "../styles/PublicAppShell.css";
import type { ReactNode } from "react";

type PublicAppShellProps = {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  chat?: ReactNode;
};

export default function PublicAppShell({
  header,
  children,
  footer,
  chat,
}: PublicAppShellProps) {
  return (
    <div className="public-app-shell">
      {header && (
        <header className="public-app-shell__header">
          {header}
        </header>
      )}

      <div className="public-app-shell__viewport">
        {children}
      </div>

      {footer && (
        <div className="public-app-shell__footer">
          {footer}
        </div>
      )}

      {chat && (
        <div className="public-app-shell__chat">
          {chat}
        </div>
      )}
    </div>
  );
}

