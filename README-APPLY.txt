Queens Salon - Employee Profile Layout Fix

Files included:
- src/pages/DashboardEmployees.tsx
- src/pages/dashboardEmployees/EmployeeProfilePageLayout.tsx
- src/styles/AdminHrEmployeeProfilePage.css

PowerShell from project folder:

cd C:\Users\nawaf\Downloads\queens-salon-web

Expand-Archive `
  "$env:USERPROFILE\Downloads\queens-salon-employee-profile-fix.zip" `
  -DestinationPath . `
  -Force

npm run dev

After verification:

git add -- `
  src/pages/DashboardEmployees.tsx `
  src/pages/dashboardEmployees/EmployeeProfilePageLayout.tsx `
  src/styles/AdminHrEmployeeProfilePage.css

git commit -m "fix: rebuild standalone employee profile layout"
