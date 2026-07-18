import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { PublicRouting } from "../../scripts/modules/public-routing.js";
import {
  AUTH_ONLY_PAGES,
  PROTECTED_PAGES,
  PUBLIC_PAGES,
  navigateOnce,
  normalizePageName,
  routeDecision,
  safeProtectedDestination,
} from "../../scripts/services/route-guard.js";
import {
  AUTH_REQUEST_TIMEOUT_MESSAGE,
  fetchWithRequestTimeout,
  withRequestTimeout,
} from "../../scripts/services/request-timeout.js";


const rootUrl = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, rootUrl), "utf8");
const signedIn = {
  status: "signed_in",
  session: { userId: "verified-user" },
  backendUser: { id: "verified-user" },
};
const signedOut = { status: "signed_out", session: null, backendUser: null };


class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}


function publicFixture(initialState) {
  const startLinks = [new FakeElement(), new FakeElement()];
  const accountButton = new FakeElement();
  const accountLabel = new FakeElement();
  const profileLink = new FakeElement();
  profileLink.hidden = true;
  const elements = new Map([
    ["authHeaderButton", accountButton],
    ["authHeaderButtonLabel", accountLabel],
    ["publicAccountLink", profileLink],
  ]);
  let listener = null;
  let subscriptions = 0;
  let unsubscriptions = 0;
  let destroyed = 0;
  const routing = new PublicRouting({
    root: {
      getElementById(id) {
        return elements.get(id) ?? null;
      },
      querySelectorAll(selector) {
        return selector === "[data-start-contributing]" ? startLinks : [];
      },
    },
    authApi: {
      subscribeToAuthChanges(callback) {
        subscriptions += 1;
        listener = callback;
        callback({ status: "loading" });
        return () => {
          unsubscriptions += 1;
          listener = null;
        };
      },
      async initializeAuthService() {
        return initialState;
      },
      destroyAuthService() {
        destroyed += 1;
      },
    },
  });
  return {
    accountButton,
    accountLabel,
    profileLink,
    routing,
    startLinks,
    stats: () => ({ destroyed, listener, subscriptions, unsubscriptions }),
  };
}


test("page categories contain the required public, auth-only, and protected pages", () => {
  assert.deepEqual(PUBLIC_PAGES, ["index.html", "about.html", "how-it-works.html", "leaderboard.html"]);
  assert.deepEqual(AUTH_ONLY_PAGES, ["auth.html"]);
  assert.deepEqual(PROTECTED_PAGES, [
    "dashboard.html", "contribute.html", "my-contributions.html", "profile.html", "settings.html",
  ]);
});


test("root and public pages are allowed for signed-out and signed-in visitors", () => {
  assert.equal(normalizePageName("/"), "index.html");
  for (const pathname of ["/", ...PUBLIC_PAGES]) {
    assert.equal(routeDecision({ pathname, state: signedOut }).action, "allow");
    assert.equal(routeDecision({ pathname, state: signedIn }).action, "allow");
  }
});


test("protected pages redirect signed-out visitors with a safe local next value", () => {
  for (const page of PROTECTED_PAGES) {
    assert.deepEqual(routeDecision({ pathname: page, state: signedOut }), {
      action: "redirect",
      category: "protected",
      destination: `auth.html?next=${page}`,
      page,
    });
    assert.equal(routeDecision({ pathname: page, state: signedIn }).action, "allow");
  }
});


test("auth page redirects only a fully verified contributor", () => {
  assert.equal(routeDecision({ pathname: "auth.html", state: signedOut }).action, "allow");
  assert.equal(routeDecision({ pathname: "auth.html", state: { status: "loading" } }).action, "wait");
  assert.deepEqual(routeDecision({ pathname: "auth.html", state: signedIn }), {
    action: "redirect",
    category: "auth-only",
    destination: "dashboard.html",
    page: "auth.html",
  });
});


test("unsafe next destinations are rejected", () => {
  assert.equal(safeProtectedDestination("profile.html"), "profile.html");
  assert.equal(safeProtectedDestination("https://outside.example"), "dashboard.html");
  assert.equal(safeProtectedDestination("//outside.example"), "dashboard.html");
  assert.equal(safeProtectedDestination("admin.html"), "dashboard.html");
});


test("navigation uses one method and refuses a same-page redirect", () => {
  const calls = [];
  const location = {
    pathname: "/auth.html",
    assign(value) { calls.push(["assign", value]); },
    replace(value) { calls.push(["replace", value]); },
  };
  assert.equal(navigateOnce(location, "auth.html"), false);
  assert.equal(navigateOnce(location, "dashboard.html", { replace: true }), true);
  assert.deepEqual(calls, [["replace", "dashboard.html"]]);
});


