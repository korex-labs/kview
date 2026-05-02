import type { SxProps, Theme } from "@mui/material";
import SvgIcon from "@mui/material/SvgIcon";
import type { ReactNode } from "react";
import type { ResourceIconName } from "./types";

type Props = {
  name: ResourceIconName;
  size?: number | string;
  titleAccess?: string;
  sx?: SxProps<Theme>;
};

const iconPaths: Record<ResourceIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="4" y="5" width="7" height="6" rx="1.5" />
      <rect x="13" y="5" width="7" height="4" rx="1.5" />
      <rect x="4" y="13" width="7" height="6" rx="1.5" />
      <path d="M14 15.5h6M14 18.5h4" />
    </>
  ),
  workloads: (
    <>
      <rect x="5" y="5" width="6" height="6" rx="1.5" />
      <rect x="13" y="5" width="6" height="6" rx="1.5" />
      <rect x="9" y="13" width="6" height="6" rx="1.5" />
      <path d="M11 8h2M12 11v2" />
    </>
  ),
  networking: (
    <>
      <circle cx="6.5" cy="12" r="2.5" />
      <circle cx="17.5" cy="7" r="2.5" />
      <circle cx="17.5" cy="17" r="2.5" />
      <path d="m8.8 11 6.4-2.9M8.8 13l6.4 2.9" />
    </>
  ),
  configuration: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M8 10h8M8 14h5M17 14h1" />
    </>
  ),
  "access-control": (
    <>
      <path d="M7 10V8a5 5 0 0 1 10 0v2" />
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M12 14v2.5" />
    </>
  ),
  storage: (
    <>
      <ellipse cx="12" cy="6.5" rx="7" ry="2.5" />
      <path d="M5 6.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5M5 11.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5" />
    </>
  ),
  helm: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 5v3M12 16v3M5 12h3M16 12h3M7.1 7.1l2.1 2.1M14.8 14.8l2.1 2.1M16.9 7.1l-2.1 2.1M9.2 14.8l-2.1 2.1" />
    </>
  ),
  extensions: (
    <>
      <path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5z" />
      <path d="M9 9h6v6H9z" />
    </>
  ),
  cluster: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="6" cy="7" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="6" cy="17" r="2" />
      <circle cx="18" cy="17" r="2" />
      <path d="m7.6 8.2 2.8 2.3M16.4 8.2l-2.8 2.3M7.7 15.8l2.7-2.2M16.3 15.8l-2.7-2.2" />
    </>
  ),
  pods: (
    <>
      <rect x="5" y="7" width="14" height="10" rx="2" />
      <path d="M8 10h8M8 14h8M10 7V5M14 7V5M10 19v-2M14 19v-2" />
    </>
  ),
  deployments: (
    <>
      <rect x="6" y="5" width="8" height="6" rx="1.5" />
      <rect x="10" y="13" width="8" height="6" rx="1.5" />
      <path d="M14 8h3v5M10 16H7v-5" />
    </>
  ),
  daemonsets: (
    <>
      <path d="M12 4 5 8v8l7 4 7-4V8z" />
      <path d="M8.5 10.5h7M8.5 13.5h7M12 8v8" />
    </>
  ),
  statefulsets: (
    <>
      <rect x="5" y="5" width="14" height="4" rx="1.5" />
      <rect x="5" y="10" width="14" height="4" rx="1.5" />
      <rect x="5" y="15" width="14" height="4" rx="1.5" />
      <path d="M8 7h.1M8 12h.1M8 17h.1" />
    </>
  ),
  replicasets: (
    <>
      <rect x="5" y="5" width="6" height="6" rx="1.5" />
      <rect x="13" y="5" width="6" height="6" rx="1.5" />
      <rect x="9" y="13" width="6" height="6" rx="1.5" />
    </>
  ),
  services: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 5v4M12 15v4M5 12h4M15 12h4" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
      <circle cx="5" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  ingresses: (
    <>
      <path d="M4 12h6l2-6 2 12 2-6h4" />
      <path d="M6 17h12" />
    </>
  ),
  jobs: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="m8.5 12 2.5 2.5L16 9" />
    </>
  ),
  cronjobs: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v4l3 2M5 5l3 1M19 5l-3 1" />
    </>
  ),
  horizontalpodautoscalers: (
    <>
      <rect x="4" y="8" width="6" height="8" rx="1.5" />
      <rect x="14" y="8" width="6" height="8" rx="1.5" />
      <path d="M10 12h4M13 9l3 3-3 3" />
    </>
  ),
  configmaps: (
    <>
      <path d="M6 5h9l3 3v11H6z" />
      <path d="M15 5v4h4M9 12h6M9 15h4" />
    </>
  ),
  secrets: (
    <>
      <circle cx="9" cy="12" r="3" />
      <path d="M12 12h7M16 12v3M19 12v2" />
    </>
  ),
  serviceaccounts: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0M16 14l2 2 3-4" />
    </>
  ),
  roles: (
    <>
      <path d="M12 4 6 7v5c0 3.8 2.5 6.2 6 8 3.5-1.8 6-4.2 6-8V7z" />
      <path d="M9 12h6" />
    </>
  ),
  rolebindings: (
    <>
      <path d="M8 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM16 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
      <path d="M11 11h2M5 18h14" />
    </>
  ),
  clusterroles: (
    <>
      <path d="M12 4 6 7v5c0 3.8 2.5 6.2 6 8 3.5-1.8 6-4.2 6-8V7z" />
      <path d="M9 12h6M12 9v6" />
    </>
  ),
  clusterrolebindings: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="6" cy="8" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M7.8 9.2 10 11M16.2 9.2 14 11M5 19h14" />
    </>
  ),
  persistentvolumeclaims: (
    <>
      <path d="M7 7h8l2 2v8H7z" />
      <path d="M15 7v3h3M9 13h6" />
    </>
  ),
  persistentvolumes: (
    <>
      <ellipse cx="12" cy="7" rx="6" ry="2.5" />
      <path d="M6 7v8c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7" />
      <path d="M9 12h6" />
    </>
  ),
  nodes: (
    <>
      <rect x="5" y="6" width="14" height="12" rx="2" />
      <path d="M8 10h8M8 14h8M9 18v2M15 18v2" />
    </>
  ),
  namespaces: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M4 10h16M8 6v12" />
    </>
  ),
  customresourcedefinitions: (
    <>
      <path d="M7 4h7l4 4v12H7z" />
      <path d="M14 4v5h5M9.5 14h5M12 11.5v5" />
    </>
  ),
  customresources: (
    <>
      <path d="M12 4 5 8v8l7 4 7-4V8z" />
      <path d="M9 12h6M12 9v6" />
    </>
  ),
  clusterresources: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 4v5M12 15v5M4 12h5M15 12h5" />
      <path d="M7 7l2.5 2.5M17 7l-2.5 2.5M7 17l2.5-2.5M17 17l-2.5-2.5" />
    </>
  ),
  helmcharts: (
    <>
      <path d="M6 8 12 5l6 3v8l-6 3-6-3z" />
      <path d="m6 8 6 3 6-3M12 11v8" />
    </>
  ),
  resourcequotas: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M8 15h8M8 12h5M8 9h8" />
      <path d="M16 12v3" />
    </>
  ),
  limitranges: (
    <>
      <path d="M5 7h14M5 17h14" />
      <path d="M8 7v10M16 7v10M10 12h4" />
    </>
  ),
};

export default function ResourceIcon({ name, size = 18, titleAccess, sx }: Props) {
  const sxList = Array.isArray(sx) ? sx : sx ? [sx] : [];

  return (
    <SvgIcon
      titleAccess={titleAccess}
      viewBox="0 0 24 24"
      sx={[
        {
          fontSize: size,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          flex: "0 0 auto",
        },
        ...sxList,
      ]}
    >
      {iconPaths[name]}
    </SvgIcon>
  );
}
