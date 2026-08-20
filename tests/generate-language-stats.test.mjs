import assert from "node:assert/strict";
import test from "node:test";
import { aggregate, renderSvg } from "../scripts/generate-language-stats.mjs";

const template = `<svg xmlns="http://www.w3.org/2000/svg"><title id="title">Profile</title><!-- TELEMETRY_SLOT --></svg>`;

test("aggregate combines repositories and sorts descending", () => {
  const result = aggregate([{ JavaScript: 60, C: 20 }, { JavaScript: 20, Python: 20 }]);
  assert.deepEqual(result.map(item => item.name), ["JavaScript", "C", "Python"]);
  assert.equal(result[0].percentage, 66.66666666666666);
});

test("renderSvg escapes API-provided language names", () => {
  const svg = renderSvg(template, "ethan&wod", 1, [{ name: "A<B", bytes: 10, percentage: 100 }], new Date("2026-08-20T00:00:00Z"));
  assert.match(svg, /ethan&amp;wod/);
  assert.match(svg, /A&lt;B/);
  assert.doesNotMatch(svg, /A<B/);
});

test("renderSvg handles repositories without detected code", () => {
  const svg = renderSvg(template, "ethanwod", 0, [], new Date("2026-08-20T00:00:00Z"));
  assert.match(svg, /NO CODE DATA/);
  assert.match(svg, /0 REPOS/);
});

test("renderSvg positions the first bar segment at the bar origin", () => {
  const svg = renderSvg(template, "ethanwod", 1, [{ name: "Python", bytes: 10, percentage: 100 }], new Date("2026-08-20T00:00:00Z"));
  assert.match(svg, /<rect x="72\.00" y="958" width="1056\.00"/);
});

test("renderSvg carries a stable data signature independent of timestamp", () => {
  const languages = [{ name: "Python", bytes: 10, percentage: 100 }];
  const first = renderSvg(template, "ethanwod", 1, languages, new Date("2026-08-20T00:00:00Z"));
  const second = renderSvg(template, "ethanwod", 1, languages, new Date("2026-08-21T00:00:00Z"));
  const signature = svg => svg.match(/data-signature="([a-f0-9]+)"/)?.[1];
  assert.equal(signature(first), signature(second));
});

test("renderSvg requires the unified dashboard slot", () => {
  assert.throws(
    () => renderSvg("<svg/>", "ethanwod", 0, [], new Date("2026-08-20T00:00:00Z")),
    /TELEMETRY_SLOT/,
  );
});

test("renderSvg changes its signature when the dashboard template changes", () => {
  const languages = [{ name: "Python", bytes: 10, percentage: 100 }];
  const first = renderSvg(template, "ethanwod", 1, languages, new Date("2026-08-20T00:00:00Z"));
  const second = renderSvg(template.replace("Profile", "Updated profile"), "ethanwod", 1, languages, new Date("2026-08-20T00:00:00Z"));
  const signature = svg => svg.match(/data-signature="([a-f0-9]+)"/)?.[1];
  assert.notEqual(signature(first), signature(second));
});

