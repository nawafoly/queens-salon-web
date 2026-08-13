from pathlib import Path
import base64
import re


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


worker = "workers/core/repositories/employee-requests.js"
replace_once(worker, "  exceptional_financial_payment: 'طلب صرف مالي استثنائي',", "  exceptional_financial_payment: 'طلب تعويض مالي بدل إجازة',")
replace_once(worker, "      balanceType: 'none',\n      deductAnnualLeave: false,", "      balanceType: 'annual_leave',\n      deductAnnualLeave: true,")
replace_once(
    worker,
    "    const annualLeaveBalanceSnapshot = Math.max(0, Number(employment.leave_balance || 0));\n    payload = {",
    "    const annualLeaveBalanceSnapshot = Math.max(0, Number(employment.leave_balance || 0));\n"
    "    if (annualLeaveBalanceSnapshot < Number(payload.requestedDays)) {\n"
    "      throw new AppError(409, 'core_employee_request:insufficient_annual_leave_balance');\n"
    "    }\n"
    "    payload = {",
)
replace_once(
    worker,
    "      balanceDeductionDays: 0,\n      calculationBasis: 'base_salary_divided_by_30',\n      payrollTreatment: 'manual_addition',\n      leaveBalanceTreatment: 'not_deducted',\n      legalTreatment: 'exceptional_payment_no_annual_leave_deduction',",
    "      balanceDeductionDays: Number(payload.requestedDays),\n      calculationBasis: 'base_salary_divided_by_30',\n      payrollTreatment: 'manual_addition',\n      leaveBalanceTreatment: 'deduct_on_execution',",
)

