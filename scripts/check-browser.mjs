import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = process.env.IRIS_TEST_URL ?? "http://127.0.0.1:1420";
await fs.mkdir("docs/evidence", { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
const checks = [];
await page.addInitScript(() => {
  window.contextCount = 0;
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
    if (kind === "webgl2" || kind === "webgl") window.contextCount++;
    return original.call(this, kind, ...args);
  };
});
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(base + "/?freeze=1");
  await page.locator("canvas").waitFor();
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => window.contextCount), 1);
  await page.getByRole("button", { name: "Immersive", exact: true }).click();
  assert.equal(
    await page
      .getByRole("region", { name: "Conversation", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  assert.equal(await page.evaluate(() => window.contextCount), 1);
  checks.push("one context across modes");
  for (const [name, id] of [
    ["Axiom", "coding"],
    ["Spectra", "research"],
    ["Umbra", "file-task"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    assert.equal(await page.locator(`.agent-card.${id}.selected`).count(), 1);
  }
  checks.push("three selectable specialists");
  await page
    .getByRole("button", { name: "Close Live activity", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open Live activity", exact: true })
    .click();
  checks.push("close and restore widgets");
  const panel = page.locator(".widget-conversation");
  const before = await panel.boundingBox();
  await page
    .getByRole("button", { name: "Move or resize Conversation", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  const after = await panel.boundingBox();
  assert.equal(after.x, before.x + 16);
  assert.equal(after.height, before.height + 16);
  checks.push("keyboard move and resize");
  await page
    .getByRole("button", { name: "Open Settings", exact: true })
    .click();
  assert.equal(await page.locator("#deepgram").isDisabled(), true);
  await page
    .getByRole("combobox", { name: "Rendering quality", exact: true })
    .selectOption("low");
  await page
    .getByRole("combobox", { name: "Motion", exact: true })
    .selectOption("reduced");
  await page
    .getByRole("button", { name: "Close Settings", exact: true })
    .click();
  await page.waitForTimeout(1600);
  checks.push("native-only credential entry and rendering settings");
  await page.screenshot({ path: "docs/evidence/dashboard.png" });
  assert.equal(await page.evaluate(() => window.contextCount), 1);
  await page.reload();
  await page.locator("canvas").waitFor();
  await page.waitForTimeout(700);
  assert.equal((await panel.boundingBox()).x, after.x);
  checks.push("layout persistence");
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.waitForTimeout(300);
  const box = await panel.boundingBox();
  assert.ok(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= 1000 &&
      box.y + box.height <= 720,
  );
  checks.push("offscreen recovery");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page
    .getByRole("button", { name: "Reset widget layout", exact: true })
    .click();
  await page.getByRole("button", { name: "Immersive", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "docs/evidence/immersive.png" });
  checks.push("layout reset and immersive mode");
  const restoration = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    const extension = canvas
      .getContext("webgl2")
      .getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    const lost = !!document.querySelector(".static-fallback");
    extension.restoreContext();
    await new Promise((r) => setTimeout(r, 1000));
    return lost && !document.querySelector(".static-fallback");
  });
  assert.equal(restoration, true);
  checks.push("WebGL context loss and restoration");
  const lifecycle = await page.evaluate(
    async (enginePath) => {
      const { GalaxyEngine } = await import(enginePath);
      const retained = [];
      for (let i = 0; i < 10; i++) {
        const canvas = document.createElement("canvas");
        document.body.append(canvas);
        const engine = new GalaxyEngine(canvas, undefined, true, 1);
        engine.resize(400, 300, 1);
        await new Promise((r) => requestAnimationFrame(r));
        engine.dispose();
        retained.push(engine.stats());
        canvas.remove();
      }
      return retained;
    },
    "/@fs" + process.cwd() + "/packages/galaxy-engine/src/index.ts",
  );
  assert.ok(
    lifecycle.every((stat) => stat.contexts === 0 && stat.geometries === 0),
  );
  checks.push("ten renderer teardown cycles");
  const demo = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  demo.on("pageerror", (e) => errors.push(e.message));
  await demo.goto(base + "/?demo=1&freeze=1");
  for (const state of [
    "idle",
    "arming",
    "listening",
    "processing",
    "speaking",
    "error",
  ]) {
    await demo.getByLabel("Orb state").selectOption(state);
    await demo.waitForTimeout(900);
    await demo.screenshot({ path: `docs/evidence/state-${state}.png` });
  }
  checks.push("six labeled demo states");
  await demo.close();
  assert.deepEqual(errors, []);
  const report = {
    checks,
    errors,
    viewport: "1440 × 960",
    browser: await browser.version(),
    note: "Headless browser checks do not establish native audio, provider, Keychain, or M3 Pro frame-rate acceptance.",
  };
  await fs.writeFile(
    "docs/evidence/browser-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
