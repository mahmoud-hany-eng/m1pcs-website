// Test stand-in for src/lib/staff/session.ts. The real one reads the sign-in cookies and demands a verified second factor, none of
// which exists outside a running site. The test installs the staff member, their permissions and the data on `globalThis.__M1_STAFF__`;
// the page then runs exactly as it does for a signed-in staff member.
//
// For the sign-in router and the header's name, the test installs what the staff check says on `globalThis.__M1_NAV__`:
//   staff         one of the states getStaffState returns: { state: "ok" | "needs_mfa" | "not_staff" | "disabled" | "unavailable" | "signed_out" | "expired" }
//   staffProfile  what getStaffProfileFor returns: { state: "staff", displayName } | { state: "not_staff" } | { state: "unavailable" }
export async function requireStaff() {
  const context = globalThis.__M1_STAFF__;
  if (!context) throw new Error("the test did not install a staff context");
  return { staff: context.staff, api: context.api, can: (permission) => context.permissions.has(permission) };
}
export async function getStaffState() {
  const nav = globalThis.__M1_NAV__;
  nav.staffCalls = (nav.staffCalls ?? 0) + 1;
  if (nav.staffThrows) throw new Error("the staff check threw");
  return nav.staff;
}
export async function getStaffProfileFor() {
  const nav = globalThis.__M1_NAV__;
  nav.profileCalls = (nav.profileCalls ?? 0) + 1;
  return nav.staffProfile;
}
export async function requireStaffCandidate() {
  throw new Error("not used by these tests");
}
