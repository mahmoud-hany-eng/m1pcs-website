// Mutation check for the unified login, the personalised header and the dashboards under the public header (PLAT-0007-a4), for the removal of the passwordless sign-in (PLAT-0007-a5, the L rules), and for the confirmation and recovery email links (PLAT-0007-a6, the E rules). Not part of CI (it runs the suites
// many times): run it by hand with
//   node --disable-warning=ExperimentalWarning supabase/tests/mutation/run-unified-nav-mutations.mjs [id ...]
// Each mutation breaks ONE rule in a COPY of the working tree (the real files are never touched), runs the suites that are supposed to notice (cheapest first,
// stopping at the first that fails), and requires one of them to FAIL. A mutation that survives (every suite still passes) means a rule is not really tested.
// No browser suite is run here (they need a rebuild); every rule below is held by a server, database, library or static test.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIG = "supabase/migrations/20261127120000_staff_header_profile.sql";
const SERVER = "supabase/tests/unified-nav.server.test.mjs";
const USTATIC = "supabase/tests/unified-nav.static.test.mjs";
const UDB = "supabase/tests/unified-nav.db.test.mjs";
const STATIC_MAIN = "supabase/tests/static.test.mjs";
const LIB = "supabase/tests/orders-list-lib.test.mjs";
const COMPAT = "supabase/tests/compat.finance.deployed-statements.db.test.mjs";
const POSTAUTH = "src/lib/accounts/shared/post-auth.ts";
const ACTIONS = "src/lib/accounts/server/actions.ts";
const CONFIRM = "src/app/auth/confirm/route.ts";
const IDENTITY = "src/lib/accounts/server/header-identity.ts";
const ROUTE = "src/app/auth/header-identity/route.ts";
const NAVLIB = "src/lib/account-nav.ts";
const HEADERNAV = "src/lib/accounts/shared/header-nav.ts";
const HEADERACCOUNT = "src/components/layout/HeaderAccount.tsx";
const LAYOUT = "src/app/layout.tsx";
const SHELL = "src/components/admin/AdminShell.tsx";
const ACCOUNTPAGE = "src/app/account/page.tsx";
const SIGNIN = "src/app/auth/sign-in/page.tsx";
const SESSION = "src/lib/staff/session.ts";
const GATEWAY = "src/lib/staff/gateway.ts";
const MFAACTIONS = "src/lib/staff/mfa-actions.ts";
const FORMS = "src/components/account/forms.tsx";
const MAGIC_TEMPLATE = "supabase/templates/magic_link.html";
const EMAILLINKS = "supabase/tests/email-links.test.mjs";
const ACCOUNTSLIB = "supabase/tests/accounts-lib.test.mjs";
const SITEURL = "src/lib/accounts/shared/site-url.ts";
const CONFIRM_TEMPLATE = "supabase/templates/confirmation.html";
const RECOVERY_TEMPLATE = "supabase/templates/recovery.html";

