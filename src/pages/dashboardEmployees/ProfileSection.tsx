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
