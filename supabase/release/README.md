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

The normal recovery for a bad website release is **not** a database undo: redeploy the previous website. Because the expand step
only adds, the previous website works against the expanded database.

## If a migration fails

* Applied as **one query** (the Supabase migration API, `psql -c`, the CLI): the failure rolls everything back. Nothing is half-applied. Fix the cause and apply it again.
* Applied **statement by statement** (`psql -f` without a wrapping transaction): the statements before the failure stay applied. The expand migration is **rerunnable** (`create ... if not exists`, `create or replace`, idempotent grants): fix the cause and run the whole file again; the result is identical to a clean run (a test proves this by interrupting it midway).
* The expand migration ends with self-checks (table shape, privileges, `private.security_audit()`, `private.gateway_audit()`). If one fails the migration fails and rolls back; the message names the problem.

## Checks after each step (read-only)

```sql
-- after expand: both generations of the write functions exist
select p.oid::regprocedure from pg_proc p where p.pronamespace = 'admin'::regnamespace
 and p.proname in ('record_payment','create_order','adjust_loyalty','similar_orders') order by 1;
select count(*) from private.security_audit();   -- expect 0
select count(*) from private.gateway_audit();    -- expect 0

-- before contract: nothing recent should have been written without a key (a non-zero number means a key-less writer, such as the old website, is still active)
select count(*) from public.payments p
 where p.entry_type = 'payment' and p.created_at > now() - interval '7 days'
   and not exists (select 1 from private.idempotency_keys k where k.result_id = p.id);
```

(The last query is a hint, not a proof: an owner at a SQL prompt also writes without a key. Always confirm in Vercel that no old
deployment still serves the admin area.)

## What the tests prove

`npm run release:db:test` rehearses this whole sequence on a disposable PostgreSQL server built from the migrations that are
already deployed: old and new websites coexist after expand, the contract refuses without the confirmation, every undo script
restores the deployed definitions byte for byte, a failed migration changes nothing, a half-applied one is repaired by running it
again. Nothing hosted is touched by the tests or by these files until an operator runs them.
