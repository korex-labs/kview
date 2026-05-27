import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import type { DashboardSignalItem } from "../../types/api";
import { AppIconButton } from "./AppActions";

type Props = {
  signal: DashboardSignalItem;
  onInvestigate: (signal: DashboardSignalItem) => void;
};

export default function SignalInvestigationButton({ signal, onInvestigate }: Props) {
  return (
    <AppIconButton
      tooltip="Investigate signal"
      label="Investigate signal"
      sx={{ p: 0.25 }}
      onClick={(event) => {
        event.stopPropagation();
        onInvestigate(signal);
      }}
    >
      <ManageSearchIcon fontSize="inherit" />
    </AppIconButton>
  );
}
