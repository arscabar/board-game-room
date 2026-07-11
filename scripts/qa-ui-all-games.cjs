const { chromium } = require("playwright");
const fs = require("fs/promises");
const path = require("path");

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3131";
const runDir =
  process.env.QA_RUN_DIR ||
  path.resolve("artifacts/all-game-ui-qa", `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);

// Visual QA pairs one desktop host with one mobile guest. Full player-count coverage lives in qa-all-games.ts.
const games = [
  { id: "guryongtu", title: "구룡투", players: 2, root: ".guryongtu-module", board: ".guryongtu-choice-panel, .guryongtu-status" },
  { id: "quoridor", title: "쿼리도", players: 2, root: ".qdr-shell", board: ".qdr-board" },
  { id: "abalone-classic", title: "아발론 클래식", players: 2, root: ".abl-shell", board: ".abl-board" },
  { id: "ghosts", title: "고스트", players: 2, root: ".gho-shell", board: ".gho-board, .gho-setup-grid" },
  { id: "qawale", title: "카왈레", players: 2, root: ".qaw-shell", board: ".qaw-3d-canvas" },
  { id: "omok", title: "오목", players: 2, root: ".omok-shell", board: ".omok-board" },
  { id: "alkkagi", title: "알까기", players: 2, root: ".alk-shell", board: ".alk-board" },
  { id: "kkukkkuki", title: "꾹꾹이", players: 2, root: ".kkuk-shell", board: ".kkuk-board" },
  { id: "davinci-code-plus", title: "다빈치 코드 플러스", players: 2, root: ".dvc-shell", board: ".dvc-racks" },
  { id: "blokus", title: "블로커스", players: 2, root: ".blokus-module", board: ".blokus-board" },
  { id: "masterpiece-copy", title: "명화 따라그리기", players: 2, root: ".painting-shell", board: ".painting-canvas-panel" },
  { id: "yacht-dice", title: "요트 다이스", players: 2, root: ".yacht-dice-module", board: ".yacht-throw-tray" },
  { id: "yinsh", title: "인쉬", players: 2, root: ".yinsh-module", board: ".yinsh-board" },
  { id: "hangman-board-game", title: "행맨 보드게임", players: 2, root: ".hangman-module", board: ".hangman-setup-panel, .hangman-board-grid" }
];

const selectedGameIds = (process.env.QA_GAME || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const gamesToRun = selectedGameIds.length > 0 ? games.filter((game) => selectedGameIds.includes(game.id)) : games;
if (selectedGameIds.length > 0 && gamesToRun.length !== selectedGameIds.length) {
  const missing = selectedGameIds.filter((id) => !games.some((game) => game.id === id));
  throw new Error(`Unknown QA_GAME id: ${missing.join(", ")}`);
}

function shortName(prefix, gameId, suffix = "") {
  return `${prefix}${gameId.replace(/[^a-z0-9]/g, "").slice(0, 9)}${suffix}`.slice(0, 16);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fillName(page, name) {
  await page.getByLabel("플레이어 이름").waitFor({ timeout: 15000 });
  await page.getByLabel("플레이어 이름").fill(name);
}

async function createHostRoom(page, game) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const hostName = shortName("H", game.id);
  await fillName(page, hostName);
  const empty = page.locator('.cafe-table-object[data-table-kind="empty"]').first();
  await empty.waitFor({ state: "visible", timeout: 15000 });
  await empty.click({ timeout: 15000 });
  await page.locator(".interactive-game-lobby").waitFor({ timeout: 20000 });
  return hostName;
}

async function joinRoom(page, hostName, guestName) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await fillName(page, guestName);
  const room = page.locator(`.cafe-table-object[data-table-kind="room"][aria-label*="${hostName}"]`).first();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await room.count()) break;
    await page.locator(".cafe-refresh-button").click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await room.waitFor({ state: "attached", timeout: 15000 });
  await room.scrollIntoViewIfNeeded().catch(() => {});
  await room.click({ timeout: 15000 });
  const lobby = page.locator(".interactive-game-lobby").first();
  const enter = page.locator(".entrance-primary-button").first();
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if ((await lobby.count()) > 0) break;
    if (await enter.isVisible().catch(() => false)) {
      await enter.click({ timeout: 15000, force: true }).catch(() => undefined);
    }
    await page.waitForTimeout(250);
  }
  await lobby.waitFor({ state: "attached", timeout: 30000 });
}

async function startSelectedGame(host, game) {
  await host.getByRole("tab", { name: new RegExp(`^${game.players}명`) }).click({ timeout: 10000 }).catch(() => {});
  let gameButton = host.locator(`.game-box-main[aria-label^="${game.title},"]`).first();
  const nextPage = host.getByRole("button", { name: "다음 게임 목록" }).first();
  for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
    if ((await gameButton.count()) > 0 && (await gameButton.isVisible().catch(() => false))) break;
    if (!(await nextPage.isVisible().catch(() => false)) || !(await nextPage.isEnabled().catch(() => false))) break;
    await nextPage.click({ timeout: 5000 });
    await host.waitForTimeout(500);
    gameButton = host.locator(`.game-box-main[aria-label^="${game.title},"]`).first();
  }
  await gameButton.waitFor({ state: "visible", timeout: 15000 });
  await gameButton.scrollIntoViewIfNeeded().catch(() => {});
  await gameButton.click({ timeout: 15000 });

  const start = host.locator(".game-lobby-start-button").first();
  await start.waitFor({ state: "visible", timeout: 15000 });
  for (let i = 0; i < 20; i += 1) {
    if (await start.isEnabled().catch(() => false)) break;
    await host.waitForTimeout(300);
  }
  await start.click({ timeout: 15000 });
}

async function clickFirstEnabled(pages, selector, note, options = {}) {
  const timeout = options.timeout ?? 3500;
  const limit = options.limit ?? 12;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const [pageIndex, page] of pages.entries()) {
      const loc = page.locator(selector);
      const count = Math.min(await loc.count().catch(() => 0), limit);
      for (let i = 0; i < count; i += 1) {
        const item = loc.nth(i);
        const visible = await item.isVisible().catch(() => false);
        const enabled = await item.isEnabled().catch(() => false);
        if (!visible || !enabled) continue;
        await item.scrollIntoViewIfNeeded().catch(() => {});
        await item.click({ timeout: 2500 });
        return `${note}: page${pageIndex + 1} #${i + 1}`;
      }
    }
    await wait(150);
  }
  throw new Error(`${note} 클릭 가능한 요소 없음 (${selector})`);
}

