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
// The account overview's own reads: nothing to show (the tests that render the overview are about WHERE a person is sent, not about their orders).
export async function loadStatuses() {
  return [];
}
export async function loadWorkflowStages() {
  return [];
}
export async function loadOrders() {
  return [];
}
export async function loadLoyalty() {
  return { balances: [], ledger: [] };
}
