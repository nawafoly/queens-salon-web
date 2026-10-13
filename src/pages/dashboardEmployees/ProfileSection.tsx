import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { readEmployeeOnboardingDraft } from "../../services/employeeOnboardingDraft";
import { EmployeeProfileTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";
import type { CoreEmployeeProfilePhoto } from "../../services/employeeProfilePhotoCore";

type ProfileSectionProps = {
  isVisible: boolean;
  employeeName: string;
  avatarUrl: string;
  bio: string;
  cvUrl: string;
  rating: string;
  reviewsCount: string;
  profilePhotoBusy: boolean;
  profilePhotos: CoreEmployeeProfilePhoto[];
  photoManagementEnabled: boolean;
  resolveAvatarFromAssets: (raw: string) => string;
  onProfilePhotoChange: (file: File) => void | Promise<void>;
  onProfilePhotoRemove: () => void | Promise<void>;
  onBioChange: (value: string) => void;
  onCvUrlChange: (value: string) => void;
  onRatingChange: (value: string) => void;
  onReviewsCountChange: (value: string) => void;
};

export default function ProfileSection({
  isVisible,
  employeeName,
  avatarUrl,
  bio,
  cvUrl,
  rating,
  reviewsCount,
  profilePhotoBusy,
  profilePhotos,
  photoManagementEnabled,
  resolveAvatarFromAssets,
  onProfilePhotoChange,
  onProfilePhotoRemove,
  onBioChange,
  onCvUrlChange,
  onRatingChange,
  onReviewsCountChange,
}: ProfileSectionProps) {
  const location = useLocation();
  const recruitmentDraftRef = useRef("");

  useEffect(() => {
    if (!isVisible) return;
    const params = new URLSearchParams(location.search);
    if (params.get("create") !== "1") return;
    const applicationId = String(params.get("applicationId") || "").trim();
    if (!applicationId || recruitmentDraftRef.current === applicationId) return;
    const draft = readEmployeeOnboardingDraft(applicationId);
    if (!draft) return;
    recruitmentDraftRef.current = applicationId;
    onBioChange(draft.bio);
  }, [isVisible, location.search, onBioChange]);

  if (!isVisible) return null;

  return (
    <EmployeeProfileTabLiveV2
      readOnly={false}
      employeeName={employeeName}
      avatarUrl={avatarUrl}
      bio={bio}
      cvUrl={cvUrl}
      rating={rating}
      reviewsCount={reviewsCount}
      profilePhotoBusy={profilePhotoBusy}
      profilePhotos={profilePhotos}
      photoManagementEnabled={photoManagementEnabled}
      resolveAvatarFromAssets={resolveAvatarFromAssets}
      onProfilePhotoChange={onProfilePhotoChange}
      onProfilePhotoRemove={onProfilePhotoRemove}
      onBioChange={onBioChange}
      onCvUrlChange={onCvUrlChange}
      onRatingChange={onRatingChange}
      onReviewsCountChange={onReviewsCountChange}
    />
  );
}
