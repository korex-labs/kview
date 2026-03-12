import React, { useEffect, useState } from "react";
import { Box } from "@mui/material";
import ActivityList from "./ActivityList";
import EmptyState from "../shared/EmptyState";
import { apiGet } from "../../api";

type Props = {
  tab: number;
};

export default function ActivityTabs({ tab }: Props) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    apiGet<{ items: Activity[] }>("/api/activity")
      .then((res) => {
        setActivities(res.items || []);
      })
      .catch((e) => {
        // For Phase 1 keep error handling simple; Activity Panel is additive.
        setErr(String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
      {tab === 0 && <ActivityList items={activities} loading={loading} error={err || undefined} />}
      {tab === 1 && <EmptyState message="No active sessions yet." />}
      {tab === 2 && <EmptyState message="No runtime logs yet." />}
    </Box>
  );
}

