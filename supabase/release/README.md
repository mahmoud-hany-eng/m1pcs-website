# PLAT-0004 release runbook (database)

These files are **operator scripts**. They are deliberately **not** in `supabase/migrations/`: nothing applies them automatically,
and a static test forbids `DROP` in a migration. Read `docs/project-memory/architecture/IDEMPOTENCY.md` for the design and the
exact idempotency semantics.

## The sequence (three steps, in this order)

| Step | What | How | Reversible by |
| --- | --- | --- | --- |
| 1. **Expand** | Apply migrations `20261121120000` (transition order: permission first) and `20261121120100` (idempotency, **additive only**). The deployed PLAT-0003 website keeps working: its three write functions are byte-identical afterwards. | the normal migration path (one migration at a time) | nothing needs to be undone: the old website works with or without the new objects; `idempotency_expand_rollback.sql` exists for the unusual case |
| 2. **Deploy** | Deploy the PLAT-0004 website. During the overlap the old and the new website may both be running; both can write. | the normal Vercel deployment | redeploy the previous deployment |
| 3. **Contract** | Apply `idempotency_contract.sql`. The three old write functions become one-line delegations that the gateway **refuses**, so nothing can bypass the idempotency key. | an operator, **only after** every deployment of the old website (Production **and** every Preview that shares the database) is gone | `idempotency_contract_rollback.sql` |

Steps 1 and 2 can ship together. **Step 3 is optional for safety of the data** (the new website always sends a key and the
expected paid amount) and **required to close the old, key-less path** (a stale old deployment could otherwise still write
without protection). Do it when the old website can no longer be reached.

## The guard on the contract step

`idempotency_contract.sql` **refuses to run** unless the same database session first states what it is about to do:

```sql
set m1.confirm_contract = 'old-website-retired';
```

Without it the script stops with `REFUSED: the contract step would break the PLAT-0003 website. NOTHING WAS CHANGED.` (SQLSTATE
`M1C01`) and a hint naming the exact statement. It also refuses (`M1C02`) when the expand migration is missing. The whole script is
**one statement**, so it is atomic however it is sent. Running it twice is harmless.

```bash
# psql: one session, the confirmation first, then the script (the connection string comes from your own environment)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "set m1.confirm_contract = 'old-website-retired';" -f supabase/release/idempotency_contract.sql
```

In a SQL editor or any tool that runs one multi-statement string, paste the `set` line above the script in the same run.

## Undo scripts (all restore the deployed definitions byte for byte, none deletes data)

