// STATIC CHECKS FOR THE UNIFIED LOGIN AND THE PERSONALISED HEADER: what the source files must and must not contain, with no server and no database.
//   * every sign-in entry point (password, sign-up, e-mail link, confirmation, the sign-in page when already signed in) goes through the ONE shared
//     post-sign-in router and never sends the browser to a raw "next" value or to a hard-coded destination;
//   * there is no public staff login, no Admin / Staff link in the public header, and no "My account" / "Track my order" entry;
//   * the root layout stays static (nothing in it can read a cookie), and the person's name arrives from an uncached route handler;
//   * the identity answer carries only a label and one of three fixed addresses; the dashboard link is never prefetched;
//   * the admin shell is ordinary page content under the public header: no full-screen overlay, no z-index war, no global rule that hides the header.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const walk = (dir, keep) => {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, keep));
    else if (keep(rel)) out.push(relative(".", rel));
  }
  return out.sort();
};
const sourceFiles = () => walk("src", (p) => /\.(ts|tsx|js|jsx|mjs)$/.test(p));

describe("one universal sign-in: every entry point uses the shared router", () => {
  const actions = strip(read("src/lib/accounts/server/actions.ts"));

  it("signInAction, signUpAction and the e-mail-link action finish by handing the browser to /auth/continue (continueUrl), never to a raw next value", () => {
    assert.match(actions, /redirect\(continueUrl\(next\)\)/, "signInAction must redirect through continueUrl(next)");
    assert.match(actions, /if \(data\?\.session\) redirect\(continueUrl\(\)\)/, "signUpAction with an immediate session must go through continueUrl()");
    assert.doesNotMatch(actions, /redirect\(next\)/, "no action may redirect straight to the supplied next value");
    assert.doesNotMatch(actions, /redirect\("\/(account|admin)[^"]*"\)/, "no action may hard-code a dashboard as the place to land after signing in");
  });

  it("the confirmation route sends every successful exchange through the router (recovery alone goes to the new-password page)", () => {
    const route = strip(read("src/app/auth/confirm/route.ts"));
    assert.match(route, /continueUrl\(next\)/);
    assert.doesNotMatch(route, /redirect\(next\)/);
    assert.doesNotMatch(route, /\/admin/, "the confirmation route must not know where staff go: the router decides");
    assert.match(route, /\/auth\/reset-password/);
  });

  it("the sign-in page resolves an already-signed-in visitor through resolveAfterSignIn and offers Sign out if the router is unavailable", () => {
    const page = strip(read("src/app/auth/sign-in/page.tsx"));
    assert.match(page, /resolveAfterSignIn\(next\)/);
    assert.match(page, /SignOutForm/);
    assert.doesNotMatch(page, /redirect\(next\)|redirect\("\/account"\)|redirect\("\/admin"\)/);
  });

  it("the shared router is one pure module: no network, no cookies, no framework import", () => {
    const shared = strip(read("src/lib/accounts/shared/post-auth.ts"));
    assert.doesNotMatch(shared, /^\s*import .*from "(next|@supabase|react)/m);
    assert.doesNotMatch(shared, /fetch\(|cookies\(|headers\(/);
    // a lookup failure is its own outcome and is never classified as a customer
    assert.match(shared, /unavailable/);
    assert.match(shared, /case "unavailable"|"unavailable"/);
  });

  it("/auth/continue and the server resolver rest on the verified staff state, not on a typed name, an e-mail address or a role sent by the browser", () => {
    const resolver = strip(read("src/lib/accounts/server/post-auth.ts"));
    assert.match(resolver, /getStaffState\(\)/);
    assert.doesNotMatch(resolver, /email|domain|formData|searchParams|role/i);
    const page = strip(read("src/app/auth/continue/page.tsx"));
    assert.match(page, /resolveAfterSignIn\(/);
    assert.doesNotMatch(page, /email|@m1|domain/i);
  });

  it("the customer account page never shows the set-up screen to a verified staff member and never to a router that could not answer", () => {
    const page = strip(read("src/app/account/page.tsx"));
    assert.match(page, /resolveAfterSignIn\(""\)/);
    assert.match(page, /unavailable/);
  });
});

describe("no public staff login anywhere in the public site", () => {
  it("the header's account entries are exactly Log in and Create account, and nothing in the header mentions staff, admin, My account or Track my order", () => {
    const nav = strip(read("src/lib/accounts/shared/header-nav.ts"));
    assert.match(nav, /"\/auth\/sign-in"/);
    assert.match(nav, /"\/auth\/sign-up"/);
    assert.doesNotMatch(nav, /\/admin|staff|My account|Track my order/i);
    for (const file of ["src/components/layout/Header.tsx", "src/components/layout/AccountMenu.tsx", "src/components/layout/HeaderAccount.tsx"]) {
      const text = strip(read(file));
      assert.doesNotMatch(text, /Admin Login|Staff Login|Staff Dashboard|href="\/admin/i, `${file} must not offer a staff or admin entry`);
    }
  });

  it("no route or page under src/app is a separate staff sign-in", () => {
    const names = walk("src/app", () => true).map((p) => p.toLowerCase());
    assert.deepEqual(names.filter((p) => /(staff|admin)[-_/]?(login|sign-?in)|login[-_/]?(staff|admin)/.test(p)), []);
  });
});

describe("the public pages stay static and the header learns the identity from an uncached route", () => {
  it("the root layout reads no cookie or header and is not forced dynamic", () => {
    const layout = strip(read("src/app/layout.tsx"));
    assert.doesNotMatch(layout, /next\/headers|cookies\(|headers\(|force-dynamic|dynamic\s*=|revalidate\s*=\s*0|noStore|unstable_noStore/);
    assert.match(layout, /HideOnAdmin/);
    assert.match(layout, /headerAccountLinks\(process\.env\)/);
  });

  it("the Header is a static component that renders the client HeaderAccount and has no server-session import", () => {
    const header = strip(read("src/components/layout/Header.tsx"));
    assert.match(header, /HeaderAccount/);
    assert.doesNotMatch(header, /accounts\/server|staff\/session|next\/headers|cookies\(/);
  });

  it("the identity route is dynamic, answers 404 while the account switch is off, and sends every no-store and no-sniff header", () => {
    const route = strip(read("src/app/auth/header-identity/route.ts"));
    assert.match(route, /dynamic = "force-dynamic"/);
    assert.match(route, /customerAccountsGate\(process\.env\)\.enabled/);
    assert.match(route, /status: 404/);
    for (const header of ["Cache-Control", "private, no-store", "Vary", "Cookie", "X-Robots-Tag", "noindex", "X-Content-Type-Options", "nosniff", "Referrer-Policy", "no-referrer", "Cross-Origin-Resource-Policy", "same-origin"]) {
      assert.ok(route.includes(header), `the route must send ${header}`);
    }
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  });

  it("the identity module returns a label, a kind and one of three fixed addresses and nothing else (no e-mail, id, role or permission)", () => {
    const source = strip(read("src/lib/accounts/server/header-identity.ts"));
    const answers = [...source.matchAll(/return \{([^}]*)\}/g)].map((m) => m[1]);
    assert.ok(answers.length >= 6, "the module should have several answers");
    for (const body of answers) {
      const keys = [...body.matchAll(/(\w+):/g)].map((m) => m[1]);
      assert.ok(keys.every((k) => ["state", "kind", "label", "href"].includes(k)), `an answer carries a key beyond state, kind, label and href: ${body}`);
      assert.doesNotMatch(body, /email|user\b|permission|role|phone|session/i);
    }
    const nav = strip(read("src/lib/account-nav.ts"));
    assert.match(nav, /HEADER_DASHBOARD_HREFS\s*=\s*\["\/admin",\s*"\/account",\s*"\/auth\/continue"\]/);
  });

  it("with no sign-in cookie the identity module answers signed_out before any network call", () => {
    const source = strip(read("src/lib/accounts/server/header-identity.ts"));
    const noCookie = source.indexOf('return { state: "signed_out" }');
    const session = source.indexOf("await getSession()");
    assert.ok(noCookie > 0 && session > 0 && noCookie < session, "the cookie check must come before the session lookup");
  });

  it("the client header fetches with no-store, same origin, never prefetches the dashboard and draws no full-page navigation of its own", () => {
    const client = strip(read("src/components/layout/HeaderAccount.tsx"));
    assert.match(client, /cache: "no-store"/);
    assert.match(client, /credentials: "same-origin"/);
    assert.match(client, /prefetch=\{false\}/);
    assert.match(client, /parseHeaderIdentity/);
    assert.doesNotMatch(client, /localStorage|sessionStorage|document\.cookie|dangerouslySetInnerHTML/);
  });

  it("the migration returns only the display name, to signed-in sessions and the gateway, never to anon, PUBLIC or service_role", () => {
    const sql = read("supabase/migrations/20261127120000_staff_header_profile.sql");
    assert.match(sql, /jsonb_build_object\('display_name'/);
    assert.doesNotMatch(sql, /jsonb_build_object\([^)]*(permission|role|email)/i);
    assert.match(sql, /revoke all on function admin\.my_staff_profile\(\) from public, anon, service_role/);
    assert.match(sql, /grant execute on function admin\.my_staff_profile\(\) to authenticated, m1_staff_gateway/);
    assert.doesNotMatch(sql, /\b(drop|alter|delete|truncate)\b\s+(table|function|policy)|update\s+private\./i, "additive only");
  });
});

describe("the admin shell is ordinary page content under the public header", () => {
  const SHELL_FILES = [
    "src/components/admin/AdminShell.tsx",
    "src/components/admin/AdminLoading.tsx",
    "src/app/admin/mfa/page.tsx",
    "src/app/admin/mfa/loading.tsx",
    "src/app/admin/error.tsx",
  ];

  it("none of the shell, loading, error or second-factor files is a full-screen overlay, sets a stacking level above the header, or injects a style tag", () => {
    for (const file of SHELL_FILES) {
      const text = strip(read(file));
      assert.doesNotMatch(text, /\bfixed\b[^"`]*\binset-0\b|\binset-0\b[^"`]*\bfixed\b/, `${file} must not be a fixed full-screen overlay`);
      assert.doesNotMatch(text, /z-\[\d+\]|\bz-(\d{2,}|[1-9]\d)\b/, `${file} must not set its own stacking level`);
      assert.doesNotMatch(text, /<style[\s>]/, `${file} must not inject a style tag`);
      assert.doesNotMatch(text, /body\s*>\s*(header|footer)/, `${file} must not hide the public header or footer`);
    }
  });

  it("no source file hides the public header with a global rule", () => {
    for (const file of [...sourceFiles(), "src/app/globals.css"].filter((p) => existsSync(join(ROOT, p)))) {
      assert.doesNotMatch(strip(read(file)), /body\s*>\s*header\s*[,{]|body\s*>\s*header\s*\{[^}]*display\s*:\s*none/, `${file} must not hide the header`);
    }
  });

  it("the sidebar sticks under the 5rem header and is exactly the viewport height that remains; the footer and chat button are left out only in /admin", () => {
    const shell = strip(read("src/components/admin/AdminShell.tsx"));
    assert.match(shell, /lg:sticky lg:top-20/);
    assert.match(shell, /lg:h-\[calc\(100dvh-5rem\)\]/);
    assert.match(shell, /data-testid="admin-shell"/);
    assert.match(shell, /data-testid="admin-sidebar"/);
    assert.doesNotMatch(shell, /<main[\s>]/, "the root layout already provides main: no nested main landmark");
    const layout = strip(read("src/app/layout.tsx"));
    assert.match(layout, /<HideOnAdmin>[\s\S]*<Footer[\s\S]*<\/HideOnAdmin>/);
  });

  it("the public header is never wrapped in HideOnAdmin (it must show on every dashboard page)", () => {
    const layout = strip(read("src/app/layout.tsx"));
    const header = layout.indexOf("<Header");
    const wrap = layout.indexOf("<HideOnAdmin>");
    assert.ok(header > 0 && wrap > 0);
    const between = layout.slice(layout.indexOf("<Header"), layout.indexOf("/>", header) + 2);
    assert.doesNotMatch(between, /HideOnAdmin/);
    const wrapped = layout.slice(wrap, layout.indexOf("</HideOnAdmin>"));
    assert.doesNotMatch(wrapped, /<Header/);
  });
});

describe("the security boundaries of this change", () => {
  it("no new migration other than the one forward-only staff-profile function belongs to this change, and the authorisation code is untouched in kind", () => {
    const sql = read("supabase/migrations/20261127120000_staff_header_profile.sql");
    assert.doesNotMatch(sql, /staff_members\s*(set|\()|insert\s+into|grant\s+[^;]*\bto\s+(anon|public|service_role)\b/i);
    assert.doesNotMatch(strip(read("src/lib/staff/session.ts")), /email\.endsWith|@m1|domain|role\s*===/);
  });

  it("a staff member is never identified from a typed name, an e-mail domain or a role the browser sends", () => {
    for (const file of ["src/lib/staff/session.ts", "src/lib/accounts/server/post-auth.ts", "src/lib/accounts/server/header-identity.ts", "src/lib/accounts/shared/post-auth.ts"]) {
      assert.doesNotMatch(strip(read(file)), /endsWith\(|\.includes\("@|formData\.get\("(role|name|staff)|searchParams[^;]*role/i, `${file} must not infer staff from client input`);
    }
  });

  it("the customer's display name is read through the customer's own link, never by matching a name or a phone number", () => {
    const data = strip(read("src/lib/accounts/server/data.ts"));
    const start = data.indexOf("loadCustomerDisplayName");
    assert.ok(start > 0);
    const body = data.slice(start, start + 900);
    assert.match(body, /customer_user_links|customer_links|linked/i);
    assert.doesNotMatch(body, /\.ilike\(|\.eq\("phone|\.eq\("full_name|\.eq\("email/);
  });
});