async function setupGhosts(pages, notes) {
  for (const [index, page] of pages.entries()) {
    const setup = page.locator(".gho-setup-actions button").first();
    if (await setup.isVisible().catch(() => false)) {
      await setup.click({ timeout: 5000 });
      notes.push(`고스트 배치 확정: page${index + 1}`);
      await page.waitForTimeout(250);
    }
  }
  await pages[0].locator(".gho-board").waitFor({ timeout: 15000 });
}

async function setupHangman(pages, notes) {
  const words = ["CODE", "PLAY", "MIND", "WORD"];
  for (const [index, page] of pages.entries()) {
    const input = page.locator(".hangman-secret-form input").first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill(words[index] ?? "GAME");
      await page.locator('.hangman-secret-form button[type="submit"]').first().click({ timeout: 5000 });
      notes.push(`행맨 비밀 단어 입력: page${index + 1}`);
      await page.waitForTimeout(350);
    }
  }
  await pages[0].locator(".hangman-guess-panel, .hangman-board-grid").first().waitFor({ timeout: 15000 });
}

async function qawaleCanvasGesture(page, notes) {
  const canvas = page.locator(".qaw-3d-canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("카왈레 3D 캔버스 좌표 없음");
  const candidatePaths = [
    [
      [0.83, 0.52],
      [0.69, 0.47],
      [0.62, 0.57],
      [0.49, 0.53]
    ],
    [
      [0.83, 0.52],
      [0.72, 0.62],
      [0.58, 0.57],
      [0.49, 0.66]
    ],
    [
      [0.18, 0.45],
      [0.32, 0.42],
      [0.39, 0.52],
      [0.53, 0.48]
    ],
    [
      [0.45, 0.72],
      [0.36, 0.62],
      [0.49, 0.58],
      [0.57, 0.48]
    ]
  ];

  const reset = page.getByRole("button", { name: "취소" }).first();
  const place = page.getByRole("button", { name: "놓기" }).first();
  for (const points of candidatePaths) {
    if ((await reset.isVisible().catch(() => false)) && (await reset.isEnabled().catch(() => false))) {
      await reset.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(180);
    }
    for (const [rx, ry] of points) {
      await page.mouse.click(box.x + box.width * rx, box.y + box.height * ry);
      await page.waitForTimeout(260);
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if ((await place.isVisible().catch(() => false)) && (await place.isEnabled().catch(() => false))) break;
      await page.waitForTimeout(160);
    }
    if ((await place.isVisible().catch(() => false)) && (await place.isEnabled().catch(() => false))) {
      await place.click({ timeout: 3000, force: true });
      notes.push("카왈레 캔버스 경로 선택 후 놓기");
      return;
    }
  }

  notes.push("카왈레: 3D 렌더/카메라 확인, 분배 경로 자동화는 완주 못 함");
  await page.locator('.qaw-camera-controls button[aria-label="확대"]').click({ timeout: 3000 }).catch(() => {});
}

async function alkkagiGesture(page, notes) {
  const egg = page.locator(".alk-egg.is-current").first();
  await egg.waitFor({ state: "visible", timeout: 10000 });
  await egg.click({ timeout: 5000 });
  const board = page.locator(".alk-board").first();
  const box = await board.boundingBox();
  if (!box) throw new Error("알까기 보드 좌표 없음");
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.waitForTimeout(850);
  await page.mouse.up();
  notes.push("알까기: 알 선택 후 보드 홀드/릴리즈 발사");
}

async function masterpieceGesture(page, notes) {
  await page.locator(".painting-canvas").waitFor({ state: "visible", timeout: 15000 });
  const fill = page.getByRole("button", { name: "페인트" });
  if (await fill.isVisible().catch(() => false)) {
    await fill.click({ timeout: 5000 });
  }
  const paletteColor = page.locator('button[aria-label*="원본 팔레트 색 선택"]').nth(1);
  if (await paletteColor.isVisible().catch(() => false)) {
    await paletteColor.click({ timeout: 5000 });
  }
  const canvas = page.locator(".painting-canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("명화 따라그리기 캔버스 좌표 없음");
  await page.mouse.click(box.x + box.width * 0.34, box.y + box.height * 0.44);
  await page.getByRole("button", { name: "펜" }).click({ timeout: 5000 }).catch(() => {});
  await page.mouse.move(box.x + box.width * 0.24, box.y + box.height * 0.34);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.42, { steps: 7 });
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.32, { steps: 5 });
  await page.mouse.up();
  notes.push("명화 따라그리기: 팔레트 선택, 페인트 채우기, 펜 스트로크");
}

