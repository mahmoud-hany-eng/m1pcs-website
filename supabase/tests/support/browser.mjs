// Support for the browser-level tests: find Playwright, make sure a production build exists and is current, start and
// stop the website, and pick free ports. Playwright is NOT a project dependency (the tests skip without it); this finds
// the copy that is installed on the machine.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
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
  // CI sets M1_REQUIRE_PLAYWRIGHT=1: a missing browser must FAIL the run there, never silently skip the browser suites.
  if (process.env.M1_REQUIRE_PLAYWRIGHT === "1") throw new Error("M1_REQUIRE_PLAYWRIGHT=1 but Playwright could not be loaded");
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
  // A directory's own time moves when a file in it is deleted or renamed, which no file's time shows.
  let newest = statSync(dir).mtimeMs;
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

/**
 * Builds the website unless a build made by THIS function and newer than every source file already exists. A build made any other way
 * (a plain `npm run build`, as CI and developers do) lacks the synthetic public values these tests need, so it is never reused:
 * the marker file records which environment the reusable build was made with.
 */
export function ensureBuild({ force = false } = {}) {
  const marker = join(ROOT, ".next", "BUILD_ID");
  const stamp = join(ROOT, ".next", "m1-test-build-env.json");
  const wanted = JSON.stringify(BUILD_ENV);
  const sourceTime = Math.max(newestMtime(join(ROOT, "src")), statSync(join(ROOT, "package.json")).mtimeMs, statSync(join(ROOT, "next.config.ts")).mtimeMs);
  const reusable = !force && existsSync(marker) && statSync(marker).mtimeMs > sourceTime && existsSync(stamp) && readFileSync(stamp, "utf8") === wanted;
  if (reusable) return false;
  execFileSync("npm", ["run", "build"], { cwd: ROOT, env: { ...process.env, ...BUILD_ENV }, stdio: "ignore", timeout: 600_000 });
  writeFileSync(stamp, wanted);
  return true;
}

/**
 * A SECOND build of the same source, made with the customer-account and staff switches ON at build time, in a copy of the project (the ordinary
 * build in ROOT is left alone). Why it exists: the public pages are built once, and the header's account control is decided by the switches at
 * BUILD time (the root layout is static). On Vercel the build and the run of a deployment share their variables, so a Preview that has the switches
 * on carries the control on every public page; the ordinary test build has them off, so it never does. This build is that Preview. Returns the
 * directory to give to startWebsite. Reused while it is newer than every source file.
 */
export function ensureSwitchedBuild() {
  const dir = join(tmpdir(), `m1-switched-build-${createHash("sha1").update(ROOT).digest("hex").slice(0, 10)}`);
  const marker = join(dir, ".next", "BUILD_ID");
  const stamp = join(dir, ".next", "m1-switched-build-env.json");
  const env = { ...BUILD_ENV, CUSTOMER_ACCOUNTS_ENABLED: "true", STAFF_ADMIN_ENABLED: "true" };
  const wanted = JSON.stringify(env);
  const sourceTime = Math.max(newestMtime(join(ROOT, "src")), statSync(join(ROOT, "package.json")).mtimeMs, statSync(join(ROOT, "next.config.ts")).mtimeMs);
  if (existsSync(marker) && statSync(marker).mtimeMs > sourceTime && existsSync(stamp) && readFileSync(stamp, "utf8") === wanted) return dir;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of ["src", "public"]) cpSync(join(ROOT, name), join(dir, name), { recursive: true });
  for (const name of ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "tailwind.config.ts", "eslint.config.mjs"]) {
    if (existsSync(join(ROOT, name))) cpSync(join(ROOT, name), join(dir, name));
  }
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  const buildEnv = { ...process.env, ...env };
  for (const key of Object.keys(buildEnv)) if (key.startsWith("STAFF_GATEWAY") || key === "VERCEL_ENV") delete buildEnv[key];
  execFileSync("npm", ["run", "build"], { cwd: dir, env: buildEnv, stdio: "ignore", timeout: 600_000 });
  writeFileSync(stamp, wanted);
  return dir;
}

/** Starts `next start` on a free port with the given extra environment (from the build in `dir`, by default the ordinary one). Resolves once it answers. */
export async function startWebsite(extraEnv = {}, { dir = ROOT } = {}) {
  const port = await freePort();
  const env = { ...process.env, ...BUILD_ENV, PORT: String(port) };
  // The flag and Supabase settings come only from what the caller passes, never from the surrounding shell.
  for (const key of Object.keys(env)) if (key.startsWith("CUSTOMER_ACCOUNTS_") || key.startsWith("STAFF_") || key.startsWith("NEXT_PUBLIC_SUPABASE_") || key === "VERCEL_ENV") delete env[key];
  Object.assign(env, extraEnv);
  const child = spawn(process.execPath, [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
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
