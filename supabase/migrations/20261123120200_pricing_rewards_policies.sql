-- PLAT-0005, order pricing and rewards, migration 3 of 3: the two policies the owner changed.
--
-- This is DATA, kept in its own migration on purpose: it is the moment the new rules start to apply to NEW orders, so it is the last
-- step of the rollout and can be applied (or held back) separately from the schema and the functions.
--
--   orders.deposit       five tiers instead of three, worked out from the ORIGINAL GROSS order total (whole total, not slices):
--                          up to QAR 3,000.00 ........ 15 %      QAR 5,000.01 to 10,000.00 ... 35 %      above QAR 15,000.00 ... 60 %
--                          QAR 3,000.01 to 5,000.00 .. 25 %      QAR 10,000.01 to 15,000.00 .. 50 %
--                        Rounded to the nearest QAR 0.01, a half rounding up (private.deposit_quote, unchanged). A discount or a
--                        redeemed point never lowers the tier or the deposit.
--   loyalty.earning_base points are earned on the NET payable amount (gross - discount - loyalty credit), rounded down.
--
-- Prospective only. A policy change never touches an order that already exists: an order's deposit is fixed when it is confirmed
-- (deposit_fixed_at, deposit_rule, deposit_policy_version on the order) and a trigger refuses to change it afterwards. An order
-- that was created but not yet confirmed has no fixed deposit; it is worked out again, under the policy in force, when it is
-- confirmed. The previous values stay in private.business_policy_versions.
--
-- Careful: if the policy is not in the state the earlier migrations left it in (somebody changed it since), this migration stops
-- with an explanation instead of overwriting the owner's change.

do $$
declare
  old_deposit constant jsonb := '{"mode": "tiered", "minimum_minor": 0, "required_before_status": "deposit_received", "tiers": [{"up_to_minor": 300000, "percent_bps": 1500}, {"up_to_minor": 500000, "percent_bps": 2500}, {"percent_bps": 3500}]}';
  new_deposit constant jsonb := '{"mode": "tiered", "minimum_minor": 0, "required_before_status": "deposit_received", "tiers": [{"up_to_minor": 300000, "percent_bps": 1500}, {"up_to_minor": 500000, "percent_bps": 2500}, {"up_to_minor": 1000000, "percent_bps": 3500}, {"up_to_minor": 1500000, "percent_bps": 5000}, {"percent_bps": 6000}]}';
  old_base constant jsonb := '{"base": "order_total", "rounding": "floor"}';
  new_base constant jsonb := '{"base": "net_payable", "rounding": "floor"}';
  current_value jsonb;
  problem text;
  k text;
  case_row record;
  digest_before text;
begin
  -- A fingerprint of every order's money and deposit before anything changes, compared again at the end.
  digest_before := (
    select md5(coalesce(string_agg(o.id::text || ':' || o.total_minor || ':' || o.deposit_required_minor || ':' || coalesce(o.deposit_policy_version::text, '-')
                                   || ':' || coalesce(o.deposit_rule, '-') || ':' || o.amount_paid_minor, ',' order by o.id), ''))
    from public.orders o);

  -- ---- orders.deposit ----
  select value into current_value from private.business_policies where key = 'orders.deposit';
  if current_value is null then
    raise exception 'the orders.deposit policy is missing';
  elsif current_value = new_deposit then
    null; -- already applied
  elsif current_value = old_deposit then
    perform set_config('m1.policy_reason', 'PLAT-0005: the owner confirmed five deposit tiers on 2026-11-22 (15 / 25 / 35 / 50 / 60 percent of the original gross order total)', true);
    update private.business_policies
       set value = new_deposit,
           description = 'Confirmed by the owner on 2026-11-22: a percentage of the ORIGINAL GROSS order total (the whole total, not slices): up to QAR 3,000.00 is 15; to 5,000.00 is 25; to 10,000.00 is 35; to 15,000.00 is 50; above is 60. Discounts and redeemed points never lower it. Nearest QAR 0.01, a half rounds up. New orders only: a confirmed order keeps its fixed deposit.',
           confirmation = 'confirmed_by_owner',
           open_question = null,
           version = version + 1,
           updated_at = now()
     where key = 'orders.deposit';
    perform set_config('m1.policy_reason', '', true);
  else
    raise exception 'the orders.deposit policy is not the schedule this migration replaces (it has been changed since); nothing was changed. Review it with the owner and set the five tiers with admin.set_policy';
  end if;

  -- ---- loyalty.earning_base ----
  select value into current_value from private.business_policies where key = 'loyalty.earning_base';
  if current_value is null then
    raise exception 'the loyalty.earning_base policy is missing';
  elsif current_value = new_base then
    null; -- already applied
  elsif current_value = old_base then
    perform set_config('m1.policy_reason', 'PLAT-0005: the owner decided on 2026-11-22 that points are earned on the net final amount payable, excluding discounts and redeemed credit, rounded down', true);
    update private.business_policies
       set value = new_base,
           description = 'Confirmed by the owner on 2026-11-22: points are earned on the NET amount payable (total less discount less redeemed credit), rounded down. None on discounted or credited money. Awarded once, when the order is delivered and fully settled.',
           confirmation = 'confirmed_by_owner',
           open_question = null,
           version = version + 1,
           updated_at = now()
     where key = 'loyalty.earning_base';
    perform set_config('m1.policy_reason', '', true);
  else
    raise exception 'the loyalty.earning_base policy is not the rule this migration replaces (it has been changed since); nothing was changed. Review it with the owner and set net_payable with admin.set_policy';
  end if;

  -- The stored values must pass the same validator that admin.set_policy applies to every later change, and the new deposit schedule
  -- must give exactly the deposits the owner listed at every boundary.
  foreach k in array array['orders.deposit', 'loyalty.earning_base'] loop
    select private.policy_error(k, value) into problem from private.business_policies where key = k;
    if problem is not null then
      raise exception 'the policy % does not validate: %', k, problem;
    end if;
  end loop;

  for case_row in
    select * from (values
      (0::bigint, 0::bigint), (300000, 45000), (300001, 75000), (500000, 125000), (500001, 175000),
      (1000000, 350000), (1000001, 500001), (1500000, 750000), (1500001, 900001)
    ) as t (total_minor, expected_deposit_minor)
  loop
    if (private.deposit_quote(case_row.total_minor)).amount_minor is distinct from case_row.expected_deposit_minor then
      raise exception 'the deposit for % is % but the owner''s schedule gives %', case_row.total_minor,
        (private.deposit_quote(case_row.total_minor)).amount_minor, case_row.expected_deposit_minor;
    end if;
  end loop;

  -- no existing order was touched: every order's total, deposit, recorded rule and paid amount are exactly what they were
  if (select md5(coalesce(string_agg(o.id::text || ':' || o.total_minor || ':' || o.deposit_required_minor || ':' || coalesce(o.deposit_policy_version::text, '-')
                                     || ':' || coalesce(o.deposit_rule, '-') || ':' || o.amount_paid_minor, ',' order by o.id), ''))
      from public.orders o) is distinct from digest_before then
    raise exception 'an existing order changed while the policies were updated; this migration must not change any order';
  end if;
end;
$$;
