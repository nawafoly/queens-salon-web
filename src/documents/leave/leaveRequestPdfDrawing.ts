import { safeDocumentText } from "./leaveRequestModel";
import type { LeaveRequestDocumentSignature } from "./leaveRequestModel";

export const LEAVE_PDF_CANVAS = { width: 1131, height: 1600, margin: 68 } as const;
export const LEAVE_PDF_A4_POINTS = { width: 595.28, height: 841.89 } as const;
const FONT_FAMILY = 'Tahoma, Arial, "Segoe UI", sans-serif';

function setFont(context: CanvasRenderingContext2D, size: number, weight = 500) {
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;
}

export function drawLeavePdfText(
  context: CanvasRenderingContext2D,
  value: unknown,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  weight = 500,
  textColor = "#111",
  align: CanvasTextAlign = "right"
) {
  context.save();
  context.direction = "rtl";
  context.textAlign = align;
  context.textBaseline = "top";
  context.fillStyle = textColor;
  setFont(context, size, weight);
  context.fillText(String(value ?? "—"), x, y, maxWidth);
  context.restore();
}

function wrapText(
  context: CanvasRenderingContext2D,
  value: unknown,
  maxWidth: number,
  maxLines = 4
) {
  const words = safeDocumentText(value).replace(/\s+/g, " ").split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

export function drawLeavePdfWrappedText(
  context: CanvasRenderingContext2D,
  value: unknown,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  weight = 500,
  maxLines = 4,
  lineHeight = Math.round(size * 1.45)
) {
  context.save();
  context.direction = "rtl";
  context.textAlign = "right";
  context.textBaseline = "top";
  context.fillStyle = "#111";
  setFont(context, size, weight);
  wrapText(context, value, maxWidth, maxLines).forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight, maxWidth);
  });
  context.restore();
}

export function strokeLeavePdfBox(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
) {
  context.strokeStyle = "#222";
  context.lineWidth = 1.5;
  context.strokeRect(x, y, width, height);
}

export function drawLeavePdfField(
  context: CanvasRenderingContext2D,
  label: string,
  value: unknown,
  x: number,
  y: number,
  width: number
) {
  drawLeavePdfText(context, label, x + width - 8, y + 6, width - 16, 15, 700, "#444");
  drawLeavePdfText(context, value, x + width - 8, y + 32, width - 16, 18, 800);
  context.beginPath();
  context.moveTo(x, y + 66);
  context.lineTo(x + width, y + 66);
  context.strokeStyle = "#222";
  context.stroke();
}

export function drawLeavePdfSignature(
  context: CanvasRenderingContext2D,
  signature: LeaveRequestDocumentSignature,
  image: HTMLImageElement | null,
  x: number,
  y: number,
  width: number
) {
  drawLeavePdfText(context, signature.label, x + width - 8, y, width - 16, 15, 700, "#444");
  if (image) {
    const maxWidth = Math.min(width - 16, 260);
    const maxHeight = 76;
    const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
    const drawWidth = image.width * ratio;
    const drawHeight = image.height * ratio;
    context.drawImage(image, x + width - 8 - drawWidth, y + 24, drawWidth, drawHeight);
  } else {
    drawLeavePdfText(context, signature.fallback, x + width - 8, y + 28, width - 16, 18, 800);
  }
  if (signature.signedAt) {
    drawLeavePdfText(context, signature.signedAt, x + width - 8, y + 104, width - 16, 13, 500, "#555");
  }
  context.beginPath();
  context.moveTo(x, y + 126);
  context.lineTo(x + width, y + 126);
  context.strokeStyle = "#222";
  context.stroke();
}
