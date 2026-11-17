// @vitest-environment jsdom
import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import SettingsMultiSelect from "./SettingsMultiSelect";
import { denseSelectMenuProps } from "./denseSelectMenuProps";

afterEach(cleanup);

it("preserves dense checkbox menu geometry, selection, keyboard focus and Escape restoration", async () => {
  function Harness() {
    const [value, setValue] = useState(["one"]);
    return <SettingsMultiSelect id="dense-fixture" label="Resources" value={value} onChange={setValue}
      options={[{ value: "one", label: "Pods" }, { value: "two", label: "Services" }]}
      menuProps={denseSelectMenuProps} />;
  }
  render(<Harness />);
  const trigger = screen.getByRole("combobox", { name: "Resources" });
  act(() => trigger.focus());
  fireEvent.mouseDown(trigger);
  const pods = screen.getByRole("option", { name: "Pods" });
  const services = screen.getByRole("option", { name: "Services" });
  expect(document.activeElement).toBe(pods);
  expect(getComputedStyle(pods).minHeight).toBe("30px");
  // Preserve the original density config exactly. jsdom does not resolve MUI's
  // logical padding against physical defaults consistently.
  expect(denseSelectMenuProps.slotProps.paper.sx).toEqual({
    "& .MuiMenuItem-root": { minHeight: 30, py: 0.25, fontSize: "0.875rem" },
    "& .MuiCheckbox-root": { py: 0.25 },
    "& .MuiListItemText-root": { my: 0 },
  });
  fireEvent.keyDown(pods, { key: "ArrowDown" });
  expect(document.activeElement).toBe(services);
  fireEvent.click(services);
  expect(services.getAttribute("aria-selected")).toBe("true");
  expect((services.querySelector("input") as HTMLInputElement).checked).toBe(true);
  fireEvent.keyDown(services, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(trigger.textContent).toContain("Pods, Services");
});
