// @vitest-environment jsdom

import React, { useState } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RightDrawer from "./RightDrawer";

afterEach(() => {
  cleanup();
});

describe("RightDrawer", () => {
  it("closes stacked drawers from the top down on repeated Escape presses", async () => {
    const closed: string[] = [];

    function Harness() {
      const [firstOpen, setFirstOpen] = useState(true);
      const [secondOpen, setSecondOpen] = useState(true);

      return (
        <>
          <RightDrawer
            open={firstOpen}
            onClose={() => {
              closed.push("first");
              setFirstOpen(false);
            }}
          >
            <div>First drawer</div>
          </RightDrawer>
          <RightDrawer
            open={secondOpen}
            onClose={() => {
              closed.push("second");
              setSecondOpen(false);
            }}
          >
            <div>Second drawer</div>
          </RightDrawer>
        </>
      );
    }

    render(<Harness />);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(closed).toEqual(["second"]));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(closed).toEqual(["second", "first"]));
  });

  it("leaves drawers open when Escape is handled by a dialog-like overlay", () => {
    const closed: string[] = [];
    const { container } = render(
      <>
        <RightDrawer open onClose={() => closed.push("drawer")}>
          <div>Drawer</div>
        </RightDrawer>
        <div className="MuiDialog-root">
          <button type="button">Dialog action</button>
        </div>
      </>,
    );

    const dialogButton = container.querySelector(".MuiDialog-root button");
    expect(dialogButton).not.toBeNull();

    fireEvent.keyDown(dialogButton!, { key: "Escape" });

    expect(closed).toEqual([]);
  });
});
