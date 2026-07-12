import { useMemo, useState } from "react";
import "../styles/EmployeeAvatar.css";

type EmployeeAvatarProps = {
  name?: string | null;
  src?: string | null;
  alt?: string;
  className?: string;
  loading?: "eager" | "lazy";
};

function initialsOf(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "؟";
  return `${parts[0]?.[0] || ""}${parts.length > 1 ? parts.at(-1)?.[0] || "" : ""}`.toUpperCase();
}

function safeAvatarUrl(value: string | null | undefined) {
  const url = String(value || "").trim();
  if (!url || /^(javascript|vbscript):/i.test(url)) return "";
  return url;
}

export default function EmployeeAvatar({ name, src, alt, className = "", loading = "lazy" }: EmployeeAvatarProps) {
  const url = useMemo(() => safeAvatarUrl(src), [src]);
  const [loadedUrl, setLoadedUrl] = useState("");

  const loaded = !!url && loadedUrl === url;
  return (
    <span className={`employee-avatar ${loaded ? "is-loaded" : "is-fallback"} ${className}`.trim()}>
      <span className="employee-avatar__fallback" aria-hidden="true">{initialsOf(String(name || ""))}</span>
      {url ? (
        <img
          className="employee-avatar__image"
          src={url}
          alt={alt ?? String(name || "صورة الموظفة")}
          width={64}
          height={64}
          loading={loading}
          decoding="async"
          onLoad={() => setLoadedUrl(url)}
          onError={() => setLoadedUrl("")}
        />
      ) : null}
    </span>
  );
}