test("signed-in public routing updates links without navigating away", async () => {
  const fixture = publicFixture(signedIn);
  await fixture.routing.initialize();
  assert.equal(fixture.accountLabel.textContent, "Dashboard");
  assert.equal(fixture.accountButton.getAttribute("href"), "dashboard.html");
  assert.equal(fixture.profileLink.hidden, false);
  assert.equal(fixture.startLinks.every((link) => link.getAttribute("href") === "contribute.html"), true);
  assert.equal(fixture.stats().subscriptions, 1);
  fixture.routing.destroy();
  assert.deepEqual(
    { destroyed: fixture.stats().destroyed, unsubscriptions: fixture.stats().unsubscriptions },
    { destroyed: 1, unsubscriptions: 1 },
  );
});


test("signed-out public routing exposes Sign In and safe contribution links", async () => {
  const fixture = publicFixture(signedOut);
  await fixture.routing.initialize();
  assert.equal(fixture.accountLabel.textContent, "Sign in");
  assert.equal(fixture.accountButton.getAttribute("href"), "auth.html");
  assert.equal(fixture.profileLink.hidden, true);
  assert.equal(
    fixture.startLinks.every((link) => link.getAttribute("href") === "auth.html?next=contribute.html"),
    true,
  );
});


test("public bootstrap renders before authentication finishes and contains no home redirect", async () => {
  const [home, other, publicCss] = await Promise.all([
    read("scripts/app.js"),
    read("scripts/public-page-app.js"),
    read("styles/public-pages.css"),
  ]);
  assert.doesNotMatch(home, /redirectAuthenticatedHome|location\.(?:assign|replace).*dashboard/);
  assert.match(home, /dataset\.appState = "ready";[\s\S]*await routing\.initialize\(\)/);
  assert.match(other, /dataset\.appState = "ready";[\s\S]*await routing\.initialize\(\)/);
  assert.doesNotMatch(publicCss, /data-app-state="loading"[\s\S]*opacity:\s*0/);
});


test("protected pages use a visible loading shell without fading or blocking the page", async () => {
  const [workspaceCss, sidebar, ...pages] = await Promise.all([
    read("styles/workspace.css"),
    read("sections/workspace-sidebar.html"),
    ...PROTECTED_PAGES.map(read),
  ]);
  for (const html of pages) {
    assert.match(html, /workspace-loading-shell/);
    assert.match(html, /Loading your contributor workspace…/);
  }
  assert.match(sidebar, /href="index\.html"[^>]*data-public-website-link/);
  assert.doesNotMatch(
    workspaceCss,
    /data-workspace-state="loading"[^}]*?(?:opacity|pointer-events)/s,
  );
});


test("authentication styles never blur or disable the whole page", async () => {
  const [authCss, workspaceCss, publicCss] = await Promise.all([
    read("styles/auth-page.css"),
    read("styles/workspace.css"),
    read("styles/public-pages.css"),
  ]);
  const source = `${authCss}\n${workspaceCss}\n${publicCss}`;
  assert.doesNotMatch(source, /(?:body|main)[^{]*\{[^}]*filter:\s*blur/s);
  assert.doesNotMatch(source, /body[^{]*\{[^}]*pointer-events:\s*none/s);
  assert.doesNotMatch(source, /body[^{]*\{[^}]*\binert\b/s);
});


test("request timeout uses the fixed safe message and clears its timer", async () => {
  const active = new Set();
  let nextTimer = 0;
  await assert.rejects(
    withRequestTimeout(() => new Promise(() => {}), {
      timeoutMs: 10,
      setTimeoutImpl(callback) {
        const id = ++nextTimer;
        active.add(id);
        queueMicrotask(callback);
        return id;
      },
      clearTimeoutImpl(id) {
        active.delete(id);
      },
    }),
    (error) =>
      error.code === "AUTH_REQUEST_TIMEOUT" &&
      error.message === AUTH_REQUEST_TIMEOUT_MESSAGE,
  );
  assert.equal(active.size, 0);
});


test("fetch timeout aborts a hanging API request", async () => {
  let requestSignal = null;

  await assert.rejects(
    fetchWithRequestTimeout(
      async (_url, options) => {
        requestSignal = options.signal;
        return new Promise(() => {});
      },
      "http://127.0.0.1:8000/api/health",
      {},
      { timeoutMs: 5 },
    ),
    { code: "AUTH_REQUEST_TIMEOUT" },
  );

  assert.equal(requestSignal?.aborted, true);
});
