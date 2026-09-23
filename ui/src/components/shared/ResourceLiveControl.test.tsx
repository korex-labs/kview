// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ResourceLiveControl from "./ResourceLiveControl";
afterEach(cleanup);
it.each([false, true])("explains the update mode and toggle action (enabled=%s)", (enabled) => {
  render(<ResourceLiveControl enabled={enabled} state="starting" onToggle={() => {}} description="Resource status only; Kubernetes Events are not streamed." />);
  const title = screen.getByRole("button").getAttribute("title")!;
  expect(title).toContain(enabled ? "when resource changes are reported" : "Refreshes this list periodically");
  expect(title).toContain("Click to");
  expect(title).toContain("Kubernetes Events are not streamed");
  expect(title).not.toContain("Live=");
});
