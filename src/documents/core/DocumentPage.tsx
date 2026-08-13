import type { ReactNode } from "react";
import "./documentPrint.css";

type DocumentPageProps = {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
};

type DocumentSectionProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

type DocumentWatermarkProps = {
  src: string;
  className?: string;
};

export function DocumentPage({ children, className = "", labelledBy }: DocumentPageProps) {
  return (
    <section
      className={`document-a4-page ${className}`.trim()}
      dir="rtl"
      aria-labelledby={labelledBy}
      data-document-page="a4"
    >
      {children}
    </section>
  );
}

export function DocumentWatermark({ src, className = "" }: DocumentWatermarkProps) {
  return (
    <img
      className={`document-watermark ${className}`.trim()}
      src={src}
      alt=""
      aria-hidden="true"
    />
  );
}

export function DocumentSection({ title, children, className = "" }: DocumentSectionProps) {
  return (
    <section className={`document-section ${className}`.trim()}>
      {title ? <h3>{title}</h3> : null}
      {children}
    </section>
  );
}

export function DocumentFieldGrid({ children }: { children: ReactNode }) {
  return <div className="document-field-grid">{children}</div>;
}

export function DocumentField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="document-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function DocumentLongText({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="document-long-text">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}
