// Starts the website (a production build, `next start`) wired to the OFFICIAL Supabase local stack: the real Auth
// service, REST layer, database and mail-testing service. The staff gateway logs in as the dedicated gateway role with a
// throw-away password set for this run only (and removed again by `stop`).
import { randomBytes } from "node:crypto";
import { ensureBuild, loadPlaywright, startWebsite } from "../support/browser.mjs";
import { ownerClient, readStack } from "./stack.mjs";

export { loadPlaywright };

export async function startRealSite({ staffAdmin = true } = {}) {
  const stack = readStack();
  if (!stack) throw new Error("the official Supabase local stack is not running");
  ensureBuild();
  const db = await ownerClient(stack);
  const password = randomBytes(18).toString("hex");
  await db.query(`alter role m1_staff_gateway login password '${password}'`);
  const url = new URL(stack.dbUrl);
  url.username = "m1_staff_gateway";
  url.password = password;
  const site = await startWebsite({
    CUSTOMER_ACCOUNTS_ENABLED: "true",
    ...(staffAdmin ? { STAFF_ADMIN_ENABLED: "true", STAFF_GATEWAY_DATABASE_URL: url.toString() } : {}),
    CUSTOMER_ACCOUNTS_PREVIEW_LABEL: "Local test: official Supabase stack, synthetic data",
    NEXT_PUBLIC_SUPABASE_URL: stack.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
  });
  return {
    stack,
    db,
    base: site.base,
    log: () => site.log?.() ?? "",
    async stop() {
      await site.stop();
      await db.query("alter role m1_staff_gateway nologin password null").catch(() => {});
      await db.end();
    },
  };
}