/** [id, what the mutation breaks, [[file, text to find, replacement, occurrences?]...], the suites, any of which must catch it] */
const MUTATIONS = [
  ["R01", "router: a failed staff lookup is read as a customer (sent to /account)", [[POSTAUTH, "    case \"unavailable\":\n      return { kind: \"unavailable\" };", "    case \"unavailable\":\n      return { kind: \"go\", to: DEFAULT_AFTER_SIGN_IN };"]], [SERVER, USTATIC]],
  ["R02", "router: a person who is not staff is sent to /admin", [[POSTAUTH, "return { kind: \"go\", to: next.startsWith(\"/account\") ? next : DEFAULT_AFTER_SIGN_IN };", "return { kind: \"go\", to: \"/admin\" };"]], [SERVER]],
  ["R03", "router: a staff member who still needs the second step goes straight to /admin (MFA bypassed)", [[POSTAUTH, "      return { kind: \"go\", to: next.startsWith(\"/admin\") ? `/admin/mfa?next=${encodeURIComponent(next)}` : \"/admin/mfa\" };", "      return { kind: \"go\", to: next || \"/admin\" };"]], [SERVER]],
  ["R04", "router: verified staff with the second step done land on /account", [[POSTAUTH, "return { kind: \"go\", to: next || \"/admin\" };", "return { kind: \"go\", to: next || \"/account\" };"]], [SERVER]],
  ["R05", "router: a signed-out visitor is sent on as if signed in", [[POSTAUTH, "    case \"signed_out\":\n      return { kind: \"sign_in\", reason: \"required\" };", "    case \"signed_out\":\n      return { kind: \"go\", to: DEFAULT_AFTER_SIGN_IN };"]], [SERVER]],
  ["R06", "router: the explicit page is dropped on the way (/account alone is a request)", [[POSTAUTH, "return next === DEFAULT_AFTER_SIGN_IN ? \"\" : next;", "return next;"]], [SERVER]],
  ["R07", "password sign-in redirects straight to the supplied address, not through the router", [[ACTIONS, "  redirect(continueUrl(next));", "  redirect(next || \"/account\");"]], [USTATIC, STATIC_MAIN]],
  ["R08", "the confirmation route redirects straight to the supplied address", [[CONFIRM, "if (!error) return redirect(continueUrl(next));", "if (!error) return redirect(next || \"/account\");", 2]], [USTATIC]],
  ["R09", "the sign-in page does not resolve an already-signed-in visitor through the router", [[SIGNIN, "const route = await resolveAfterSignIn(next);", "const route = { kind: \"go\" as const, to: next || \"/account\" };"]], [USTATIC, SERVER]],
  ["R10", "the account page shows the new-customer set-up to a verified staff member", [[ACCOUNTPAGE, "if (route.kind === \"go\" && route.to.startsWith(\"/admin\")) redirect(route.to);", ""]], [SERVER, USTATIC]],
  ["R11", "the second-step page returns to itself instead of the page the person was heading to", [[MFAACTIONS, "const back = safeAdminHref(safeNextPath(formData.get(\"next\"), \"\"));", "const back = \"\";"]], [STATIC_MAIN, USTATIC, SERVER]],
  ["H01", "header identity: a failed staff lookup falls through to the customer answer", [[IDENTITY, "  if (staff.state === \"unavailable\") return { state: \"signed_in\", kind: \"unknown\", label: headerLabel(\"unknown\", null), href: \"/auth/continue\" };\n", ""]], [SERVER, USTATIC]],
  ["H02", "header identity: a visitor with no sign-in cookie is sent through the whole session check", [[IDENTITY, "  if (!hasCookie) return { state: \"signed_out\" };\n", ""]], [SERVER]],
  ["H03", "header identity: the answer may be cached", [[ROUTE, "\"Cache-Control\": \"private, no-store, max-age=0\"", "\"Cache-Control\": \"public, max-age=60\""]], [SERVER, USTATIC]],
  ["H04", "header identity: the route is answered while the account switch is off", [[ROUTE, "  if (!customerAccountsGate(process.env).enabled) return new NextResponse(null, { status: 404, headers: PRIVATE_HEADERS });\n", ""]], [SERVER, USTATIC]],
  ["H05", "header identity: the answer says which sign-in cookie or e-mail the person has (an extra key)", [[IDENTITY, "return { state: \"signed_in\", kind: \"customer\", label: headerLabel(\"customer\", name), href: \"/account\" };", "return { state: \"signed_in\", kind: \"customer\", label: headerLabel(\"customer\", name), href: \"/account\", email: session.user.email } as never;"]], [SERVER, USTATIC]],
  ["H06", "header: any address in the answer is followed (not only the three fixed ones)", [[NAVLIB, "if (typeof v.href !== \"string\" || !(HEADER_DASHBOARD_HREFS as readonly string[]).includes(v.href)) return null;", "if (typeof v.href !== \"string\") return null;"]], [LIB]],
  ["H07", "header: a name is not cleaned (control, zero-width and bidirectional characters stay)", [[NAVLIB, "    .replace(INVISIBLE, \"\")\n", ""]], [LIB]],
  ["H08", "header: a name has no length limit", [[NAVLIB, "return chars.length > MAX_LABEL ?", "return chars.length > 100000 ?"]], [LIB]],
  ["H09", "header: a person with no name is given an invented one (the kind's neutral label is lost)", [[NAVLIB, "return cleanDisplayName(rawName) ?? FALLBACK_LABEL[kind];", "return cleanDisplayName(rawName) ?? \"Valued customer\";"]], [LIB, SERVER]],
  ["H10", "header: the dashboard link is prefetched", [[HEADERACCOUNT, "        prefetch={false}\n", ""]], [USTATIC]],
  ["H11", "header: the signed-out menu offers My account again", [[HEADERNAV, "    { href: \"/auth/sign-up\", label: \"Create account\", hiddenOn: [] },", "    { href: \"/auth/sign-up\", label: \"Create account\", hiddenOn: [] },\n    { href: \"/account\", label: \"My account\", hiddenOn: [] },"]], [STATIC_MAIN, LIB, USTATIC]],
  ["H12", "layout: the root layout is forced dynamic (public pages would be uncached)", [[LAYOUT, "import { HideOnAdmin } from \"@/components/layout/HideOnAdmin\";", "import { HideOnAdmin } from \"@/components/layout/HideOnAdmin\";\nexport const dynamic = \"force-dynamic\";"]], [USTATIC, STATIC_MAIN]],
  ["H13", "staff name: the staff lookup treats a database error as \"not staff\" (a customer answer)", [[SESSION, "    return { state: \"unavailable\" };\n  }\n}", "    return { state: \"not_staff\" };\n  }\n}"]], [SERVER]],
  ["A01", "admin shell: it is a full-screen overlay again", [[SHELL, "className=\"admin-root mx-auto flex w-full", "className=\"admin-root fixed inset-0 z-[60] mx-auto flex w-full"]], [USTATIC]],
  ["A02", "admin shell: the sidebar does not stick under the header", [[SHELL, "className=\"lg:sticky lg:top-20 lg:flex", "className=\"lg:flex"]], [USTATIC]],
  ["A03", "layout: the footer and chat button are shown inside the admin area", [[LAYOUT, "        <HideOnAdmin>", "        <>"], [LAYOUT, "        </HideOnAdmin>", "        </>"]], [USTATIC]],
  ["A04", "admin shell: the work-area title block is a second <header>", [[SHELL, "          <div className=\"mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between\">", "          <header className=\"mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between\">"], [SHELL, "            {actions ? <div className=\"flex flex-wrap items-center gap-2\">{actions}</div> : null}\n          </div>", "            {actions ? <div className=\"flex flex-wrap items-center gap-2\">{actions}</div> : null}\n          </header>"]], [USTATIC, STATIC_MAIN]],
  ["D01", "migration: the function is executable by anon", [[MIG, "grant execute on function admin.my_staff_profile() to authenticated, m1_staff_gateway;", "grant execute on function admin.my_staff_profile() to anon, authenticated, m1_staff_gateway;"]], [UDB, USTATIC]],
  ["D02", "migration: an expired or someone else's sign-in session is accepted through the gateway", [[MIG, "    if sid is null or not exists (\n      select 1 from auth.sessions s\n      where s.id = sid and s.user_id = uid and (s.not_after is null or s.not_after > now())\n    ) then\n      return null;\n    end if;", "    null;"]], [UDB]],
  ["D03", "migration: an inactive staff member is named", [[MIG, "where sm.user_id = uid and sm.is_active;", "where sm.user_id = uid;"]], [UDB]],
  ["D04", "migration: the answer carries the role", [[MIG, "jsonb_build_object('display_name', nullif(btrim(member.display_name), ''))", "jsonb_build_object('display_name', nullif(btrim(member.display_name), ''), 'role', 'owner')"]], [UDB, USTATIC]],
  ["D05", "migration: a blank name is returned as a blank string instead of null", [[MIG, "nullif(btrim(member.display_name), '')", "member.display_name"]], [UDB]],
  ["D06", "migration: a customer or anonymous caller gets an answer (the staff check is gone)", [[MIG, "  select * into member from private.staff_members sm where sm.user_id = uid and sm.is_active;\n  if not found then\n    return null;\n  end if;", "  select * into member from private.staff_members sm where sm.user_id = uid and sm.is_active;"]], [UDB]],
  ["D07", "gateway: the fixed statement for the staff name is changed", [[GATEWAY, "my_staff_profile: \"select admin.my_staff_profile() as r\"", "my_staff_profile: \"select admin.my_staff_profile()::text as r\""]], [COMPAT, USTATIC, UDB]],
  // The removal of the passwordless (magic-link) sign-in: each of these puts one piece of it back.
  ["L01", "confirmation route: a magic-link token is accepted again", [[CONFIRM, "const ALLOWED_TYPES: readonly EmailOtpType[] = [\"signup\", \"email\", \"recovery\"];", "const ALLOWED_TYPES: readonly EmailOtpType[] = [\"signup\", \"email\", \"magiclink\", \"recovery\"];"]], [USTATIC, STATIC_MAIN]],
  ["L02", "actions: an action that signs in by emailed link is added again", [[ACTIONS, "export async function signOutAction(): Promise<void> {", "export async function emailLinkAction(): Promise<void> {\n  assertEnabled();\n  const supabase = await createSupabaseServerClient();\n  await supabase?.auth.signInWithOtp({ email: \"someone@example.test\" });\n}\n\nexport async function signOutAction(): Promise<void> {"]], [USTATIC]],
  ["L03", "sign-in page: the welcome heading is lost", [[SIGNIN, "title=\"Welcome back\"", "title=\"Sign in\""]], [USTATIC, SERVER]],
  ["L04", "sign-in page: a second form (a sign-in-link form) is put back under an \"or\" divider", [[SIGNIN, "      <SignInForm next={next} />", "      <SignInForm next={next} />\n      <SignInForm next={next} />"]], [USTATIC, SERVER]],
  ["L05", "email templates: the sign-in-link email carries a working link and token again", [[MAGIC_TEMPLATE, "<p>Signing in by email link is not offered on this site.", "<p><a href=\"{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink\">Sign in</a></p><p>Signing in by email link is not offered on this site."]], [USTATIC]],
  ["L06", "the sign-in form's main button no longer says Log in", [[FORMS, "        Log in\n      </Submit>", "        Sign in\n      </Submit>"]], [USTATIC]],
  ["L07", "the forgot-password action is removed (password recovery would stop working)", [[ACTIONS, "supabase.auth.resetPasswordForEmail(parsed.value.email, redirectTo ? { redirectTo } : undefined)", "Promise.resolve({ error: null })"]], [USTATIC]],
  // The confirmation and recovery emails (PLAT-0007-a6, the E rules): each puts one piece of the 2cd3424 sign-up bug (or a neighbour of it) back.
  ["E01", "the confirmation address has no query string when no page is given (the 2cd3424 bug: the template's '&token_hash=' then makes '/auth/confirm&token_hash=')", [[SITEURL, "url.searchParams.set(\"next\", next || DEFAULT_CONFIRM_NEXT);", "if (next) url.searchParams.set(\"next\", next);"]], [EMAILLINKS, ACCOUNTSLIB]],
  ["E02", "the confirmation template joins the token with '?' instead of '&'", [[CONFIRM_TEMPLATE, "{{ .RedirectTo }}&token_hash=", "{{ .RedirectTo }}?token_hash="]], [EMAILLINKS]],
  ["E03", "the recovery template carries a type the confirmation route refuses", [[RECOVERY_TEMPLATE, "&type=recovery", "&type=magiclink"]], [EMAILLINKS]],
  ["E04", "the confirmation template drops the verification type", [[CONFIRM_TEMPLATE, "&type=email", ""]], [EMAILLINKS]],
  ["E05", "the site address is taken from the request even for a remote host", [[SITEURL, "  if (host !== \"localhost\" && host !== \"127.0.0.1\") return null;\n", ""]], [EMAILLINKS, ACCOUNTSLIB]],
  ["E06", "sign-up and resend send no address to the Auth service at all", [[ACTIONS, "options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,", "options: undefined,", 2]], [EMAILLINKS]],
  ["E07", "the confirmation route accepts a sign-in (magic) link again", [[CONFIRM, "const ALLOWED_TYPES: readonly EmailOtpType[] = [\"signup\", \"email\", \"recovery\"];", "const ALLOWED_TYPES: readonly EmailOtpType[] = [\"signup\", \"email\", \"magiclink\", \"recovery\"];"]], [EMAILLINKS, USTATIC]],
  ["E08", "a recovery link ends at the dashboard instead of the new-password page", [[CONFIRM, "if (!error && type === \"recovery\") return redirect(\"/auth/reset-password\");", ""]], [EMAILLINKS]],
];

