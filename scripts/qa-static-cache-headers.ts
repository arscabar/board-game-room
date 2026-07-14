import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { readdir } from "node:fs/promises";
import { request } from "node:http";
import path from "node:path";

async function availablePort() {
  const server = createServer();
  server.unref();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const { port } = address;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(baseUrl: string, childExited: () => boolean) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (childExited()) {
      throw new Error("Static header QA server exited before becoming ready.");
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Static header QA server did not become ready within 20 seconds.");
}

async function headersFor(baseUrl: string, pathname: string) {
  const response = await fetch(`${baseUrl}${pathname}`, { method: "HEAD" });
  assert.equal(response.status, 200, `${pathname} should be served successfully`);
  return response.headers;
}

function assertValidators(headers: Headers, pathname: string) {
  assert(headers.get("etag"), `${pathname} should include an ETag`);
  assert(headers.get("last-modified"), `${pathname} should include Last-Modified`);
}

async function assertConditionalRequest(baseUrl: string, pathname: string, headers: Headers) {
  const etag = headers.get("etag");
  assert(etag);
  const statusCode = await new Promise<number | undefined>((resolve, reject) => {
    const conditionalRequest = request(`${baseUrl}${pathname}`, {
      headers: { "If-None-Match": etag }
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    conditionalRequest.once("error", reject);
    conditionalRequest.end();
  });
  assert.equal(statusCode, 304, `${pathname} should support ETag revalidation`);
}

async function main() {
  const distAssets = path.resolve("dist/assets");
  const assetName = (await readdir(distAssets)).find((name) => /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(name));
  assert(assetName, "A Vite hashed asset is required; run the production build before this QA script.");

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");
  let exited = false;
  let output = "";
  const child = spawn(process.execPath, [tsxCli, "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: "",
      HOST: "127.0.0.1",
      PORT: String(port),
      STATS_FILE: path.resolve("data/stats.json")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.once("exit", () => {
    exited = true;
  });
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });

  try {
    await waitForServer(baseUrl, () => exited);

    const immutableHeaders = await headersFor(baseUrl, `/assets/${assetName}`);
    assert.equal(immutableHeaders.get("cache-control"), "public, max-age=31536000, immutable");
    assertValidators(immutableHeaders, `/assets/${assetName}`);
    await assertConditionalRequest(baseUrl, `/assets/${assetName}`, immutableHeaders);

    const boardHeaders = await headersFor(baseUrl, "/board-assets/textures/club-felt.webp");
    assert.equal(boardHeaders.get("cache-control"), "public, max-age=604800, stale-while-revalidate=86400");
    assertValidators(boardHeaders, "/board-assets/textures/club-felt.webp");

    const brandHeaders = await headersFor(baseUrl, "/brand/brand-mark.svg");
    assert.equal(brandHeaders.get("cache-control"), "public, max-age=604800, stale-while-revalidate=86400");
    assertValidators(brandHeaders, "/brand/brand-mark.svg");

    const nonHashedHeaders = await headersFor(baseUrl, "/assets/materials/felt.webp");
    assert.equal(nonHashedHeaders.get("cache-control"), "public, max-age=86400, stale-while-revalidate=604800");
    assertValidators(nonHashedHeaders, "/assets/materials/felt.webp");

    for (const pathname of ["/", "/index.html", "/rooms/example"]) {
      const htmlHeaders = await headersFor(baseUrl, pathname);
      assert.equal(htmlHeaders.get("cache-control"), "no-store, no-cache, must-revalidate, max-age=0");
      assert.equal(htmlHeaders.get("pragma"), "no-cache");
      assert.equal(htmlHeaders.get("expires"), "0");
      assert.equal(htmlHeaders.get("surrogate-control"), "no-store");
      assert.equal(htmlHeaders.get("clear-site-data"), null);
      assertValidators(htmlHeaders, pathname);
    }

    console.log("Static cache header QA passed.");
  } catch (error) {
    if (output.trim()) {
      console.error(output.trim());
    }
    throw error;
  } finally {
    if (!exited) {
      child.kill();
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 2_000))
      ]);
    }
  }
}

await main();