async function abaloneMove(pages, notes) {
  for (const [pageIndex, page] of pages.entries()) {
    const cells = page.locator(".abl-cell:has(.abl-marble)");
    const count = Math.min(await cells.count().catch(() => 0), 24);
    for (let index = 0; index < count; index += 1) {
      const cell = cells.nth(index);
      if (!(await cell.isVisible().catch(() => false))) continue;
      await cell.click({ timeout: 1800 }).catch(() => {});
      await page.waitForTimeout(180);
      const direction = page.locator(".abl-dir-button.available").first();
      if ((await direction.isVisible().catch(() => false)) && (await direction.isEnabled().catch(() => false))) {
        await direction.click({ timeout: 2500 });
        notes.push(`아발론 이동 가능한 구슬 선택 후 방향 이동: page${pageIndex + 1} cell${index + 1}`);
        return;
      }
      await page.locator(".abl-clear").click({ timeout: 1000 }).catch(() => {});
    }
  }
  throw new Error("아발론 이동 가능한 구슬/방향을 찾지 못함");
}

async function performGameAction(game, pages, notes) {
  switch (game.id) {
    case "yacht-dice":
      notes.push(await clickFirstEnabled(pages, ".yacht-roll-button", "요트 주사위 굴리기"));
      await wait(1200);
      notes.push(await clickFirstEnabled(pages, ".yacht-score-choice:not(.used)", "요트 점수칸 선택"));
      break;
    case "guryongtu":
      notes.push(await clickFirstEnabled(pages, ".guryongtu-tile-button:not(.used)", "구룡투 색상 타일 제출"));
      break;
    case "quoridor":
      notes.push(await clickFirstEnabled(pages, ".qdr-cell.legal", "쿼리도 말 이동"));
      await wait(800);
      notes.push(await clickFirstEnabled(pages, ".qdr-mode-segment button:nth-child(2)", "쿼리도 벽 설치 모드"));
      await wait(250);
      await clickFirstEnabled(pages, ".qdr-wall-hit.valid", "쿼리도 벽 설치")
        .then((value) => notes.push(value))
        .catch((error) => notes.push(`쿼리도 벽 설치 자동화 미완: ${error.message}`));
      break;
    case "abalone-classic":
      await abaloneMove(pages, notes);
      break;
    case "ghosts":
      await setupGhosts(pages, notes);
      notes.push(await clickFirstEnabled(pages, ".gho-token.own", "고스트 자기 유령 선택"));
      await wait(300);
      notes.push(await clickFirstEnabled(pages, ".gho-cell.legal", "고스트 합법 이동"));
      break;
    case "qawale":
      {
        let activePage = pages[0];
        for (const page of pages) {
          const canAct = await page.locator(".qaw-board-actions").first().isVisible().catch(() => false);
          if (canAct) {
            activePage = page;
            break;
          }
        }
        await qawaleCanvasGesture(activePage, notes);
      }
      break;
    case "omok":
      notes.push(await clickFirstEnabled(pages, ".omok-point:not(:has(.omok-stone))", "오목 착수"));
      break;
    case "alkkagi":
      await alkkagiGesture(pages[0], notes);
      await wait(1200);
      break;
    case "kkukkkuki":
      notes.push(await clickFirstEnabled(pages, ".kkuk-cell:not(.occupied)", "꾹꾹이 고양이 놓기"));
      await wait(700);
      break;
    case "davinci-code-plus":
      notes.push(await clickFirstEnabled(pages, ".dvc-action", "다빈치 타일 뽑기"));
      await wait(700);
      break;
    case "blokus":
      notes.push(await clickFirstEnabled(pages, ".blokus-palette button", "블로커스 조각 선택"));
      await wait(350);
      await clickFirstEnabled(pages, '.blokus-board [aria-label*="배치 가능"], .blokus-board button:not(:disabled)', "블로커스 보드 후보 선택")
        .then((value) => notes.push(value))
        .catch((error) => notes.push(`블로커스 보드 후보 자동화 미완: ${error.message}`));
      await wait(350);
      await clickFirstEnabled(pages, ".blokus-placement-confirm", "블로커스 배치 확정")
        .then((value) => notes.push(value))
        .catch((error) => notes.push(`블로커스 배치 확정 자동화 미완: ${error.message}`));
      break;
    case "masterpiece-copy":
      await masterpieceGesture(pages[0], notes);
      break;
    case "yinsh":
      notes.push(await clickFirstEnabled(pages, ".yinsh-point.legal, .yinsh-board [role=\"button\"], .yinsh-hit:not(.disabled)", "인쉬 링/마커 위치 선택"));
      await wait(700);
      break;
    case "hangman-board-game":
      await setupHangman(pages, notes);
      notes.push(await clickFirstEnabled(pages, ".hangman-letter-button:not(:disabled)", "행맨 글자 추측"));
      break;
    default:
      notes.push("조작 시나리오 없음");
  }
}

