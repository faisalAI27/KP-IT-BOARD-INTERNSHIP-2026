import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const logoAssets = [
  "assets/images/logo.svg",
  "assets/images/logo-primary.svg",
  "assets/images/logo-horizontal.svg",
  "assets/images/logo-stacked.svg",
  "assets/images/logo-monochrome-dark.svg",
  "assets/images/logo-monochrome-light.svg",
];

test("brand system provides every scalable KP AWAZ logo variation", async () => {
  for (const path of logoAssets) {
    const [asset, metadata] = await Promise.all([
      read(path),
      stat(new URL(path, root)),
    ]);

    assert.equal(metadata.isFile(), true);
    assert.match(asset, /^<svg[^>]+viewBox=/);
    assert.match(asset, /<title[^>]*>KP AWAZ/i);
    assert.doesNotMatch(asset, /<linearGradient|<radialGradient|filter=/);
  }
});

test("full-color identity uses the approved earthy palette and integrated symbol", async () => {
  const [mark, primary] = await Promise.all([
    read("assets/images/logo.svg"),
    read("assets/images/logo-primary.svg"),
  ]);

  for (const color of ["#153f32", "#b65d3a", "#c89943", "#f7f1e6"]) {
    assert.match(mark, new RegExp(color, "i"));
  }

  assert.match(mark, /gateway.*mountain.*voice wave/i);
  assert.match(mark, /stroke-linecap="round"/);
  assert.match(primary, /id="letter-k"/);
  assert.match(primary, /id="letter-a"/);
  assert.doesNotMatch(primary, /<text/);
});

test("the correct lockup is used on light, dark, and authentication surfaces", async () => {
  const [header, footer, auth, workspace, forgot, reset] = await Promise.all([
    read("sections/header.html"),
    read("sections/footer.html"),
    read("auth.html"),
    read("sections/workspace-sidebar.html"),
    read("forgot-password.html"),
    read("reset-password.html"),
  ]);

  assert.match(header, /assets\/images\/logo-primary\.svg/);
  assert.match(footer, /assets\/images\/logo-monochrome-light\.svg/);
  assert.match(auth, /assets\/images\/logo-primary\.svg/);
  assert.match(workspace, /assets\/images\/logo-monochrome-light\.svg/);
  assert.match(forgot, /assets\/images\/logo-primary\.svg/);
  assert.match(reset, /assets\/images\/logo-primary\.svg/);
});

test("brand guidance records meaning, usage, minimum size, and accessibility", async () => {
  const guide = await read("docs/brand-identity.md");

  assert.match(guide, /The Voice Gateway/);
  assert.match(guide, /hujra/i);
  assert.match(guide, /minimum displayed width/i);
  assert.match(guide, /aria-label="KP AWAZ home"/);
  assert.match(guide, /Do not/);
});