new_exec = base64.b64decode("YXN5bmMgZnVuY3Rpb24gZXhlY3V0ZUV4Y2VwdGlvbmFsRmluYW5jaWFsUGF5bWVudChkYiwgc2Fsb25JZCwgcm93LCBwYXlsb2FkLCBhY3RvciwgaW5wdXQpIHsKICBjb25zdCBwYXlyb2xsTW9udGggPSBjbGVhblRleHQoaW5wdXQucGF5cm9sbE1vbnRoKSB8fCByaXlhZGhEYXRlS2V5KCkuc2xpY2UoMCwgNyk7CiAgYWRkTW9udGhzKHBheXJvbGxNb250aCwgMCk7CiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYkZpcnN0KAogICAgZGIsCiAgICBgU0VMRUNUICogRlJPTSBlbXBsb3llZV9maW5hbmNpYWxfcGF5bWVudHMgV0hFUkUgc2Fsb25faWQgPSA/IEFORCByZXF1ZXN0X2lkID0gPyBMSU1JVCAxYCwKICAgIFtzYWxvbklkLCByb3cuaWRdCiAgKTsKICBpZiAoZXhpc3RpbmcpIHsKICAgIGF3YWl0IHJlZnJlc2hQYXlyb2xsRmluYW5jaWFscyhkYiwgc2Fsb25JZCwgcm93LmVtcGxveWVlX2lkLCBleGlzdGluZy5wYXlyb2xsX21vbnRoKTsKICAgIHJldHVybiB7IHNvdXJjZVR5cGU6ICdlbXBsb3llZV9maW5hbmNpYWxfcGF5bWVudCcsIHNvdXJjZUlkOiBleGlzdGluZy5pZCwgYmVmb3JlOiBudWxsLCBhZnRlcjogZXhpc3RpbmcgfTsKICB9CgogIGNvbnN0IHBheXJvbGxFbnRyeSA9IGF3YWl0IGRiRmlyc3QoCiAgICBkYiwKICAgIGBTRUxFQ1QgKiBGUk9NIHBheXJvbGxfZW50cmllcwogICAgICBXSEVSRSBzYWxvbl9pZCA9ID8gQU5EIGVtcGxveWVlX2lkID0gPyBBTkQgcGF5cm9sbF9tb250aCA9ID8KICAgICAgICBBTkQgQ09BTEVTQ0Uoc3RhdHVzLCAnZHJhZnQnKSBOT1QgSU4gKCdhcHByb3ZlZCcsICdwYWlkJykKICAgICAgTElNSVQgMWAsCiAgICBbc2Fsb25JZCwgcm93LmVtcGxveWVlX2lkLCBwYXlyb2xsTW9udGhdCiAgKTsKICBpZiAoIXBheXJvbGxFbnRyeSkgdGhyb3cgbmV3IEFwcEVycm9yKDQwOSwgJ2NvcmVfZW1wbG95ZWVfcmVxdWVzdDpwYXlyb2xsX2VudHJ5X3JlcXVpcmVkJyk7CgogIGNvbnN0IHJlcXVlc3RlZERheXMgPSBudW1iZXJJblJhbmdlKHBheWxvYWQucmVxdWVzdGVkRGF5cywgJ3JlcXVlc3RlZF9kYXlzJywgMC41LCA2MCk7CiAgY29uc3QgYmFzZVNhbGFyeUhhbGFsYXMgPSBwb3NpdGl2ZUludGVnZXIocGF5bG9hZC5iYXNlU2FsYXJ5SGFsYWxhcywgJ2Jhc2Vfc2FsYXJ5JywgMTAwXzAwMF8wMDApOwogIGNvbnN0IGRheVJhdGVIYWxhbGFzID0gcG9zaXRpdmVJbnRlZ2VyKHBheWxvYWQuZGF5UmF0ZUhhbGFsYXMsICdkYXlfcmF0ZScsIDEwXzAwMF8wMDApOwogIGNvbnN0IGFtb3VudEhhbGFsYXMgPSBwb3NpdGl2ZUludGVnZXIocGF5bG9hZC5jYWxjdWxhdGVkQW1vdW50SGFsYWxhcywgJ2NhbGN1bGF0ZWRfYW1vdW50JywgMTAwXzAwMF8wMDApOwogIGNvbnN0IGZpbmFuY2lhbFJlZmVyZW5jZSA9IGNsZWFuVGV4dChpbnB1dC5maW5hbmNpYWxSZWZlcmVuY2UpIHx8IGBFRlAte3Jvdy5yZXF1ZXN0X251bWJlcn1gOwogIGNvbnN0IG5vdyA9IG5vd0lzbygpOwogIGNvbnN0IHBheW1lbnRJZCA9IGdlbmVyYXRlZElkKCdmaW5hbmNpYWxfcGF5bWVudCcpOwoKICBjb25zdCBlbXBsb3ltZW50ID0gYXdhaXQgZGJGaXJzdCgKICAgIGRiLAogICAgYFNFTEVDVCBsZWF2ZV9iYWxhbmNlIEZST00gZW1wbG95ZWVfZW1wbG95bWVudAogICAgICBXSEVSRSBzYWxvbl9pZCA9ID8gQU5EIGVtcGxveWVlX2lkID0gPyBMSU1JVCAxYCwKICAgIFtzYWxvbklkLCByb3cuZW1wbG95ZWVfaWRdCiAgKTsKICBjb25zdCBsZWF2ZUJhbGFuY2VCZWZvcmUgPSBOdW1iZXIoZW1wbG95bWVudD8ubGVhdmVfYmFsYW5jZSk7CiAgaWYgKCFlbXBsb3ltZW50IHx8ICFOdW1iZXIuaXNGaW5pdGUobGVhdmVCYWxhbmNlQmVmb3JlKSB8fCBsZWF2ZUJhbGFuY2VCZWZvcmUgPCByZXF1ZXN0ZWREYXlzKSB7CiAgICB0aHJvdyBuZXcgQXBwRXJyb3IoNDA5LCAnY29yZV9lbXBsb3llZV9yZXF1ZXN0Omluc3VmZmljaWVudF9hbm51YWxfbGVhdmVfYmFsYW5jZScpOwogIH0KICBjb25zdCBsZWF2ZUJhbGFuY2VBZnRlciA9IGxlYXZlQmFsYW5jZUJlZm9yZSAtIHJlcXVlc3RlZERheXM7CgogIGNvbnN0IHBhcnNlZEFkZGl0aW9ucyA9IHBhcnNlSnNvbihwYXlyb2xsRW50cnkuYWRkaXRpb25zX2pzb24sIFtdKTsKICBjb25zdCBhZGRpdGlvbnMgPSBBcnJheS5pc0FycmF5KHBhcnNlZEFkZGl0aW9ucykgPyBwYXJzZWRBZGRpdGlvbnMgOiBbXTsKICBjb25zdCBhbHJlYWR5SW5jbHVkZWQgPSBhZGRpdGlvbnMuc29tZSgoaXRlbSkgPT4KICAgIGNsZWFuVGV4dChpdGVtPy5yZXF1ZXN0SWQgfHwgaXRlbT8ucmVxdWVzdF9pZCkgPT09IGNsZWFuVGV4dChyb3cuaWQpCiAgKTsKICBjb25zdCBuZXh0QWRkaXRpb25zID0gYWxyZWFkeUluY2x1ZGVkID8gYWRkaXRpb25zIDogWwogICAgLi4uYWRkaXRpb25zLAogICAgewogICAgICBpZDogYGVtcGxveWVlX2ZpbmFuY2lhbF9wYXltZW50OiR7cm93LmlkfWAsCiAgICAgIHR5cGU6ICdleGNlcHRpb25hbF9maW5hbmNpYWxfcGF5bWVudCcsCiAgICAgIGxhYmVsOiAn2KrYudmI2YrYtiDZhdin2YTZiiDYqNiv2YQg2KXYrNin2LLYqScsCiAgICAgIHJlcXVlc3RJZDogcm93LmlkLAogICAgICByZXF1ZXN0TnVtYmVyOiByb3cucmVxdWVzdF9udW1iZXIsCiAgICAgIGFtb3VudEhhbGFsYXMsCiAgICAgIHJlcXVlc3RlZERheXMsCiAgICAgIGZpbmFuY2lhbFJlZmVyZW5jZSwKICAgIH0sCiAgXTsKICBjb25zdCBuZXh0TWFudWFsQWRkaXRpb25zID0gTnVtYmVyKHBheXJvbGxFbnRyeS5tYW51YWxfYWRkaXRpb25zX2hhbGFsYXMgfHwgMCkgKyAoYWxyZWFkeUluY2x1ZGVkID8gMCA6IGFtb3VudEhhbGFsYXMpOwoKICBjb25zdCBiYXRjaFJlc3VsdHMgPSBhd2FpdCBkYkJhdGNoKGRiLCBbCiAgICB7CiAgICAgIHNxbDogYElOU0VSVCBPUiBJR05PUkUgSU5UTyBlbXBsb3llZV9maW5hbmNpYWxfcGF5bWVudHMKICAgICAgICAoaWQsIHNhbG9uX2lkLCByZXF1ZXN0X2lkLCByZXF1ZXN0X251bWJlciwgZW1wbG95ZWVfaWQsIGVtcGxveWVlX3VpZCwKICAgICAgICAgcmVxdWVzdGVkX2RheXMsIGJhc2Vfc2FsYXJ5X2hhbGFsYXMsIGRheV9yYXRlX2hhbGFsYXMsIGFtb3VudF9oYWxhbGFzLAogICAgICAgICBwYXlyb2xsX21vbnRoLCBwYXlyb2xsX2VudHJ5X2lkLCBmaW5hbmNpYWxfcmVmZXJlbmNlLCBwYXltZW50X3N0YXR1cywKICAgICAgICAgbGVhdmVfYmFsYW5jZV9kZWR1Y3RlZCwgYXBwcm92ZWRfYnlfdWlkLCBhcHByb3ZlZF9hdCwgZXhlY3V0ZWRfYnlfdWlkLAogICAgICAgICBleGVjdXRlZF9hdCwgY3JlYXRlZF9hdCwgdXBkYXRlZF9hdCkKICAgICAgIFNFTEVDVCA/LCB/LCB/LCB/LCB/LCB/LCB/LCB/LCB/LCB/LCB/LCB/LCB/LCAnaW5jbHVkZWQnLCA/LCB/LCB/LCB/LCB/LCB/LCB/CiAgICAgICBGUk9NIGVtcGxveWVlX2VtcGxveW1lbnQKICAgICAgIFdIRVJFIHNhbG9uX2lkID0gPyBBTkQgZW1wbG95ZWVfaWQgPSA/IEFORCBsZWF2ZV9iYWxhbmNlID49ID9gLAogICAgICBwYXJhbXM6IFsKICAgICAgICBwYXltZW50SWQsIHNhbG9uSWQsIHJvdy5pZCwgcm93LnJlcXVlc3RfbnVtYmVyLCByb3cuZW1wbG95ZWVfaWQsIHJvdy5lbXBsb3llZV91aWQsCiAgICAgICAgcmVxdWVzdGVkRGF5cywgYmFzZVNhbGFyeUhhbGFsYXMsIGRheVJhdGVIYWxhbGFzLCBhbW91bnRIYWxhbGFzLAogICAgICAgIHBheXJvbGxNb250aCwgcGF5cm9sbEVudHJ5LmlkLCBmaW5hbmNpYWxSZWZlcmVuY2UsIHJlcXVlc3RlZERheXMsCiAgICAgICAgY2xlYW5UZXh0KHJvdy5kZWNpZGVkX2J5X3VpZCkgfHwgbnVsbCwgcm93LmFwcHJvdmVkX2F0IHx8IG5vdywKICAgICAgICBjbGVhblRleHQoYWN0b3IudWlkKSB8fCBudWxsLCBub3csIG5vdywgbm93LAogICAgICAgIHNhbG9uSWQsIHJvdy5lbXBsb3llZV9pZCwgcmVxdWVzdGVkRGF5cywKICAgICAgXSwKICAgIH0sCiAgICB7CiAgICAgIHNxbDogYFVQREFURSBwYXlyb2xsX2VudHJpZXMKICAgICAgICAgICAgICBTRVQgbWFudWFsX2FkZGl0aW9uc19oYWxhbGFzID0gPywgYWRkaXRpb25zX2pzb24gPSA/LCB1cGRhdGVkX2F0ID0gPwogICAgICAgICAgICBXSEVSRSBzYWxvbl9pZCA9ID8gQU5EIGlkID0gPwogICAgICAgICAgICAgIEFORCBDT0FMRVNDRShzdGF0dXMsICdkcmFmdCcpIE5PVCBJTiAoJ2FwcHJvdmVkJywgJ3BhaWQnKQogICAgICAgICAgICAgIEFORCBFWElTVFMgKAogICAgICAgICAgICAgICAgU0VMRUNUIDEgRlJPTSBlbXBsb3llZV9maW5hbmNpYWxfcGF5bWVudHMKICAgICAgICAgICAgICAgIFdIRVJFIHNhbG9uX2lkID0gPyBBTkQgcmVxdWVzdF9pZCA9ID8KICAgICAgICAgICAgICApYCwKICAgICAgcGFyYW1zOiBbCiAgICAgICAgbmV4dE1hbnVhbEFkZGl0aW9ucywganNvbihuZXh0QWRkaXRpb25zKSwgbm93LCBzYWxvbklkLCBwYXlyb2xsRW50cnkuaWQsCiAgICAgICAgc2Fsb25JZCwgcm93LmlkLAogICAgICBdLAogICAgfSwKICAgIHsKICAgICAgc3FsOiBgVVBEQVRFIGVtcGxveWVlX2VtcGxveW1lbnQKICAgICAgICAgICAgICBTRVQgbGVhdmVfYmFsYW5jZSA9IGxlYXZlX2JhbGFuY2UgLSA/LCB1cGRhdGVkX2F0ID0gPywKICAgICAgICAgICAgICAgICAgdXBkYXRlZF9ieV91aWQgPSA/LCB1cGRhdGVkX2J5X2VtYWlsID0gPwogICAgICAgICAgICBXSEVSRSBzYWxvbl9pZCA9ID8gQU5EIGVtcGxveWVlX2lkID0gPyBBTkQgbGVhdmVfYmFsYW5jZSA+PSA/CiAgICAgICAgICAgICAgQU5EIEVYSVNUUyAoCiAgICAgICAgICAgICAgICBTRUxFQ1QgMSBGUk9NIGVtcGxveWVlX2ZpbmFuY2lhbF9wYXltZW50cwogICAgICAgICAgICAgICAgV0hFUkUgc2Fsb25faWQgPSA/IEFORCByZXF1ZXN0X2lkID0gPwogICAgICAgICAgICAgIClgLAogICAgICBwYXJhbXM6IFsKICAgICAgICByZXF1ZXN0ZWREYXlzLCBub3csIGNsZWFuVGV4dChhY3Rvci51aWQpIHx8IG51bGwsIGNsZWFuVGV4dChhY3Rvci5lbWFpbCkgfHwgbnVsbCwKICAgICAgICBzYWxvbklkLCByb3cuZW1wbG95ZWVfaWQsIHJlcXVlc3RlZERheXMsIHNhbG9uSWQsIHJvdy5pZCwKICAgICAgXSwKICAgIH0sCiAgXSk7CgogIGNvbnN0IHN0b3JlZCA9IGF3YWl0IGRiRmlyc3QoCiAgICBkYiwKICAgIGBTRUxFQ1QgKiBGUk9NIGVtcGxveWVlX2ZpbmFuY2lhbF9wYXltZW50cyBXSEVSRSBzYWxvbl9pZCA9ID8gQU5EIHJlcXVlc3RfaWQgPSA/IExJTUlUIDFgLAogICAgW3NhbG9uSWQsIHJvdy5pZF0KICApOwogIGlmICghc3RvcmVkIHx8IGNoYW5nZXMoYmF0Y2hSZXN1bHRzPy5bMl0pICE9PSAxKSB7CiAgICB0aHJvdyBuZXcgQXBwRXJyb3IoNDA5LCAnY29yZV9lbXBsb3llZV9yZXF1ZXN0Omluc3VmZmljaWVudF9hbm51YWxfbGVhdmVfYmFsYW5jZScpOwogIH0KCiAgY29uc3QgcGF5cm9sbEVudHJ5SWQgPSBhd2FpdCByZWZyZXNoUGF5cm9sbEZpbmFuY2lhbHMoZGIsIHNhbG9uSWQsIHJvdy5lbXBsb3llZV9pZCwgcGF5cm9sbE1vbnRoKTsKICBpZiAoIXBheXJvbGxFbnRyeUlkKSB0aHJvdyBuZXcgQXBwRXJyb3IoNDA5LCAnY29yZV9lbXBsb3llZV9yZXF1ZXN0OnBheXJvbGxfZW50cnlfcmVxdWlyZWQnKTsKICByZXR1cm4gewogICAgc291cmNlVHlwZTogJ2VtcGxveWVlX2ZpbmFuY2lhbF9wYXltZW50JywKICAgIHNvdXJjZUlkOiBzdG9yZWQuaWQgfHwgcGF5bWVudElkLAogICAgYmVmb3JlOiB7IGxlYXZlQmFsYW5jZTogbGVhdmVCYWxhbmNlQmVmb3JlIH0sCiAgICBhZnRlcjogewogICAgICAuLi5zdG9yZWQsCiAgICAgIHBheXJvbGxFbnRyeUlkLAogICAgICBsZWF2ZUJhbGFuY2VCZWZvcmUsCiAgICAgIGxlYXZlQmFsYW5jZUFmdGVyLAogICAgICBsZWF2ZUJhbGFuY2VEZHVjdGVkOiByZXF1ZXN0ZWREYXlzLAogICAgfSwKICB9Owp9Cg==").decode("utf-8")
text = read(worker)
pattern = re.compile(r"async function executeExceptionalFinancialPayment\(db, salonId, row, payload, actor, input\) \{[\s\S]*?\n\}\n\nasync function executeSalaryAdvance")
text, count = pattern.subn(new_exec + "\nasync function executeSalaryAdvance", text, count=1)
if count != 1:
    raise SystemExit(f"Failed to replace executeExceptionalFinancialPayment; count={count}")
