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
