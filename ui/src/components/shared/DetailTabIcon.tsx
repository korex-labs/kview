import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import AssignmentOutlinedIcon from "@mui/icons-material/AssignmentOutlined";
import CodeOutlinedIcon from "@mui/icons-material/CodeOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import ListAltOutlinedIcon from "@mui/icons-material/ListAltOutlined";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import RuleOutlinedIcon from "@mui/icons-material/RuleOutlined";
import SchemaOutlinedIcon from "@mui/icons-material/SchemaOutlined";
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined";
import ShowChartOutlinedIcon from "@mui/icons-material/ShowChartOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import TerminalOutlinedIcon from "@mui/icons-material/TerminalOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import ResourceIcon from "../icons/resources/ResourceIcon";

type Props = {
  label: string;
};

const iconSx = { fontSize: 16 };

export default function DetailTabIcon({ label }: Props) {
  const normalized = label.trim().toLowerCase();

  if (normalized === "pods") return <ResourceIcon name="pods" size={16} />;
  if (normalized === "jobs") return <ResourceIcon name="jobs" size={16} />;
  if (normalized === "namespaces") return <ResourceIcon name="namespaces" size={16} />;
  if (normalized === "networking") return <ResourceIcon name="networking" size={16} />;

  switch (normalized) {
    case "overview":
      return <InfoOutlinedIcon sx={iconSx} />;
    case "signals":
      return <WarningAmberOutlinedIcon sx={iconSx} />;
    case "events":
      return <AssignmentOutlinedIcon sx={iconSx} />;
    case "metadata":
      return <ListAltOutlinedIcon sx={iconSx} />;
    case "yaml":
      return <CodeOutlinedIcon sx={iconSx} />;
    case "spec":
      return <TuneOutlinedIcon sx={iconSx} />;
    case "containers":
      return <Inventory2OutlinedIcon sx={iconSx} />;
    case "resources":
    case "capacity":
      return <StorageOutlinedIcon sx={iconSx} />;
    case "logs":
      return <TerminalOutlinedIcon sx={iconSx} />;
    case "keys":
      return <KeyOutlinedIcon sx={iconSx} />;
    case "rules":
    case "role ref":
      return <RuleOutlinedIcon sx={iconSx} />;
    case "tls":
    case "subjects":
    case "role bindings":
      return <SecurityOutlinedIcon sx={iconSx} />;
    case "versions":
      return <DnsOutlinedIcon sx={iconSx} />;
    case "conditions":
      return <ShowChartOutlinedIcon sx={iconSx} />;
    case "inventory":
      return <SchemaOutlinedIcon sx={iconSx} />;
    case "values":
      return <ArticleOutlinedIcon sx={iconSx} />;
    case "manifest":
      return <DescriptionOutlinedIcon sx={iconSx} />;
    case "hooks":
      return <HubOutlinedIcon sx={iconSx} />;
    case "history":
      return <HistoryOutlinedIcon sx={iconSx} />;
    case "notes":
      return <NotesOutlinedIcon sx={iconSx} />;
    default:
      return <InfoOutlinedIcon sx={iconSx} />;
  }
}
