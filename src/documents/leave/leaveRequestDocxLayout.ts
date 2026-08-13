import { DOCUMENT_BRANDING } from "../core/documentBranding";
import type { DocumentExportImage } from "../core/documentExportAssets";
import type {
  LeaveRequestDocumentData,
  LeaveRequestDocumentSignature,
} from "./leaveRequestModel";
import {
  LEAVE_DOCUMENT_TEXT,
  leaveRequestLetterText,
} from "./leaveRequestDocumentSpec";
import {
  docxCell,
  docxEmpty,
  docxField,
  docxImage,
  docxParagraph,
  docxTable,
} from "../core/documentDocxPrimitives";

export type LeaveDocxAssets = {
  logo: DocumentExportImage | null;
  employee: DocumentExportImage | null;
  manager: DocumentExportImage | null;
};

function signatureBlock(
  signature: LeaveRequestDocumentSignature,
  asset: DocumentExportImage | null,
  relId: string,
  id: number
) {
  return `${docxParagraph(signature.label, {
    size: 17,
    bold: true,
    after: 15,
  })}${docxImage(asset, relId, signature.fallback, {
    maxWidth: 1500000,
    maxHeight: 480000,
    id,
  })}${signature.signedAt ? docxParagraph(signature.signedAt, {
    size: 15,
    after: 0,
  }) : ""}`;
}

function headerBlock(data: LeaveRequestDocumentData, logo: DocumentExportImage | null) {
  const top = `<w:tr>${docxCell(docxImage(logo, "rIdLogo", DOCUMENT_BRANDING.salonName, {
    align: "left",
    maxWidth: 1800000,
    maxHeight: 700000,
    id: 10,
  }), 2900)}${docxCell(docxParagraph(data.title, {
    bold: true,
    size: 36,
    align: "center",
    after: 0,
  }), 3200)}${docxCell(docxEmpty(0), 2900)}</w:tr>`;
  const rule = `<w:tr>${docxCell(docxEmpty(0), 9000, true)}</w:tr>`;
  return docxTable([top, rule], [2900, 3200, 2900], 90);
}

function leaveTypeBlock(data: LeaveRequestDocumentData) {
  const cells = data.leaveTypeOptions.map((option) =>
    docxCell(docxParagraph(`${option.checked ? "☑" : "☐"} ${option.label}`, {
      bold: true,
      size: 20,
      align: "center",
      after: 0,
    }), 3000)
  );
  return docxTable([`<w:tr>${cells.join("")}</w:tr>`], [3000, 3000, 3000], 75, true);
}

function fieldGrid(data: LeaveRequestDocumentData) {
  const fields = data.fields;
  return docxTable([
    `<w:tr>${docxCell(docxField(fields[1]?.label || "", fields[1]?.value || ""), 4500)}${docxCell(docxField(fields[0]?.label || "", fields[0]?.value || ""), 4500)}</w:tr>`,
    `<w:tr>${docxCell(docxField(fields[3]?.label || "", fields[3]?.value || ""), 4500)}${docxCell(docxField(fields[2]?.label || "", fields[2]?.value || ""), 4500)}</w:tr>`,
  ], [4500, 4500], 65);
}

function employeeSignatureRow(
  data: LeaveRequestDocumentData,
  asset: DocumentExportImage | null
) {
  return docxTable([
    `<w:tr>${docxCell(signatureBlock(data.employeeSignature, asset, "rIdEmployeeSignature", 20), 4500)}${docxCell(docxField("الاسم", data.employeeName), 4500)}</w:tr>`,
  ], [4500, 4500], 85);
}

function managerGrid(
  data: LeaveRequestDocumentData,
  asset: DocumentExportImage | null
) {
  return docxTable([
    `<w:tr>${docxCell(docxField("الدور", data.managerRole), 4500)}${docxCell(docxField("اسم المسؤول", data.managerName), 4500)}</w:tr>`,
    `<w:tr>${docxCell(signatureBlock(data.managerSignature, asset, "rIdManagerSignature", 30), 4500)}${docxCell(`${docxField("القرار", data.managerDecisionLabel)}${docxParagraph(`تاريخ القرار: ${data.managerDecidedAtLabel}`, {
      size: 15,
      after: 0,
    })}`, 4500)}</w:tr>`,
  ], [4500, 4500], 60);
}

function decisionBlock(data: LeaveRequestDocumentData) {
  const approved = data.managerDecisionOptions.find((item) => item.value === "approved");
  const other = data.managerDecisionOptions.find((item) => item.value === "other");
  return docxTable([
    `<w:tr>${docxCell(docxParagraph(`${other?.checked ? "☑" : "☐"} ${other?.label || "أخرى"}`, {
      bold: true,
      size: 20,
      align: "center",
      after: 0,
    }), 4500)}${docxCell(docxParagraph(`${approved?.checked ? "☑" : "☐"} ${approved?.label || "مع الموافقة"}`, {
      bold: true,
      size: 20,
      align: "center",
      after: 0,
    }), 4500)}</w:tr>`,
  ], [4500, 4500], 30);
}

export function leaveRequestDocxBody(data: LeaveRequestDocumentData, assets: LeaveDocxAssets) {
  return [
    headerBlock(data, assets.logo),
    docxParagraph(`رقم الطلب: ${data.requestNumber}`, { bold: true, size: 20, after: 75 }),
    leaveTypeBlock(data),
    docxParagraph(data.addressee, { bold: true, size: 21, after: 25 }),
    docxParagraph(LEAVE_DOCUMENT_TEXT.honored, { bold: true, size: 20, after: 20 }),
    docxParagraph(LEAVE_DOCUMENT_TEXT.greeting, { bold: true, size: 20, after: 35 }),
    docxParagraph(leaveRequestLetterText(data), { size: 21, after: 70 }),
    fieldGrid(data),
    docxParagraph("سبب الإجازة", { bold: true, size: 17, after: 15 }),
    docxParagraph(data.reason, { size: 20, after: 25, underline: true }),
    data.notes !== "—"
      ? `${docxParagraph("ملاحظات", { bold: true, size: 17, after: 15 })}${docxParagraph(data.notes, { size: 20, after: 25, underline: true })}`
      : "",
    employeeSignatureRow(data, assets.employee),
    docxParagraph(LEAVE_DOCUMENT_TEXT.managerTitle, { bold: true, size: 25, after: 25 }),
    docxParagraph(LEAVE_DOCUMENT_TEXT.managerReview, { bold: true, size: 19, after: 55 }),
    managerGrid(data, assets.manager),
    decisionBlock(data),
    docxParagraph(LEAVE_DOCUMENT_TEXT.decisionNote, { bold: true, size: 17, after: 15 }),
    docxParagraph(data.managerDecisionNote, { size: 20, after: 10, underline: true }),
  ].join("");
}
