import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { Badge, DataTable, Section } from "@/components/admin/ui";
import { DepositScheduleForm, type ScheduleDefaults } from "@/components/admin/forms";
import { formatQar } from "@/lib/platform/money";
import { formatWhen, percentLabel, plainAmount } from "@/lib/staff/format";
import { requireStaff } from "@/lib/staff/session";
import type { PolicyRow } from "@/lib/staff/types";

interface Tier {
  up_to_minor?: number;
  percent_bps: number;
}

function tiersOf(policy: PolicyRow | undefined): Tier[] | null {
  const value = policy?.value as { mode?: string; tiers?: Tier[] } | undefined;
  return value?.mode === "tiered" && Array.isArray(value.tiers) ? value.tiers : null;
}

export default async function PoliciesPage() {
  const { staff, api, can } = await requireStaff("/admin/policies");
  if (!can("policies.read")) notFound();
  const policies = await api.policies();
  const deposit = policies.find((p) => p.key === "orders.deposit");
  const versions = deposit ? await api.policyVersions("orders.deposit") : [];
  const tiers = tiersOf(deposit);
  const defaults: ScheduleDefaults = {
    firstUpTo: tiers?.[0]?.up_to_minor !== undefined ? plainAmount(tiers[0].up_to_minor) : "3000.00",
    secondUpTo: tiers?.[1]?.up_to_minor !== undefined ? plainAmount(tiers[1].up_to_minor) : "5000.00",
    percent1: tiers ? percentLabel(tiers[0].percent_bps).replace("%", "") : "",
    percent2: tiers ? percentLabel(tiers[1].percent_bps).replace("%", "") : "",
    percent3: tiers ? percentLabel(tiers[2].percent_bps).replace("%", "") : "",
  };
  return (
    <AdminShell
      active="policies"
      email={staff.email}
      can={can}
      title="Policies"
      description="Business rules the system applies. Every change is a new version with a reason, and earlier orders keep the figures they were given."
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
    >
      <Section
        title="Deposit schedule"
        aside={deposit ? <Badge tone={deposit.confirmation === "confirmed_by_owner" ? "done" : "paused"}>{deposit.confirmation === "confirmed_by_owner" ? "Confirmed by the owner" : "Not confirmed"}</Badge> : null}
      >
        {tiers ? (
          <div className="mb-5">
            <p className="mb-3 text-sm text-text-secondary">
              The deposit is a percentage of the <span className="font-semibold text-white">whole order total</span>, chosen by the total, rounded to the nearest dirham (a half rounds up). It is recorded as paid only after a staff member confirms receipt.
            </p>
            <DataTable
              rows={tiers.map((tier, index) => ({ tier, index }))}
              rowKey={(r) => String(r.index)}
              empty=""
              columns={[
                {
                  key: "range",
                  header: "Order total",
                  primary: true,
                  cell: ({ tier, index }) =>
                    index === 0
                      ? `Up to ${formatQar(tier.up_to_minor ?? 0)}`
                      : tier.up_to_minor !== undefined
                        ? `Above ${formatQar(tiers[index - 1].up_to_minor ?? 0)}, up to ${formatQar(tier.up_to_minor)}`
                        : `Above ${formatQar(tiers[index - 1].up_to_minor ?? 0)}`,
                },
                { key: "pct", header: "Deposit", cell: ({ tier }) => percentLabel(tier.percent_bps), align: "right" },
              ]}
            />
          </div>
        ) : (
          <p className="mb-5 rounded-glass-sm border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">No confirmed schedule is in force. Orders cannot be confirmed until one is saved.</p>
        )}
        <p className="mb-5 text-sm text-text-muted">Whether deposits are refundable, and which payment methods qualify for a refund, are undecided. Nothing here assumes either.</p>
        {can("policies.manage") ? (
          <div className="border-t border-border pt-5">
            <h3 className="mb-3 font-display text-base font-semibold text-white">Change the schedule</h3>
            <DepositScheduleForm defaults={defaults} />
          </div>
        ) : null}
      </Section>

      <Section title="Version history">
        <DataTable
          rows={versions}
          rowKey={(v) => String(v.version)}
          empty="No earlier versions."
          columns={[
            { key: "version", header: "Version", cell: (v) => `v${v.version}`, primary: true },
            { key: "when", header: "Changed", cell: (v) => formatWhen(v.changed_at) },
            { key: "state", header: "Status", cell: (v) => v.confirmation.replace(/_/g, " ") },
            { key: "by", header: "By", cell: (v) => v.changed_by ?? "system" },
            { key: "reason", header: "Reason", cell: (v) => v.reason ?? "—" },
          ]}
        />
      </Section>

      <Section title="Other rules">
        <DataTable
          rows={policies.filter((p) => p.key !== "orders.deposit")}
          rowKey={(p) => p.key}
          empty="None."
          columns={[
            { key: "key", header: "Rule", cell: (p) => <span className="font-mono text-xs">{p.key}</span>, primary: true },
            { key: "desc", header: "What it controls", cell: (p) => p.description },
            { key: "state", header: "Status", cell: (p) => (p.confirmation === "confirmed_by_owner" ? <Badge tone="done">Confirmed</Badge> : <Badge tone="paused">Placeholder</Badge>) },
          ]}
        />
      </Section>
    </AdminShell>
  );
}
