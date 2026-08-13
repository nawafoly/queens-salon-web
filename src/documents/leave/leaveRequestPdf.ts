import type { EmployeeRequest } from "../../services/employeeRequests";
import { buildPdfFromJpegPages } from "../../services/exports-v2/pdf";
import { DOCUMENT_BRANDING } from "../core/documentBranding";
import {
  documentCanvasToJpegBytes,
  documentImageCanvas,
  loadDocumentExportImageElement,
} from "../core/documentExportAssets";
import { buildLeaveRequestDocumentData } from "./leaveRequestModel";
import {
  LEAVE_DOCUMENT_TEXT,
  leaveRequestLetterText,
} from "./leaveRequestDocumentSpec";
import {
  LEAVE_PDF_A4_POINTS,
  LEAVE_PDF_CANVAS,
  drawLeavePdfField,
  drawLeavePdfSignature,
  drawLeavePdfText,
  drawLeavePdfWrappedText,
  strokeLeavePdfBox,
} from "./leaveRequestPdfDrawing";

function drawBranding(
  context: CanvasRenderingContext2D,
  logo: HTMLCanvasElement | null
) {
  if (!logo) {
    drawLeavePdfText(
      context,
      DOCUMENT_BRANDING.salonName,
      LEAVE_PDF_CANVAS.margin + 195,
      94,
      190,
      24,
      900,
      "#000",
      "center"
    );
    return;
  }

  const watermarkRatio = Math.min(660 / logo.width, 320 / logo.height);
  const watermarkWidth = logo.width * watermarkRatio;
  const watermarkHeight = logo.height * watermarkRatio;
  context.save();
  context.globalAlpha = DOCUMENT_BRANDING.watermarkOpacity;
  context.drawImage(
    logo,
    (LEAVE_PDF_CANVAS.width - watermarkWidth) / 2,
    (LEAVE_PDF_CANVAS.height - watermarkHeight) / 2 + 22,
    watermarkWidth,
    watermarkHeight
  );
  context.restore();

  const logoRatio = Math.min(220 / logo.width, 120 / logo.height);
  context.drawImage(
    logo,
    LEAVE_PDF_CANVAS.margin + 42,
    78,
    logo.width * logoRatio,
    logo.height * logoRatio
  );
}

