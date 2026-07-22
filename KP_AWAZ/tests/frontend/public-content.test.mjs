import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";


const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");


test("homepage assembles every required public mission section", async () => {
  const index = await read("index.html");

  for (const partial of [
    "sections/hero.html",
    "sections/mission.html",
    "sections/why-it-matters.html",
    "sections/impact.html",
    "sections/how-it-works.html",
    "sections/trust.html",
    "sections/final-cta.html",
  ]) {
    assert.match(index, new RegExp(`data-partial="${partial.replace(".", "\\.")}"`));
  }
});


test("homepage content explains the present platform and careful future goal", async () => {
  const [hero, mission, why, building, process, trust, closing] = await Promise.all([
    read("sections/hero.html"),
    read("sections/mission.html"),
    read("sections/why-it-matters.html"),
    read("sections/impact.html"),
    read("sections/how-it-works.html"),
    read("sections/trust.html"),
    read("sections/final-cta.html"),
  ]);
  const publicCopy = [hero, mission, why, building, process, trust, closing].join("\n");

  assert.match(hero, /Let technology hear Khyber Pakhtunkhwa\./);
  assert.match(hero, /href="#mission">Learn why it matters<\/a>/);
  assert.match(mission, /A future where language is never a barrier\./);
  assert.match(why, /Why does your voice matter\?/);
  assert.match(why, /Local representation/);
  assert.match(why, /Better understanding/);
  assert.match(why, /Equal digital access/);
  assert.match(building, /Building the foundation for local voice technology\./);
  assert.match(building, /may later support research and development/);
  assert.match(process, /Administrator review/);
  assert.match(process, /consent and withdrawal policies/);
  assert.match(trust, /Your voice\. Your choice\./);
  assert.match(trust, /Original audio preserved/);
  assert.match(trust, /href="data-use\.html"/);
  assert.match(closing, /Khyber Pakhtunkhwa has many voices\. Every voice deserves to be understood\./);

  assert.doesNotMatch(publicCopy, /8 supported languages|Eight languages and counting/i);
  assert.doesNotMatch(publicCopy, /KP AWAZ already understands Pashto/i);
  assert.doesNotMatch(publicCopy, /voice assistant is complete/i);
  assert.doesNotMatch(publicCopy, /recording will immediately train/i);
  assert.doesNotMatch(publicCopy, /guaranteed accuracy/i);
});


test("public navigation and footer use clear labels and working routes", async () => {
  const [header, footer] = await Promise.all([
    read("sections/header.html"),
    read("sections/footer.html"),
  ]);

  for (const [route, label] of [
    ["index.html", "Home"],
    ["about.html", "About"],
    ["how-it-works.html", "How It Works"],
    ["leaderboard.html", "Leaderboard"],
  ]) {
    assert.match(header, new RegExp(`href="${route.replace(".", "\\.")}"[^>]*>${label}<`));
  }
  assert.match(header, /id="authHeaderButtonLabel">Sign In<\/span>/);
  assert.match(header, /href="auth\.html\?next=contribute\.html"[\s\S]*data-start-contributing/);
  assert.match(header, /aria-label="Open navigation"/);
  assert.match(footer, /community voice-data initiative working to improve the representation of Pashto/);
  for (const route of ["about.html", "how-it-works.html", "data-use.html", "leaderboard.html"]) {
    assert.match(footer, new RegExp(`href="${route.replace(".", "\\.")}"`));
  }
  assert.doesNotMatch(footer, /facebook|instagram|twitter|linkedin/i);
});


test("About page states the Stage A and Stage B boundary", async () => {
  const about = await read("about.html");

  assert.match(about, /Technology should understand the language people actually speak\./);
  assert.match(about, /Stage A presents phrases, preserves original browser-recorded audio/);
  assert.match(about, /Stage B will later process eligible approved data/);
  assert.match(about, /Verified acceptance of the current data-use policy is required before submission/);
  assert.match(about, /supported withdrawal process/);
});


test("How It Works page documents all ten real contribution stages", async () => {
  const page = await read("how-it-works.html");

  for (const number of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]) {
    assert.match(page, new RegExp(`<li><span>${number}</span>`));
  }
  for (const phrase of [
    "six-digit signup code",
    "Receive a Pashto phrase",
    "Record in your browser",
    "Listen and re-record",
    "Accept the current data-use policy",
    "Submit after acceptance is verified",
    "Pending review",
    "approval or rejection",
    "score after approval",
    "future research",
    "Phrase reference",
    "Original audio format",
  ]) {
    assert.match(page, new RegExp(phrase, "i"));
  }
});


test("public layouts include accessible structure and required responsive breakpoints", async () => {
  const [hero, trust, sectionsCss, closingCss, responsiveCss, publicCss] = await Promise.all([
    read("sections/hero.html"),
    read("sections/trust.html"),
    read("styles/sections.css"),
    read("styles/closing.css"),
    read("styles/responsive.css"),
    read("styles/public-pages.css"),
  ]);

  assert.match(hero, /alt="Three community members in Khyber Pakhtunkhwa record a voice together on a mountain veranda\."/);
  assert.match(trust, /aria-labelledby="trustTitle"/);
  assert.match(trust, /aria-label="KP AWAZ trust commitments"/);
  assert.match(sectionsCss, /\.trust-layout/);
  assert.match(closingCss, /\.future-use-grid/);
  assert.match(responsiveCss, /@media \(max-width: 1050px\)/);
  assert.match(responsiveCss, /@media \(max-width: 680px\)/);
  assert.match(responsiveCss, /@media \(max-width: 430px\)/);
  assert.match(publicCss, /@media \(max-width: 900px\)/);
  assert.match(publicCss, /@media \(max-width: 720px\)/);
  assert.match(publicCss, /@media \(prefers-reduced-motion: reduce\)/);
});
