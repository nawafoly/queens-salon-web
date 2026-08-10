import type { CSSProperties } from "react";

export type DashboardSkeletonVariantV2 = "text" | "title" | "circle" | "button" | "block" | "card";

export type DashboardSkeletonV2Props = {
  variant?: DashboardSkeletonVariantV2;
  width?: number | string;
  height?: number | string;
  lines?: number;
  className?: string;
  label?: string;
};

type DashboardSkeletonStyleV2 = CSSProperties & {
  "--dsv2-skeleton-width"?: string;
  "--dsv2-skeleton-height"?: string;
};

function toCssSize(value: number | string | undefined) {
  if (typeof value === "number") {
    return `${value}px`;
  }
  return value;
}

export default function DashboardSkeletonV2({
  variant = "text",
  width,
  height,
  lines = 1,
  className = "",
  label = "جارٍ تحميل المحتوى",
}: DashboardSkeletonV2Props) {
  const safeLines = Math.max(1, Math.floor(lines));
  const visualVariant = variant === "card" ? "block" : variant;
  const style: DashboardSkeletonStyleV2 = {
    "--dsv2-skeleton-width": toCssSize(width),
    "--dsv2-skeleton-height": toCssSize(height),
  };
  const classes = ["dsv2-skeleton", `dsv2-skeleton--${visualVariant}`, className]
    .filter(Boolean)
    .join(" ");

  if (safeLines === 1) {
    return <span className={classes} style={style} aria-hidden="true" />;
  }

  return (
    <div className="dsv2-skeleton-group" role="status" aria-label={label}>
      {Array.from({ length: safeLines }, (_, index) => (
        <span
          key={index}
          className={classes}
          style={{
            ...style,
            "--dsv2-skeleton-width": index === safeLines - 1 ? "68%" : toCssSize(width),
          } as DashboardSkeletonStyleV2}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
