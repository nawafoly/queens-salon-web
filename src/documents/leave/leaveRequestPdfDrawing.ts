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
  textColor = "#000",
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
  context.fillStyle = "#000";
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
  context.strokeStyle = "#000";
  context.lineWidth = 1.5;
  context.strokeRect(x, y, width, height);
}

function measuredRuleWidth(
  context: CanvasRenderingContext2D,
  value: unknown,
  maxWidth: number,
  minWidth = 140,
  padding = 28
) {
  const text = String(value ?? "—");
  const measured = context.measureText(text).width + padding;
  return Math.min(maxWidth, Math.max(minWidth, measured));
}

export function drawLeavePdfField(
  context: CanvasRenderingContext2D,
  label: string,
  value: unknown,
  x: number,
  y: number,
  width: number
) {
  const right = x + width - 8;
  drawLeavePdfText(context, label, right, y + 6, width - 16, 15, 800, "#000");
  setFont(context, 18, 800);
  const ruleWidth = measuredRuleWidth(context, value, width - 16);
  drawLeavePdfText(context, value, right, y + 32, ruleWidth, 18, 800, "#000");
  context.beginPath();
  context.moveTo(right - ruleWidth, y + 66);
  context.lineTo(right, y + 66);
  context.strokeStyle = "#000";
  context.lineWidth = 1.2;
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
  const right = x + width - 8;
  drawLeavePdfText(context, signature.label, right, y, width - 16, 15, 800, "#000");
  let ruleWidth = 220;
  if (image) {
    const maxWidth = Math.min(width - 16, 260);
    const maxHeight = 76;
    const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
    const drawWidth = image.width * ratio;
    const drawHeight = image.height * ratio;
    ruleWidth = Math.max(180, Math.min(width - 16, drawWidth + 24));
    context.drawImage(image, right - drawWidth, y + 24, drawWidth, drawHeight);
  } else {
    setFont(context, 18, 800);
    ruleWidth = measuredRuleWidth(context, signature.fallback, width - 16, 180);
    drawLeavePdfText(context, signature.fallback, right, y + 28, ruleWidth, 18, 800, "#000");
  }
  if (signature.signedAt) {
    drawLeavePdfText(context, signature.signedAt, right, y + 104, ruleWidth, 13, 600, "#000");
  }
  context.beginPath();
  context.moveTo(right - ruleWidth, y + 126);
  context.lineTo(right, y + 126);
  context.strokeStyle = "#000";
  context.lineWidth = 1.2;
  context.stroke();
}
