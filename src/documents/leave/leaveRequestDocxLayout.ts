import type { DocumentExportImage } from "../core/documentExportAssets";
import type {
  LeaveRequestDocumentData,
  LeaveRequestDocumentSignature,
} from "./leaveRequestModel";
import {
  docxCell,
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
    color: "555555",
    after: 15,
  })}${docxImage(asset, relId, signature.fallback, {
    maxWidth: 1500000,
    maxHeight: 480000,
    id,
  })}${signature.signedAt ? docxParagraph(signature.signedAt, {
    size: 15,
    color: "666666",
    after: 0,
  }) : ""}`;
}

export function leaveDocxEmployeeSignatureRow(
  data: LeaveRequestDocumentData,
  asset: DocumentExportImage | null
) {
  return docxTable([
    `<w:tr>${docxCell(signatureBlock(data.employeeSignature, asset, "rIdEmployeeSignature", 20), 4500, true)}${docxCell(docxField("الاسم", data.employeeName), 4500, true)}</w:tr>`,
  ], [4500, 4500], 85);
}