write(worker, text)

service = "src/services/employeeRequests.ts"
replace_once(service, '  exceptional_financial_payment: "طلب صرف مالي استثنائي",', '  exceptional_financial_payment: "طلب تعويض مالي بدل إجازة",')
replace_once(service, '  "core_employee_request:invalid_requested_days": "عدد الأيام المرجعية يجب أن يكون بين نصف يوم و60 يومًا وبزيادات نصف يوم.",', '  "core_employee_request:invalid_requested_days": "عدد أيام الإجازة المطلوب تعويضها يجب أن يكون بين نصف يوم و60 يومًا وبزيادات نصف يوم.",')
replace_once(service, '  "core_employee_request:employee_salary_required": "لا يمكن حساب الصرف لأن الراتب الأساسي غير مسجل في ملف الموظفة داخل Core.",', '  "core_employee_request:employee_salary_required": "لا يمكن حساب التعويض لأن الراتب الأساسي غير مسجل في ملف الموظفة داخل Core.",\n  "core_employee_request:insufficient_annual_leave_balance": "رصيد الإجازة السنوية لا يغطي عدد الأيام المطلوب تعويضها. لم يتم تنفيذ أي صرف أو خصم.",')

portal = "src/pages/EmployeePortal.tsx"
replace_once(portal, '{ label: "طلب صرف مالي استثنائي", description: "صرف مالي حسب عدد الأيام المرجعية", icon: faWallet, to: "/employee/requests?new=exceptional_financial_payment", permission: "employee_requests.own.create" as AppPermission },', '{ label: "تعويض مالي بدل إجازة", description: "صرف قيمة أيام من رصيد الإجازة", icon: faWallet, to: "/employee/requests?new=exceptional_financial_payment", permission: "employee_requests.own.create" as AppPermission },')

