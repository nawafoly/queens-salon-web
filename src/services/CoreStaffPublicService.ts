// CORE D1 ONLY — do not add Firestore fallback.
import { coreApiRequest } from "./coreApiClient";

export type CorePublicAboutStaff = {
  id: string;
  name: string;
  bio?: string;
  avatarUrl?: string;
  cvUrl?: string;
  specialties: string[];
  active: boolean;
  showOnAbout: boolean;
  employmentEndDate?: string | null;
  rating?: number | null;
  reviewsCount?: number | null;
};

function mapRow(row: Record<string, unknown>): CorePublicAboutStaff {
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    bio: String(row.bio || ""),
    avatarUrl: String(row.avatarUrl || row.avatar_url || ""),
    cvUrl: String(row.cvUrl || row.cv_url || ""),
    specialties: Array.isArray(row.specialties)
      ? row.specialties.map((x) => String(x || "").trim()).filter(Boolean)
      : [],
    active: row.active !== false && Number(row.active) !== 0,
    showOnAbout: row.showOnAbout !== false && Number(row.show_on_about ?? 1) !== 0,
    employmentEndDate:
      row.employmentEndDate == null && row.employment_end_date == null
        ? null
        : String(row.employmentEndDate || row.employment_end_date || "") || null,
    rating: row.rating == null ? null : Number(row.rating),
    reviewsCount:
      row.reviewsCount == null && row.reviews_count == null
        ? null
        : Number(row.reviewsCount ?? row.reviews_count),
  };
}

export const CoreStaffPublicService = {
  async listAbout(): Promise<CorePublicAboutStaff[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/staff/public-about"
    );
    return (Array.isArray(rows) ? rows : []).map(mapRow);
  },
};
