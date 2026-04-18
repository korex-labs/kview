import React from "react";
import GaugeBar, { type GaugeTone } from "./GaugeBar";

export default function MetricGauge({
  value,
  tone = "success",
}: {
  value: number;
  tone?: GaugeTone;
}) {
  return <GaugeBar value={value} tone={tone} />;
}