async function inspectPage(page, game, label) {
  return await page.evaluate(
    ({ root, board, gameId, label: pageLabel }) => {
      function visible(el) {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 1 && rect.height > 1;
      }
      const rootEl = document.querySelector(root);
      const boardEl = document.querySelector(board);
      const overflowX = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth;
      const textOverflow = [];
      for (const el of Array.from(document.querySelectorAll("button, div, span, strong, small, p, td, th, label"))) {
        if (!(el instanceof HTMLElement) || !visible(el)) continue;
        const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
        if (!text || text.length > 80) continue;
        if (el.scrollWidth - el.clientWidth > 10 && el.clientWidth > 18) {
          textOverflow.push({
            tag: el.tagName.toLowerCase(),
            className: String(el.className).slice(0, 80),
            text,
            delta: el.scrollWidth - el.clientWidth
          });
        }
        if (textOverflow.length >= 10) break;
      }
      const boardRect = boardEl?.getBoundingClientRect();
      const rootRect = rootEl?.getBoundingClientRect();
      const enabledControls = Array.from(document.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")).filter((el) =>
        visible(el)
      ).length;
      const privacy = {};
      if (gameId === "davinci-code-plus") {
        const exposed = [];
        document.querySelectorAll(".dvc-tile:not(.private):not(.revealed) span").forEach((el) => {
          const text = (el.textContent || "").trim();
          if (/^[0-9*]+$/.test(text)) exposed.push(text);
        });
        privacy.davinciPotentialExposedHiddenTiles = exposed.slice(0, 12);
      }
      if (gameId === "ghosts") {
        const exposedGhostKinds = [];
        document.querySelectorAll(".gho-token.opponent .gho-kind-symbol").forEach((el) => {
          const text = (el.textContent || "").trim();
          if (text && text !== "?") exposedGhostKinds.push(text);
        });
        privacy.exposedOpponentGhostKinds = exposedGhostKinds.slice(0, 12);
      }
      return {
        label: pageLabel,
        url: location.href,
        rootVisible: Boolean(rootEl && visible(rootEl)),
        boardVisible: Boolean(boardEl && visible(boardEl)),
        rootRect: rootRect
          ? { width: Math.round(rootRect.width), height: Math.round(rootRect.height), top: Math.round(rootRect.top), left: Math.round(rootRect.left) }
          : null,
        boardRect: boardRect
          ? { width: Math.round(boardRect.width), height: Math.round(boardRect.height), top: Math.round(boardRect.top), left: Math.round(boardRect.left) }
          : null,
        overflowX: Math.round(overflowX),
        textOverflow,
        enabledControls,
        bodyTextStart: document.body.innerText.slice(0, 300).replace(/\s+/g, " "),
        privacy
      };
    },
    { root: game.root, board: game.board, gameId: game.id, label }
  );
}

