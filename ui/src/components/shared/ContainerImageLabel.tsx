import React from "react";
import { Tooltip, Typography } from "@mui/material";

function displayImageName(image?: string) {
  const trimmed = String(image || "").trim();
  if (!trimmed) return "-";
  const last = trimmed.split("/").filter(Boolean).pop() || trimmed;
  return last.split("@")[0] || last;
}

export default function ContainerImageLabel(props: { image?: string; imageId?: string }) {
  const { image, imageId } = props;
  if (!image) return <>-</>;

  return (
    <Tooltip title={[`Image: ${image}`, imageId ? `Image ID: ${imageId}` : ""].filter(Boolean).join("\n")} arrow>
      <Typography variant="body2" sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
        {displayImageName(image)}
      </Typography>
    </Tooltip>
  );
}
