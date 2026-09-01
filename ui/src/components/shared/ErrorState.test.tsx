// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ErrorState from "./ErrorState";

afterEach(cleanup);

describe("ErrorState", () => {
  it("uses an authoritative forbidden status instead of message heuristics", () => {
    render(<ErrorState status={403} message="resource not found" />);

    expect(screen.getByText(/Forbidden:/i)).toBeTruthy();
    expect(screen.queryByText(/no longer available/i)).toBeNull();
  });

  it("supports a resource-type-specific not-found explanation", () => {
    render(<ErrorState status={404} message="not found" notFoundMessage="CRD metadata is unavailable." />);

    expect(screen.getByText("CRD metadata is unavailable.")).toBeTruthy();
  });
});
