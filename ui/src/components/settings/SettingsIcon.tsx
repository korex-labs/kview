import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import BrushOutlinedIcon from "@mui/icons-material/BrushOutlined";
import CachedOutlinedIcon from "@mui/icons-material/CachedOutlined";
import CloudSyncOutlinedIcon from "@mui/icons-material/CloudSyncOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import KeyboardOutlinedIcon from "@mui/icons-material/KeyboardOutlined";
import MemoryOutlinedIcon from "@mui/icons-material/MemoryOutlined";
import QueryStatsOutlinedIcon from "@mui/icons-material/QueryStatsOutlined";
import RocketLaunchOutlinedIcon from "@mui/icons-material/RocketLaunchOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import SettingsSuggestOutlinedIcon from "@mui/icons-material/SettingsSuggestOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import TerminalOutlinedIcon from "@mui/icons-material/TerminalOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";

export type SettingsIconName =
  | "appearance"
  | "keyboard"
  | "smartFilters"
  | "commands"
  | "actions"
  | "dataplane"
  | "importExport"
  | "overview"
  | "enrichment"
  | "metrics"
  | "signals"
  | "cache"
  | "profile"
  | "observers"
  | "allContexts"
  | "namespaceEnrichment"
  | "sweep"
  | "persistence"
  | "ttl";

type Props = {
  name: SettingsIconName;
  size?: number | string;
};

const iconSx = (size: number | string) => ({ fontSize: size, flex: "0 0 auto" });

export default function SettingsIcon({ name, size = 18 }: Props) {
  const sx = iconSx(size);

  switch (name) {
    case "appearance":
      return <BrushOutlinedIcon sx={sx} />;
    case "keyboard":
      return <KeyboardOutlinedIcon sx={sx} />;
    case "smartFilters":
      return <FilterAltOutlinedIcon sx={sx} />;
    case "commands":
      return <TerminalOutlinedIcon sx={sx} />;
    case "actions":
      return <RocketLaunchOutlinedIcon sx={sx} />;
    case "dataplane":
      return <CloudSyncOutlinedIcon sx={sx} />;
    case "importExport":
      return <UploadFileOutlinedIcon sx={sx} />;
    case "overview":
      return <DashboardOutlinedIcon sx={sx} />;
    case "enrichment":
    case "namespaceEnrichment":
      return <AutoAwesomeOutlinedIcon sx={sx} />;
    case "metrics":
      return <QueryStatsOutlinedIcon sx={sx} />;
    case "signals":
      return <WarningAmberOutlinedIcon sx={sx} />;
    case "cache":
    case "persistence":
      return <StorageOutlinedIcon sx={sx} />;
    case "profile":
      return <TuneOutlinedIcon sx={sx} />;
    case "observers":
      return <HubOutlinedIcon sx={sx} />;
    case "allContexts":
      return <MemoryOutlinedIcon sx={sx} />;
    case "sweep":
      return <ScheduleOutlinedIcon sx={sx} />;
    case "ttl":
      return <CachedOutlinedIcon sx={sx} />;
    default:
      return <SettingsSuggestOutlinedIcon sx={sx} />;
  }
}
