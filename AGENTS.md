# Repository implementation guardrails

## Dashboard V2 UI contract

These rules are mandatory for work on Dashboard V2, including `/dashboard/employees` and any component/style under `src/components/dashboard-v2/` or `src/styles/dashboard-v2/`.

1. **Dashboard V2 is the visual source of truth.** New controls, dialogs, filters, pickers, cards, actions, and states must look and behave like the existing Dashboard V2 design system without requiring the requester to repeat that requirement.
2. **Reuse V2 primitives first.** Prefer existing `Dashboard*V2` and `Workspace*V2` components and existing Dashboard V2 CSS variables/tokens before creating a new primitive.
3. **Do not directly introduce browser-native popup UI into a V2 feature.** In feature components, do not use native month/date picker popups such as direct `<input type="month">` + `showPicker()` when the result bypasses Dashboard V2 styling. Use an existing V2 picker or a controlled V2-styled popover/drawer instead.
4. **Do not fall back to legacy Dashboard styling/components** when editing a V2 page unless the legacy component is intentionally wrapped behind the V2 adapter and its visible UI remains V2.
5. **Preserve architecture and business logic.** A visual migration must not change Firebase/Auth/Core/D1 ownership or HR/payroll/attendance rules unless the task explicitly requires a logic change.
6. **Keep changes scoped.** Do not modify already-finished Dashboard V2 pages merely to satisfy unrelated checkers.
7. **Responsive behavior is part of completion.** New V2 UI must work on desktop and mobile widths and must not introduce horizontal overflow or clipped popovers/drawers.
8. **Verify before declaring completion.** Run the relevant focused tests plus `npm run build`; UI work still requires visual review before its issue checkbox is considered complete.

### Attendance month picker regression guard

`workers/dashboard-v2-attendance-month-picker-policy.test.mjs` protects the attendance calendar from regressing to a browser-native month picker. Keep this test passing when changing attendance calendar controls.