async function testGame(browser, game) {
  const result = {
    id: game.id,
    title: game.title,
    playerCount: game.players,
    passed: false,
    failures: [],
    notes: [],
    inspections: [],
    screenshots: {},
    startedAt: new Date().toISOString(),
    durationMs: 0
  };
  const startMs = Date.now();
  const contexts = [];
  const pages = [];
  try {
    for (let i = 0; i < game.players; i += 1) {
      const isMobile = i === 1;
      const context = await browser.newContext({
        viewport: isMobile ? { width: 360, height: 800 } : i === 0 ? { width: 1280, height: 900 } : { width: 1024, height: 768 },
        isMobile,
        hasTouch: isMobile,
        locale: "ko-KR"
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on("console", (message) => {
        if (message.type() === "error") result.notes.push(`console:${message.text().slice(0, 140)}`);
      });
      pages.push(page);
    }

    const hostName = await createHostRoom(pages[0], game);
    for (let i = 1; i < pages.length; i += 1) {
      await joinRoom(pages[i], hostName, shortName("P", game.id, String(i + 1)));
    }
    await pages[0].waitForTimeout(800);
    await startSelectedGame(pages[0], game);
    for (const page of pages) {
      await page.locator(game.root).waitFor({ state: "visible", timeout: 30000 });
    }
    await pages[0].waitForTimeout(900);
    await performGameAction(game, pages, result.notes);
    await pages[0].waitForTimeout(800);

    const inspectPages = [pages[0], pages[1] ?? pages[0]];
    const inspectLabels = ["desktop-host", pages[1] ? "mobile-guest" : "desktop-host"];
    for (let i = 0; i < inspectPages.length; i += 1) {
      const page = inspectPages[i];
      const label = inspectLabels[i];
      const screenshotPath = path.join(runDir, `${game.id}-${label}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      result.screenshots[label] = screenshotPath;
      result.inspections.push(await inspectPage(page, game, label));
    }

    await pages[0].setViewportSize({ width: 768, height: 1024 });
    await pages[0].waitForTimeout(250);
    const tabletScreenshotPath = path.join(runDir, `${game.id}-tablet-host.png`);
    await pages[0].screenshot({ path: tabletScreenshotPath, fullPage: true });
    result.screenshots["tablet-host"] = tabletScreenshotPath;
    result.inspections.push(await inspectPage(pages[0], game, "tablet-host"));

    for (const inspection of result.inspections) {
      if (!inspection.rootVisible) result.failures.push(`${inspection.label}: 게임 루트가 보이지 않음`);
      if (!inspection.boardVisible) result.failures.push(`${inspection.label}: 핵심 보드가 보이지 않음`);
      if (inspection.boardRect && (inspection.boardRect.width < 180 || inspection.boardRect.height < 140)) {
        result.failures.push(`${inspection.label}: 보드 크기가 너무 작음 ${inspection.boardRect.width}x${inspection.boardRect.height}`);
      }
      if (inspection.overflowX > 24) result.failures.push(`${inspection.label}: 가로 오버플로 ${inspection.overflowX}px`);
      if (inspection.textOverflow.length > 6) result.failures.push(`${inspection.label}: 텍스트 넘침 ${inspection.textOverflow.length}건`);
      if (inspection.enabledControls < 1) result.failures.push(`${inspection.label}: 활성 조작 요소 없음`);
      if (game.id === "ghosts" && inspection.privacy.exposedOpponentGhostKinds?.length) {
        result.failures.push(`${inspection.label}: 상대 고스트 종류 노출 ${inspection.privacy.exposedOpponentGhostKinds.join(",")}`);
      }
      if (game.id === "davinci-code-plus" && inspection.privacy.davinciPotentialExposedHiddenTiles?.length) {
        result.failures.push(`${inspection.label}: 다빈치 숨김 타일 숫자 노출 의심 ${inspection.privacy.davinciPotentialExposedHiddenTiles.join(",")}`);
      }
    }
    result.passed = result.failures.length === 0;
  } catch (error) {
    result.failures.push(`치명 실패: ${error?.stack || error?.message || String(error)}`);
    for (const [index, page] of pages.entries()) {
      try {
        const screenshotPath = path.join(runDir, `${game.id}-failure-page${index + 1}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        result.screenshots[`failure-page${index + 1}`] = screenshotPath;
      } catch {
        // best effort failure capture
      }
    }
  } finally {
    result.durationMs = Date.now() - startMs;
    for (const context of contexts) await context.close().catch(() => {});
  }
  return result;
}

async function writeSummary(results) {
  const summary = {
    baseUrl,
    runDir,
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    results
  };
  await fs.writeFile(path.join(runDir, "all-game-ui-qa-results.json"), JSON.stringify(summary, null, 2), "utf8");
  return summary;
}

(async () => {
  await fs.mkdir(runDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const game of gamesToRun) {
      console.log(`START ${game.id} ${game.title}`);
      const result = await testGame(browser, game);
      results.push(result);
      await writeSummary(results);
      console.log(`${result.passed ? "PASS" : "FAIL"} ${game.id} notes=${result.notes.length} failures=${result.failures.length}`);
      for (const failure of result.failures) {
        console.log(`  - ${failure.split("\n")[0]}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const summary = await writeSummary(results);
  console.log("RUN_DIR", runDir);
  console.log("SUMMARY", JSON.stringify({ total: summary.total, passed: summary.passed, failed: summary.failed }));
  if (summary.failed) process.exitCode = 1;
})();
