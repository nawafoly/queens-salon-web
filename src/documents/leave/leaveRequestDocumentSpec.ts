import type { LeaveRequestDocumentData } from "./leaveRequestModel";

export const LEAVE_DOCUMENT_TEXT = {
  greeting: "السلام عليكم ورحمة الله وبركاته،،",
  honored: "الموقرين",
  managerTitle: "رأي المدير الإداري",
  managerReview:
    "تمت مراجعة الطلب واتخاذ القرار الموضح أدناه وفق ظروف العمل والأنظمة المعتمدة.",
  decisionNote: "الملاحظات / القرار",
  copyNote: "نسخة محفوظة إلكترونيًا ضمن نظام طلبات الموظفات",
} as const;

export function leaveRequestLetterText(data: LeaveRequestDocumentData) {
  return `أتقدم لكم بطلبي هذا راجية الموافقة على منحي إجازة لمدة ${
    data.leaveDays || "___"
  } ${data.leaveDays === 1 ? "يوم" : "أيام"}، اعتبارًا من يوم ${
    data.fields[0]?.value
  } وحتى يوم ${data.fields[1]?.value}.`;
}

export function leaveRequestEmployeeFields(data: LeaveRequestDocumentData) {
  return [
    { label: "الاسم", value: data.employeeName },
    { label: "تاريخ التقديم", value: data.submittedAtLabel },
  ];
}

export function leaveRequestManagerFields(data: LeaveRequestDocumentData) {
  return [
    { label: "اسم المسؤول", value: data.managerName },
    { label: "الدور", value: data.managerRole },
    { label: "القرار", value: data.managerDecisionLabel },
    { label: "تاريخ القرار", value: data.managerDecidedAtLabel },
  ];
}

export function leaveRequestStructuredRows(data: LeaveRequestDocumentData) {
  return [
    ["بيانات الخطاب", "الجهة", data.addressee],
    ["بيانات الخطاب", "رقم الطلب", data.requestNumber],
    ["بيانات الموظفة", "اسم الموظفة", data.employeeName],
    ["بيانات الموظفة", "رقم الموظفة", data.employeeId],
    ["بيانات الإجازة", "نوع الإجازة", data.leaveTypeLabel],
    ["بيانات الإجازة", "من تاريخ", data.fields[0]?.value || "—"],
    ["بيانات الإجازة", "إلى تاريخ", data.fields[1]?.value || "—"],
    ["بيانات الإجازة", "عدد الأيام", data.leaveDays],
    ["بيانات الإجازة", "سبب الإجازة", data.reason],
    ["بيانات الإجازة", "ملاحظات الموظفة", data.notes],
    ["مقدم الطلب", "اسم مقدم الطلب", data.employeeName],
    ["مقدم الطلب", "تاريخ تقديم الطلب", data.submittedAtLabel],
    ["رأي المدير الإداري", "اسم المسؤول", data.managerName],
    ["رأي المدير الإداري", "الدور", data.managerRole],
    ["رأي المدير الإداري", "القرار", data.managerDecisionLabel],
    ["رأي المدير الإداري", "ملاحظات / القرار", data.managerDecisionNote],
    ["رأي المدير الإداري", "تاريخ القرار", data.managerDecidedAtLabel],
    ["اعتماد الطلب", "المعتمد", data.managerName],
    ["حالة الطلب", "الحالة التشغيلية", data.statusLabel],
  ] as const;
}