employee_requests = "src/pages/hr/EmployeeRequests.tsx"
replace_once(employee_requests, 'throw new Error("حدد عدد الأيام المرجعية من 0.5 إلى 60 وبزيادات نصف يوم.");', 'throw new Error("حدد عدد أيام الإجازة المطلوب تعويضها من 0.5 إلى 60 وبزيادات نصف يوم.");')

admin_requests = "src/pages/hr/AdminEmployeeRequests.tsx"
replace_once(admin_requests, '  requestedDays: "عدد الأيام المرجعية",', '  requestedDays: "عدد أيام الإجازة المطلوب تعويضها",')

tests = "workers/hr-core-worker.test.mjs"
replace_once(tests, "test('exceptional financial payment snapshots salary, adds payroll money, and never deducts annual leave', async (t) => {", "test('annual leave cash compensation pays daily value and deducts the same leave days', async (t) => {")
replace_once(tests, "  assert.equal(request.payload.balanceDeductionDays, 0);", "  assert.equal(request.payload.balanceDeductionDays, 3);")
replace_once(tests, "  assert.equal(request.payload.leaveBalanceTreatment, 'not_deducted');", "  assert.equal(request.payload.leaveBalanceTreatment, 'deduct_on_execution');")
replace_once(tests, "  assert.equal(after.leave_balance, 21);", "  assert.equal(after.leave_balance, 18);")
replace_once(tests, "  assert.equal(payment.leave_balance_deducted, 0);", "  assert.equal(payment.leave_balance_deducted, 3);")

