import CreateStaffAccountV2 from "./CreateStaffAccountV2";
import type { HrSession } from "./shared";

type Props = {
  session: HrSession;
};

export default function CreateStaffAccountPage(props: Props) {
  return <CreateStaffAccountV2 session={props.session} />;
}