| Script | Restores | Refuses when |
| --- | --- | --- |
| `idempotency_contract_rollback.sql` | the three PLAT-0003 write functions exactly as deployed (the old website works again) | never; safe to repeat |
| `idempotency_expand_rollback.sql` | removes the four keyed/evidence functions and the claim helper. **Keeps** `private.idempotency_keys` and its rows (they stop a key from ever being accepted twice; re-running the expand migration reuses them) | `M1C03`: you have not stated `set m1.confirm_expand_rollback = 'new-website-retired';` (the new website calls these functions); `M1C04`: the contract is still applied (run the contract rollback first) |
| `transition_order_rollback.sql` | `admin.transition_order` as deployed in PLAT-0003 (this reintroduces the "order checked before permission" defect that migration `20261121120000` fixes) | never |
| `pricing_rewards_rollback.sql` | the eight functions of migration `20261123120100` exactly as deployed, takes away the right to run the two new staff functions, and puts the two policies of migration `20261123120200` back as new versions (an owner's later edit is left alone) | any order carries a discount or redeemed points, or the confirmation `set m1.confirm_pricing_rollback = 'new-website-retired';` is missing (SQLSTATE `M1P01`, `M1P02`) |

The normal recovery for a bad website release is **not** a database undo: redeploy the previous website. Because the expand step
only adds, the previous website works against the expanded database.

## If a migration fails

* Applied as **one query** (the Supabase migration API, `psql -c`, the CLI): the failure rolls everything back. Nothing is half-applied. Fix the cause and apply it again.
* Applied **statement by statement** (`psql -f` without a wrapping transaction): the statements before the failure stay applied. The expand migration is **rerunnable** (`create ... if not exists`, `create or replace`, idempotent grants): fix the cause and run the whole file again; the result is identical to a clean run (a test proves this by interrupting it midway).
* The expand migration ends with self-checks (table shape, privileges, `private.security_audit()`, `private.gateway_audit()`). If one fails the migration fails and rolls back; the message names the problem.

## Before step 1 (read-only)

```sql
-- The expand migration reuses version 20261121120100, which an EARLIER draft of this release also used (with different content, as
-- 20261121120100_idempotency_keys.sql). If any database already recorded that version, the migration tool would skip the new file.
-- Expect NO row here. (The hosted development database was checked read-only on 2026-11-22: it holds only m01 to m15.)
select version, name from supabase_migrations.schema_migrations where version >= '20261121' order by version;
-- Expect the three PLAT-0003 write functions to NOT call the claim helper:
select p.oid::regprocedure from pg_proc p where p.pronamespace = 'admin'::regnamespace
 and p.proname in ('record_payment','create_order','adjust_loyalty') and p.prosrc like '%idempotency_claim%';   -- expect 0 rows
```

## Checks after each step (read-only)

```sql
-- after expand: both generations of the write functions exist
select p.oid::regprocedure from pg_proc p where p.pronamespace = 'admin'::regnamespace
 and p.proname in ('record_payment','create_order','adjust_loyalty','similar_orders') order by 1;
select count(*) from private.security_audit();   -- expect 0
select count(*) from private.gateway_audit();    -- expect 0

-- before contract: nothing written since the new website went out should lack a key (a non-zero number means a key-less writer, such as the old
-- website, is still active). Replace the timestamp with the moment the NEW website became live (not "7 days": that would count legitimate old writes).
select count(*) from public.payments p
 where p.entry_type = 'payment' and p.created_at > timestamptz '2026-12-01 00:00:00+03'   -- <- the deployment time
   and not exists (select 1 from private.idempotency_keys k where k.result_id = p.id);
```

(The last query is a hint, not a proof: an owner at a SQL prompt also writes without a key. **An old Vercel Preview deployment that shares this database never disappears on its own.** Before contract, open the project's deployments in Vercel and confirm that no deployment of the old website (Production or Preview, including any with an alias or a stored link) can still reach the admin area; disabling or deleting it is the operational step that makes the confirmation true.)

## What the tests prove

`npm run release:db:test` rehearses this whole sequence on a disposable PostgreSQL server built from the migrations that are
already deployed: old and new websites coexist after expand, the contract refuses without the confirmation, every undo script
restores the deployed definitions byte for byte, a failed migration changes nothing, a half-applied one is repaired by running it
again. Nothing hosted is touched by the tests or by these files until an operator runs them.

---

# Order workflow v2 release (separate from the idempotency release above)

The owner-defined order workflow is **a second, independent expand step**. Read `docs/project-memory/architecture/ORDER_WORKFLOW.md` first (section 7 is the full sequence).
**Nothing here has been applied to any hosted database.**

**Order matters because PLAT-0004 auto-deploys on every push.** Apply the database (steps 2 and 3) **before** pushing; the earlier website keeps working on the expanded database.

| Step | What | Gate |
| --- | --- | --- |
| 1 | Read-only pre-flight (migration list, the fingerprints in ORDER_WORKFLOW.md section 9, no `workflow_version` column, O-2611-00001 as recorded) | owner authorization A |
| 2 | Apply `20261122120000_order_workflow_v2_schema.sql` (atomic; additive; the release switch ships as 1) | A |
| 3 | Apply `20261122120100_order_workflow_v2_functions.sql` (atomic; five functions replaced with the same signatures, four added) | A |
| 4 | Read-only post-flight (checks below), then look at the earlier Preview | A |
| 5 | Push the reviewed commit **once**; CI runs and Vercel builds the new Preview; verify both | owner authorization B |
| 6 | Adopt O-2611-00001 (owner, one order) | owner authorization C |
| 7 | Acceptance testing by adopting synthetic orders (the switch is still 1), then switch to 2: `select admin.set_policy('orders.workflow', '{"default_version": 2}', 'confirmed_by_owner', '<reason>');` | owner authorization D for the switch |

`order_workflow_v2_rollback.sql` is guarded exactly like the contract step: it refuses (`M1W02`) unless the session first runs
`set m1.confirm_workflow_rollback = 'new-website-retired';`, and refuses (`M1W01`) while any order is on the new workflow, because the earlier
functions cannot move or show such an order. It restores the five earlier function definitions byte for byte and sets the switch back to 1; it deletes nothing.
(With only step 2 applied the earlier website already works: the differential test checks that state too.)

Read-only checks after step 3 (expect the stated results):

```sql
select count(*) from private.security_audit();                                           -- 0
select count(*) from private.gateway_audit();                                            -- 0
select count(*) from public.orders where workflow_version <> 1;                          -- 0 (nothing moved)
select value from private.business_policies where key = 'orders.workflow';               -- {"default_version": 1}
select count(*) from public.order_workflow_stages;                                       -- 22
select count(*) from public.order_statuses;                                              -- 17
select order_ref, status, total_minor, deposit_required_minor, amount_paid_minor from public.orders where order_ref = 'O-2611-00001';
                                                                                         -- in_transit, 435055, 108764, 435055 (unchanged)
select count(*) from public.payments where order_id = (select id from public.orders where order_ref = 'O-2611-00001');   -- 2
select count(*) from public.order_tracking_events where order_id = (select id from public.orders where order_ref = 'O-2611-00001');  -- 4
select count(*) from private.order_status_history where order_id = (select id from public.orders where order_ref = 'O-2611-00001');  -- 5
```

Before step 2, the earlier functions must have exactly these fingerprints (`md5(pg_get_functiondef(oid))`, identical on the hosted development database and on a local build of the
migrations up to the idempotency expand): `transition_order` ce5fd8fbaf9c0b0b97ef496b06fdc146, `publish_tracking_event` 43d3ef4b5bc019b15adc26261a9af7f4, `get_order` 6e27cf9b3a4bc4eae8e98410e34378d7,
`list_orders` 01f5bbc4da54cdaad0b314dcbf34c604, `dashboard_summary` a3f45d9ef90cdc16a608c609b3675e1e (the rollback script restores exactly these five).

## Pricing and rewards (PLAT-0005): three migrations, applied in order

`20261123120000` (schema) and `20261123120100` (functions) are additive and safe for the website that is live today; `20261123120200` is DATA ONLY and is the moment the five deposit tiers and the net-payable earning rule start for NEW orders, so it is the last step and can be held back. It stops (changing nothing) if either policy was edited since. The staged sequence and the rollback are in `docs/project-memory/architecture/PRICING_AND_REWARDS.md` section 7. Nothing of this release has been applied to a hosted database.
