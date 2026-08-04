import { EmployeeProfileTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";

type ProfileSectionProps = {
  isVisible: boolean;
  avatarUrl: string;
  bio: string;
  cvUrl: string;
  rating: string;
  reviewsCount: string;
  staffImageOptions: Array<{ label: string; value: string }>;
  resolveAvatarFromAssets: (raw: string) => string;
  onAvatarUrlChange: (value: string) => void;
  onBioChange: (value: string) => void;
  onCvUrlChange: (value: string) => void;
  onRatingChange: (value: string) => void;
  onReviewsCountChange: (value: string) => void;
};

export default function ProfileSection({
  isVisible,
  avatarUrl,
  bio,
  cvUrl,
  rating,
  reviewsCount,
  staffImageOptions,
  resolveAvatarFromAssets,
  onAvatarUrlChange,
  onBioChange,
  onCvUrlChange,
  onRatingChange,
  onReviewsCountChange,
}: ProfileSectionProps) {
  if (!isVisible) return null;

  return (
    <EmployeeProfileTabLiveV2
      readOnly={false}
      employeeName="موظفة"
      avatarUrl={avatarUrl}
      bio={bio}
      cvUrl={cvUrl}
      rating={rating}
      reviewsCount={reviewsCount}
      staffImageOptions={staffImageOptions}
      resolveAvatarFromAssets={resolveAvatarFromAssets}
      onAvatarUrlChange={onAvatarUrlChange}
      onBioChange={onBioChange}
      onCvUrlChange={onCvUrlChange}
      onRatingChange={onRatingChange}
      onReviewsCountChange={onReviewsCountChange}
    />
  );
}
