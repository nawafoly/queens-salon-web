import type { EmployeeRequest } from "../../services/employeeRequests";
import { DOCUMENT_BRANDING } from "../core/documentBranding";
import { buildDocumentExportPng } from "../core/documentExportAssets";
import type { DocumentExportImage } from "../core/documentExportAssets";
import {
  docxRun,
  documentDocxSettingsXml,
  documentDocxStylesXml,
} from "../core/documentDocxPrimitives";
import { zipStore, xmlEscape } from "../core/officeZip";
import { buildLeaveRequestDocumentData } from "./leaveRequestModel";
import { LEAVE_DOCUMENT_TEXT } from "./leaveRequestDocumentSpec";
import { leaveRequestDocxBody } from "./leaveRequestDocxLayout";

const PAGE = { width: 11906, height: 16838, top: 620, right: 680, bottom: 620, left: 680 };

type NamedImage = DocumentExportImage & {
  id: "logo" | "employee" | "manager";
  fileName: string;
};

function namedImage(
  image: DocumentExportImage | null,
  id: NamedImage["id"]
): NamedImage | null {
  return image ? { ...image, id, fileName: `${id}.png` } : null;
}

function documentXml(body: string, hasLogo: boolean) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr>${hasLogo ? '<w:headerReference w:type="default" r:id="rIdHeader1"/>' : ""}<w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/><w:pgMar w:top="${PAGE.top}" w:right="${PAGE.right}" w:bottom="${PAGE.bottom}" w:left="${PAGE.left}" w:header="300" w:footer="300" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>`;
}

function footerXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>${docxRun(LEAVE_DOCUMENT_TEXT.copyNote, { size: 15, color: "777777" })}</w:p></w:ftr>`;
}
