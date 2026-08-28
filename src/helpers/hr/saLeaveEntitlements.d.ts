export const SA_LEAVE_TYPES: Readonly<{
  annual: 'annual';
  sick: 'sick';
  unpaid: 'unpaid';
  marriage: 'marriage';
  bereavementSpouseAscendantDescendant: 'bereavement_spouse_ascendant_descendant';
  bereavementSibling: 'bereavement_sibling';
  newborn: 'newborn';
  hajj: 'hajj';
  exam: 'exam';
  maternity: 'maternity';
  childMedicalCare: 'child_medical_care';
  widowMuslim: 'widow_muslim';
  widowNonMuslim: 'widow_non_muslim';
  overtimeCompTimeUse: 'overtime_comp_time_use';
  weeklyRestSubstituteUse: 'weekly_rest_substitute_use';
  otherHrReview: 'other_hr_review';
}>;

export function normalizeSaLeaveType(value: unknown): string;
export function getSaLeaveTypePolicy(value: unknown): Record<string, unknown>;
export function completedServiceYears(startDate: string, asOfDate: string): number;
export function annualLeaveStatutoryMinimumDays(startDate: string, asOfDate: string): number;
export function annualLeaveServiceYear(startDate: string, asOfDate: string): {
  serviceYearStart: string;
  serviceYearEnd: string;
  completedServiceYearsAtStart: number;
};
export function calculateAnnualLeaveAccrual(input: {
  startDate: string;
  asOfDate: string;
  contractAnnualDays?: number | null;
}): Record<string, unknown>;
export function calculateAnnualLeaveAvailable(input: {
  startDate: string;
  asOfDate: string;
  contractAnnualDays?: number | null;
  persistedNetDays?: number | null;
}): Record<string, unknown>;
export function calculateSickLeaveSegments(input: {
  usedDaysBefore?: number;
  requestedDays: number;
}): Array<{
  ordinalFrom: number;
  ordinalTo: number;
  days: number;
  payRateBps: number;
  reviewRequired: boolean;
}>;
