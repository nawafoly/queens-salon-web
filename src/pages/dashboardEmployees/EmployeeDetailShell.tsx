import type { ReactNode } from "react";

type EmployeeDetailShellProps = {
  children: ReactNode;
  [key: string]: unknown;
};

export default function EmployeeDetailShell({ children }: EmployeeDetailShellProps) {
  return <>{children}</>;
}