anchor = "test('exceptional financial payment execution fails closed when payroll entry is missing', async (t) => {"
text = read(tests)
if anchor not in text:
    raise SystemExit("Missing test insertion anchor")
extra = r'''
test('annual leave cash compensation rejects days above available annual leave balance', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, active, employment_status, created_at, updated_at)
    VALUES ('emp-low-balance','main','uid-low-balance','Low Balance',1,'active','2026-01-01','2026-01-01')`).run();
  await upsertHrEmployee(db, 'main', {
    id: 'emp-low-balance', name: 'Low Balance', firebaseUid: 'uid-low-balance',
    employment: { baseSalaryHalalas: 300000, leaveBalance: 2 },
  }, actor);
  const employeeActor = { uid: 'uid-low-balance', employeeId: 'emp-low-balance', name: 'Low Balance', role: 'employee' };
  await assert.rejects(
    () => createEmployeeRequest(db, 'main', {
      requestType: 'exceptional_financial_payment',
      payload: {
        requestedDays: 3,
        reason: 'اختبار رصيد غير كاف',
        acknowledgement: true,
        employeeSignatureDataUrl: `data:image/png;base64,${'d'.repeat(300)}`,
      },
      idempotencyKey: 'financial-payment-low-balance',
    }, employeeActor),
    { code: 'core_employee_request:insufficient_annual_leave_balance' }
  );
  const balance = await db.prepare("SELECT leave_balance FROM employee_employment WHERE salon_id='main' AND employee_id='emp-low-balance'").first();
  assert.equal(balance.leave_balance, 2);
  const payments = await db.prepare("SELECT COUNT(*) AS count FROM employee_financial_payments WHERE salon_id='main' AND employee_id='emp-low-balance'").first();
  assert.equal(payments.count, 0);
});

'''
write(tests, text.replace(anchor, extra + anchor, 1))

assert "leave_balance = leave_balance - ?" in read(worker)
assert "leaveBalanceDeducted: requestedDays" in read(worker)
assert "balanceDeductionDays: Number(payload.requestedDays)" in read(worker)