const only = new Set(process.argv.slice(2));
const work = mkdtempSync(join(tmpdir(), "m1-unified-nav-mutation-"));
const copy = join(work, "tree");
for (const dir of ["src", "supabase", "ops", "docs", "public"]) cpSync(join(ROOT, dir), join(copy, dir), { recursive: true });
for (const f of ["package.json", "tsconfig.json", "next.config.ts", "tailwind.config.ts", "postcss.config.mjs", "next-env.d.ts", "eslint.config.mjs", "vercel.json"]) cpSync(join(ROOT, f), join(copy, f));
symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));

const results = [];
try {
  for (const [id, what, edits, suites] of MUTATIONS) {
    if (only.size && !only.has(id)) continue;
    const originals = new Map();
    let notApplied = null;
    for (const [file, find, replace, expected = 1] of edits) {
      const path = join(copy, file);
      const text = readFileSync(path, "utf8");
      if (!originals.has(file)) originals.set(file, text);
      const hits = text.split(find).length - 1;
      if (hits !== expected) {
        notApplied = `NOT APPLIED (${file}: the text occurs ${hits} times, expected ${expected})`;
        break;
      }
      writeFileSync(path, text.split(find).join(replace));
    }
    if (notApplied) {
      for (const [file, text] of originals) writeFileSync(join(copy, file), text);
      results.push({ id, what, verdict: notApplied });
      console.log(`${id}  ${notApplied}  ${what}`);
      continue;
    }
    const caught = [];
    for (const suite of suites) {
      const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning", "--test", suite], {
        cwd: copy, encoding: "utf8", timeout: 900_000, env: { ...process.env, M1_REQUIRE_PG: "1" },
      });
      const failing = (r.stdout.match(/^\s*not ok /gm) ?? []).length;
      if (r.status !== 0 && failing > 0) {
        caught.push(`${suite.split("/").pop()} (${failing} failing)`);
        break;
      }
    }
    for (const [file, text] of originals) writeFileSync(join(copy, file), text);
    results.push({ id, what, verdict: caught.length ? `CAUGHT by ${caught.join(", ")}` : "SURVIVED" });
    console.log(`${id}  ${caught.length ? "caught" : "SURVIVED"}  ${what}  ${caught.join(", ")}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
const survived = results.filter((r) => !r.verdict.startsWith("CAUGHT"));
console.log(`\n${results.length - survived.length} of ${results.length} mutations caught.`);
for (const r of survived) console.log(`  ${r.id}: ${r.verdict}  (${r.what})`);
process.exit(survived.length ? 1 : 0);
