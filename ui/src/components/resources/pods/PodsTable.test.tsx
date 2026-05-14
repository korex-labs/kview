// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderUsageCell } from "./PodsTable";

afterEach(() => {
  cleanup();
});

describe("PodsTable metric cells", () => {
  it("renders zero-percent usage as a gauge", () => {
    render(<>{renderUsageCell(0, 0, "0m")}</>);

    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByText("0m")).toBeTruthy();
  });

  it("renders raw usage text when no percentage anchor is available", () => {
    render(<>{renderUsageCell(0, undefined, "0m")}</>);

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("0m")).toBeTruthy();
  });
});
