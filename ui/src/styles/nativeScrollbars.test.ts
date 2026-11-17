// @vitest-environment jsdom

import { afterEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const themeCss = readFileSync("src/styles/theme.css", "utf8");

let style: HTMLStyleElement;
let fixture: HTMLDivElement;
afterEach(() => { style?.remove(); fixture?.remove(); });

it("keeps scrollbar painting scoped, with theme contrast, native width and forced-color/fallback guards", () => {
  style = document.createElement("style");
  style.textContent = themeCss;
  document.head.append(style);
  const rules = Array.from(style.sheet!.cssRules);
  const rule = (selector: string) => rules.find((entry) => (entry as CSSStyleRule).selectorText === selector) as CSSStyleRule;
  const optIn = rule(".kview-native-scrollbar");
  expect(optIn.style.getPropertyValue("scrollbar-width")).toBe("auto");
  expect(optIn.style.getPropertyValue("scrollbar-color")).toBe("var(--scrollbar-thumb) var(--scrollbar-track)");
  expect(rule(".kview-native-scrollbar:hover").style.getPropertyValue("scrollbar-color")).toBe("var(--scrollbar-thumb-hover) var(--scrollbar-track)");
  const reset = rule(".kview-native-scrollbar :not(.kview-native-scrollbar)");
  expect(reset.style.getPropertyValue("scrollbar-color")).toBe("auto");
  expect(Array.from(reset.style)).toEqual(["scrollbar-color"]);
  // jsdom 30 resolves `auto` as a single color (or inherited tokens), not the
  // specified keyword required by CSS Scrollbars. Check real CSSOM + matches,
  // not that incorrect computed value; browser appearance is manual acceptance.
  fixture = document.createElement("div");
  fixture.innerHTML = `<div class="kview-native-scrollbar" data-owner>
    <div><div class="xterm-viewport" data-native></div>
      <pre data-native><code data-native>code</code></pre>
      <div class="react-flow" data-native></div>
      <div class="kview-native-scrollbar" data-owner><div data-native></div></div>
    </div></div><div class="xterm-viewport" data-outside></div>`;
  document.body.append(fixture);
  for (const owner of fixture.querySelectorAll("[data-owner]")) {
    expect(owner.matches(optIn.selectorText)).toBe(true);
    expect(owner.matches(reset.selectorText)).toBe(false);
  }
  for (const descendant of fixture.querySelectorAll("[data-native]")) {
    expect(descendant.matches(reset.selectorText)).toBe(true);
    expect(descendant.matches(optIn.selectorText)).toBe(false);
  }
  expect(fixture.querySelector("[data-outside]")!.matches(reset.selectorText)).toBe(false);
  expect(Array.from(optIn.style)).toEqual(["scrollbar-width", "scrollbar-color"]);
  for (const selector of [":root", '[data-theme="dark"]']) {
    const tokens = rule(selector).style;
    const luminance = (hex: string) => {
      const rgb = hex.trim().slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const track = luminance(tokens.getPropertyValue("--scrollbar-track"));
    for (const name of ["--scrollbar-thumb", "--scrollbar-thumb-hover"]) {
      const thumb = luminance(tokens.getPropertyValue(name));
      // Token contrast only, not an OS/browser pixel or visibility assertion.
      expect((Math.max(track, thumb) + 0.05) / (Math.min(track, thumb) + 0.05)).toBeGreaterThanOrEqual(3);
    }
  }
  const fallback = rules.find(entry => entry.cssText.startsWith("@supports not (scrollbar-color: auto)")) as CSSSupportsRule;
  expect(fallback).toBeTruthy();
  expect(fallback.cssRules[0].cssText).toContain("@media (forced-colors: none)");
  expect(fallback.cssText).not.toMatch(/(?:width|height|display|overflow):/);
  const forced = rules.find(entry => entry.cssText.startsWith("@media (forced-colors: active)")) as CSSMediaRule;
  expect(forced.cssRules[0].cssText).toContain("scrollbar-color: auto");
  expect(forced.cssRules[0].cssText).toContain(".kview-native-scrollbar:hover");
});
