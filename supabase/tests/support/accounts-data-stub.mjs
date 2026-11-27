// Test stand-in for src/lib/accounts/server/data.ts (the customer reads): what the test installed on `globalThis.__M1_NAV__`.
export async function loadCustomerDisplayName() {
  const nav = globalThis.__M1_NAV__;
  nav.nameCalls = (nav.nameCalls ?? 0) + 1;
  if (nav.customerNameError) throw new Error("the customer profile could not be read");
  return nav.customerName ?? null;
}
export async function loadCustomers() {
  return globalThis.__M1_NAV__?.customers ?? [];
}
// The account pages' own reads. Nothing to show by default (the tests that render the overview are about WHERE a person is sent, not about their orders);
// a test that renders the order pages installs `globalThis.__M1_NAV__.account = { statuses, stages, orders, detail: { [ref]: {order, items, events, payments} }, payments }`.
const account = () => globalThis.__M1_NAV__?.account ?? {};
export async function loadStatuses() {
  return account().statuses ?? [];
}
export async function loadWorkflowStages() {
  return account().stages ?? [];
}
export async function loadOrders() {
  return account().orders ?? [];
}
export async function loadOrderDetail(_supabase, ref) {
  return account().detail?.[ref] ?? null;
}
export async function loadPayments() {
  return account().payments ?? [];
}
export async function loadLoyalty() {
  return account().loyalty ?? { balances: [], ledger: [] };
}