export async function buildLeaveRequestPdfBytes(request: EmployeeRequest) {
  if (typeof document === "undefined") {
    throw new Error("تصدير PDF يتطلب تشغيل الصفحة داخل المتصفح.");
  }
  if (document.fonts?.ready) await document.fonts.ready;

  const data = buildLeaveRequestDocumentData(request);
  const [logoSource, employeeSignature, managerSignature] = await Promise.all([
    loadDocumentExportImageElement(DOCUMENT_BRANDING.printLogoSource),
    loadDocumentExportImageElement(data.employeeSignature.imageDataUrl),
    loadDocumentExportImageElement(data.managerSignature.imageDataUrl),
  ]);
  if (!logoSource) {
    throw new Error("تعذر تجهيز شعار ملكات الأسود للتصدير. لم يتم إنشاء PDF ناقص الهوية.");
  }
  const blackLogo = documentImageCanvas(logoSource, true);
  if (!blackLogo) {
    throw new Error("تعذر تحويل شعار ملكات إلى النسخة السوداء للطباعة.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = LEAVE_PDF_CANVAS.width;
  canvas.height = LEAVE_PDF_CANVAS.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("تعذر إنشاء لوحة PDF في المتصفح.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.direction = "rtl";
  strokeLeavePdfBox(
    context,
    LEAVE_PDF_CANVAS.margin,
    48,
    canvas.width - LEAVE_PDF_CANVAS.margin * 2,
    canvas.height - 96
  );

  const right = canvas.width - LEAVE_PDF_CANVAS.margin - 42;
  drawBranding(context, blackLogo);
  drawLeavePdfText(context, data.title, canvas.width / 2, 94, 280, 34, 900, "#000", "center");
  context.beginPath();
  context.moveTo(LEAVE_PDF_CANVAS.margin + 34, 190);
  context.lineTo(canvas.width - LEAVE_PDF_CANVAS.margin - 34, 190);
  context.strokeStyle = "#000";
  context.stroke();
  drawLeavePdfText(context, `رقم الطلب: ${data.requestNumber}`, right, 212, 380, 17, 800, "#000");

  let y = 258;
  const optionWidth = 260;
  data.leaveTypeOptions.forEach((option, index) => {
    const x = right - optionWidth - index * (optionWidth + 16);
    strokeLeavePdfBox(context, x + optionWidth - 28, y + 4, 24, 24);
    if (option.checked) {
      drawLeavePdfText(context, "✓", x + optionWidth - 12, y + 2, 20, 21, 900, "#000", "center");
    }
    drawLeavePdfText(context, option.label, x + optionWidth - 40, y + 3, optionWidth - 44, 17, 800, "#000");
  });

  y += 62;
  drawLeavePdfText(context, data.addressee, right, y, canvas.width - 220, 19, 900, "#000");
  y += 36;
  drawLeavePdfText(context, LEAVE_DOCUMENT_TEXT.honored, right, y, 280, 18, 700, "#000");
  y += 34;
  drawLeavePdfText(context, LEAVE_DOCUMENT_TEXT.greeting, right, y, 430, 18, 700, "#000");
  y += 42;
  drawLeavePdfWrappedText(context, leaveRequestLetterText(data), right, y, canvas.width - 220, 19, 600, 3, 30);
  y += 112;

  const fieldWidth = 460;
  const fieldX = [right - fieldWidth, right - fieldWidth * 2 - 24];
  drawLeavePdfField(context, data.fields[0]?.label || "", data.fields[0]?.value || "", fieldX[0], y, fieldWidth);
  drawLeavePdfField(context, data.fields[1]?.label || "", data.fields[1]?.value || "", fieldX[1], y, fieldWidth);
  y += 88;
  drawLeavePdfField(context, data.fields[2]?.label || "", data.fields[2]?.value || "", fieldX[0], y, fieldWidth);
  drawLeavePdfField(context, data.fields[3]?.label || "", data.fields[3]?.value || "", fieldX[1], y, fieldWidth);
  y += 96;

  drawLeavePdfText(context, "سبب الإجازة", right, y, 260, 15, 800, "#000");
  drawLeavePdfWrappedText(context, data.reason, right, y + 24, 620, 17, 600, 2, 26);
  y += 104;

  if (data.notes !== "—") {
    drawLeavePdfText(context, "ملاحظات", right, y, 260, 15, 800, "#000");
    drawLeavePdfWrappedText(context, data.notes, right, y + 24, 620, 17, 600, 2, 25);
    y += 94;
  }

  drawLeavePdfField(context, "الاسم", data.employeeName, fieldX[0], y, fieldWidth);
  drawLeavePdfSignature(context, data.employeeSignature, employeeSignature, fieldX[1], y, fieldWidth);
  y += 166;
  context.beginPath();
  context.moveTo(LEAVE_PDF_CANVAS.margin + 42, y);
  context.lineTo(right, y);
  context.strokeStyle = "#000";
  context.stroke();
  y += 26;
  drawLeavePdfText(context, LEAVE_DOCUMENT_TEXT.managerTitle, right, y, 360, 20, 900, "#000");
  y += 34;
  drawLeavePdfWrappedText(context, LEAVE_DOCUMENT_TEXT.managerReview, right, y, canvas.width - 220, 17, 600, 2, 26);
  y += 72;

  drawLeavePdfField(context, "اسم المسؤول", data.managerName, fieldX[0], y, fieldWidth);
  drawLeavePdfField(context, "الدور", data.managerRole, fieldX[1], y, fieldWidth);
  y += 88;
  drawLeavePdfField(context, "القرار", data.managerDecisionLabel, fieldX[0], y, fieldWidth);
  drawLeavePdfSignature(context, data.managerSignature, managerSignature, fieldX[1], y, fieldWidth);
  y += 150;

  data.managerDecisionOptions.forEach((option, index) => {
    const x = right - 300 - index * 330;
    strokeLeavePdfBox(context, x + 272, y + 2, 24, 24);
    if (option.checked) {
      drawLeavePdfText(context, "✓", x + 284, y, 20, 21, 900, "#000", "center");
    }
    drawLeavePdfText(context, option.label, x + 260, y + 2, 230, 17, 800, "#000");
  });
  y += 50;
  drawLeavePdfText(context, LEAVE_DOCUMENT_TEXT.decisionNote, right, y, 280, 15, 800, "#000");
  drawLeavePdfWrappedText(context, data.managerDecisionNote, right, y + 24, 620, 17, 600, 2, 25);

  drawLeavePdfText(context, LEAVE_DOCUMENT_TEXT.copyNote, right, canvas.height - 86, 500, 12, 600, "#000");

  const jpegBytes = await documentCanvasToJpegBytes(canvas);
  return buildPdfFromJpegPages(
    [{ bytes: jpegBytes, width: canvas.width, height: canvas.height }],
    LEAVE_PDF_A4_POINTS.width,
    LEAVE_PDF_A4_POINTS.height
  );
}
