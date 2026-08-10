import SettingsUsers from "./SettingsUsers";

type SettingsUsersV2Props = {
  initialRole?: string;
  authReady?: boolean;
  allowAdminManageUsers?: boolean;
};

export default function SettingsUsersV2(props: SettingsUsersV2Props) {
  return (
    <div className="settings-users-v2-route">
      <SettingsUsers {...props} />
    </div>
  );
}
