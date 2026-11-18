// Support for the browser-level tests: find Playwright, make sure a production build exists and is current, start and
// stop the website, and pick free ports. Playwright is NOT a project dependency (the tests skip without it); this finds
// the copy that is installed on the machine.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const attempts = [() => require("playwright")];
  attempts.push(() => {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return createRequire(join(globalRoot, "x.js"))("playwright");
  });
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      // try the next place
    }
  }
  return null;
}

export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function newestMtime(dir, skip = new Set()) {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    newest = Math.max(newest, stat.isDirectory() ? newestMtime(full, skip) : stat.mtimeMs);
  }
  return newest;
}

/** The synthetic values the build needs so the quotation journey can build a WhatsApp link. Not a real number. */
export const BUILD_ENV = { NEXT_PUBLIC_WHATSAPP_NUMBER: "97455550000", NEXT_PUBLIC_SITE_URL: "https://example.test", NEXT_TELEMETRY_DISABLED: "1" };

/** Builds the website unless a build newer than every source file already exists. */
export function ensureBuild({ force = false } = {}) {
  const marker = join(ROOT, ".next", "BUILD_ID");
  const sourceTime = Math.max(newestMtime(join(ROOT, "src")), statSync(join(ROOT, "package.json")).mtimeMs, statSync(join(ROOT, "next.config.ts")).mtimeMs);
  if (!force && existsSync(marker) && statSync(marker).mtimeMs > sourceTime) return false;
  execFileSync("npm", ["run", "build"], { cwd: ROOT, env: { ...process.env, ...BUILD_ENV }, stdio: "ignore", timeout: 600_000 });
  return true;
}

/** Starts `next start` on a free port with the given extra environment. Resolves once it answers. */
export async function startWebsite(extraEnv = {}) {
  const port = await freePort();
  const env = { ...process.env, ...BUILD_ENV, PORT: String(port) };
  // The flag and Supabase settings come only from what the caller passes, never from the surrounding shell.
  for (const key of Object.keys(env)) if (key.startsWith("CUSTOMER_ACCOUNTS_") || key.startsWith("NEXT_PUBLIC_SUPABASE_") || key === "VERCEL_ENV") delete env[key];
  Object.assign(env, extraEnv);
  const child = spawn(process.execPath, [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next start exited early:\n${log}`);
    try {
      const response = await fetch(`${base}/robots.txt`);
      if (response.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`next start did not come up:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    base,
    port,
    log: () => log,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
    },
  };
}
