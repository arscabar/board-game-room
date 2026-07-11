const { chromium } = require("playwright");
const fs = require("fs/promises");
const path = require("path");

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3131";
const outputDir = process.env.QA_RUN_DIR || path.resolve("artifacts/victory-sequence-final");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fillName(page, name) {
  await page.getByLabel("플레이어 이름").waitFor({ timeout: 15000 });
  await page.getByLabel("플레이어 이름").fill(name);
}

async function createHostRoom(page, hostName) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await fillName(page, hostName);
  const emptyTable = page.locator('.cafe-table-object[data-table-kind="empty"]').first();
  await emptyTable.waitFor({ state: "visible", timeout: 15000 });
  await emptyTable.click();
  await page.locator(".interactive-game-lobby").waitFor({ timeout: 20000 });
}

async function joinRoom(page, hostName, guestName) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await fillName(page, guestName);
  const room = page.locator(`.cafe-table-object[data-table-kind="room"][aria-label*="${hostName}"]`).first();

  for (let attempt = 0; attempt < 12 && (await room.count()) === 0; attempt += 1) {
    await page.locator(".cafe-refresh-button").click().catch(() => undefined);
    await page.waitForTimeout(700);
  }

  await room.waitFor({ state: "attached", timeout: 15000 });
  await room.scrollIntoViewIfNeeded().catch(() => undefined);
  await room.click();

  const lobby = page.locator(".interactive-game-lobby").first();
  const enter = page.locator(".entrance-primary-button").first();
  for (let attempt = 0; attempt < 120 && (await lobby.count()) === 0; attempt += 1) {
    if (await enter.isVisible().catch(() => false)) {
      await enter.click({ force: true }).catch(() => undefined);
    }
    await page.waitForTimeout(250);
  }
  await lobby.waitFor({ state: "attached", timeout: 30000 });
}

async function startOmok(host) {
  await host.getByRole("tab", { name: /^2명/ }).click().catch(() => undefined);
  let gameButton = host.locator('.game-box-main[aria-label^="오목,"]').first();
  const nextPage = host.getByRole("button", { name: "다음 게임 목록" }).first();

  for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
    if ((await gameButton.count()) > 0 && (await gameButton.isVisible().catch(() => false))) break;
    if (!(await nextPage.isEnabled().catch(() => false))) break;
    await nextPage.click();
    await host.waitForTimeout(450);
    gameButton = host.locator('.game-box-main[aria-label^="오목,"]').first();
  }

  await gameButton.waitFor({ state: "visible", timeout: 15000 });
  await gameButton.scrollIntoViewIfNeeded();
  await gameButton.click();

  const start = host.locator(".game-lobby-start-button").first();
  await start.waitFor({ state: "visible", timeout: 15000 });
  await start.click();
}

async function playMove(pages, row, col) {
  const selector = `.omok-point[data-omok-row="${row}"][data-omok-col="${col}"]`;
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    for (const page of pages) {
      const point = page.locator(selector).first();
      if ((await point.isVisible().catch(() => false)) && (await point.isEnabled().catch(() => false))) {
        await point.click();
        await page.waitForTimeout(180);
        return;
      }
    }
    await pages[0].waitForTimeout(100);
  }

  throw new Error(`No active Omok point at ${row},${col}`);
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(outputDir, name), fullPage: true });
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  assert(dimensions.scrollWidth <= dimensions.clientWidth + 1, `${label} has horizontal overflow`);
}

async function run() {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const mobileContext = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 });
  const host = await desktopContext.newPage();
  const guest = await mobileContext.newPage();
  const stamp = Date.now().toString().slice(-7);
  const hostName = `WinHost${stamp}`.slice(0, 16);
  const guestName = `WinGuest${stamp}`.slice(0, 16);

  try {
    await createHostRoom(host, hostName);
    await joinRoom(guest, hostName, guestName);
    await startOmok(host);
    await Promise.all([
      host.locator(".omok-board").waitFor({ state: "visible", timeout: 20000 }),
      guest.locator(".omok-board").waitFor({ state: "visible", timeout: 20000 })
    ]);

    const moves = [
      [0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3], [0, 4]
    ];
    for (const [row, col] of moves) await playMove([host, guest], row, col);

    await Promise.all([
      host.locator(".victory-board-cue").waitFor({ state: "visible", timeout: 1800 }),
      guest.locator(".victory-board-cue").waitFor({ state: "visible", timeout: 1800 })
    ]);
    assert((await host.locator(".omok-point.winning").count()) === 5, "Final winning line is not visible");
    assert((await host.locator(".post-game-dialog-backdrop").count()) === 0, "Result overlay appeared before board settle");
    await host.locator(".game-module-shell").scrollIntoViewIfNeeded();
    await guest.locator(".game-module-shell").scrollIntoViewIfNeeded();
    await Promise.all([
      capture(host, "desktop-01-board-settle.png"),
      capture(guest, "mobile-01-board-settle.png")
    ]);

    await host.locator(".victory-unified-medallion").waitFor({ state: "visible", timeout: 3600 });
    await guest.locator(".victory-unified-medallion").waitFor({ state: "visible", timeout: 3600 });
    assert((await host.locator(".post-game-dialog").count()) === 0, "Result dialog appeared during the ceremony");
    await Promise.all([
      capture(host, "desktop-02-ceremony.png"),
      capture(guest, "mobile-02-ceremony.png")
    ]);

    await Promise.all([
      host.locator(".post-game-dialog").waitFor({ state: "visible", timeout: 3000 }),
      guest.locator(".post-game-dialog").waitFor({ state: "visible", timeout: 3000 })
    ]);
    await host.waitForTimeout(720);
    const dialogHasFocus = await host.locator(".post-game-dialog").evaluate((dialog) => document.activeElement === dialog);
    const ceremonyOpacity = await host.locator(".victory-effect-overlay").evaluate((overlay) =>
      Number.parseFloat(getComputedStyle(overlay).opacity)
    );
    assert(dialogHasFocus, "Result dialog did not receive focus");
    assert(ceremonyOpacity <= 0.01, "Victory ceremony did not clear before the result dialog settled");
    await Promise.all([
      assertNoHorizontalOverflow(host, "desktop"),
      assertNoHorizontalOverflow(guest, "mobile"),
      capture(host, "desktop-03-result-dialog.png"),
      capture(guest, "mobile-03-result-dialog.png")
    ]);

    await fs.writeFile(
      path.join(outputDir, "report.json"),
      JSON.stringify({
        baseUrl,
        stages: ["board-settle", "ceremony", "result-dialog"],
        settleCueVisibleBeforeOverlay: true,
        winningLineCount: 5,
        dialogFocus: true,
        viewports: ["1280x900", "360x800"]
      }, null, 2)
    );
    console.log(`Victory sequence QA passed: ${outputDir}`);
  } finally {
    await desktopContext.close();
    await mobileContext.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
