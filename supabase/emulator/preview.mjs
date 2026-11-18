// Starts the LOCAL SUPABASE EMULATOR on its own so the customer dashboard can be tried in a browser, with synthetic
// data, and prints exactly what to run next. Nothing here is real: see server.mjs.
//
//   node supabase/emulator/preview.mjs
import { startEmulator } from "./server.mjs";

const emulator = await startEmulator({ port: Number(process.env.EMULATOR_PORT ?? 54399) });
const lines = [
  "",
  "LOCAL SUPABASE EMULATOR is running. It is NOT Supabase; the data is synthetic.",
  "",
  "In another terminal, from the repository root, run the website against it:",
  "",
  `  CUSTOMER_ACCOUNTS_ENABLED=true \\`,
  `  NEXT_PUBLIC_SUPABASE_URL=${emulator.url} \\`,
  `  NEXT_PUBLIC_SUPABASE_ANON_KEY=${emulator.anonKey} \\`,
  `  CUSTOMER_ACCOUNTS_PREVIEW_LABEL="Local preview: demonstration data, not real orders" \\`,
  "  npm run dev",
  "",
  "Then open http://localhost:3000/auth/sign-in and sign in as one of these (they exist only in this run):",
  "",
  ...Object.entries(emulator.users).map(([name, user]) => `  ${name.padEnd(6)} ${user.email}   password: ${user.password}`),
  "",
  "  alice  has three orders (one delivered and paid, one part paid, one cancelled) and loyalty points",
  "  bob    has one order;  eve has an account but no customer profile (she sees the set-up screen)",
  "",
  "Emails are not sent; open them here:  " + `${emulator.url}/__outbox`,
  "Press Ctrl+C to stop. The database is deleted on exit.",
  "",
];
console.log(lines.join("\n"));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await emulator.stop();
    process.exit(0);
  });
}
