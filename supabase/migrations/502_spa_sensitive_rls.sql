-- =============================================================================
-- Migration 502: Spa & Wellness — tighten RLS on sensitive tables
-- =============================================================================
-- Every spa_* table enabled RLS but used USING (true) TO authenticated —
-- acceptable for operational lookups, but it meant ANY signed-in user could
-- read medical profiles (allergies, contraindications) and financial records
-- (transactions, gift-card balances, memberships) by calling PostgREST
-- directly, bypassing the API's permission checks entirely.
--
-- This migration adds auth_has_spa_permission(code) — which resolves the
-- caller's role_permissions the same way the API layer does — and scopes the
-- sensitive tables to the matching spa:* permission. The Express API uses the
-- service-role client, which bypasses RLS, so portal behavior is unchanged.
-- =============================================================================

create or replace function public.auth_has_spa_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from user_roles ur
    join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id
    left join permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()::text
      and (r.is_superuser or p.code = perm)
  )
  or exists (
    select 1
    from user_roles ur
    join roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()::text
      and r.name in ('executive','general_manager','system_admin','admin','gm','owner')
  );
$$;

revoke all on function public.auth_has_spa_permission(text) from public;
revoke execute on function public.auth_has_spa_permission(text) from anon;
grant execute on function public.auth_has_spa_permission(text) to authenticated;

-- ── Wellness profiles: medical data ───────────────────────────────────────
drop policy if exists spa_wellness_profiles_authenticated on public.spa_wellness_profiles;
drop policy if exists spa_wellness_profiles_all on public.spa_wellness_profiles;
create policy spa_wellness_profiles_scoped on public.spa_wellness_profiles
  for all to authenticated
  using (public.auth_has_spa_permission('spa:profiles:manage'))
  with check (public.auth_has_spa_permission('spa:profiles:manage'));

-- ── Financial records ─────────────────────────────────────────────────────
drop policy if exists spa_transactions_all on public.spa_transactions;
create policy spa_transactions_scoped on public.spa_transactions
  for all to authenticated
  using (public.auth_has_spa_permission('spa:finance:manage'))
  with check (public.auth_has_spa_permission('spa:finance:manage'));

drop policy if exists spa_gift_cards_all on public.spa_gift_cards;
create policy spa_gift_cards_scoped on public.spa_gift_cards
  for all to authenticated
  using (public.auth_has_spa_permission('spa:finance:manage'))
  with check (public.auth_has_spa_permission('spa:finance:manage'));

drop policy if exists spa_gift_card_redemptions_all on public.spa_gift_card_redemptions;
create policy spa_gift_card_redemptions_scoped on public.spa_gift_card_redemptions
  for all to authenticated
  using (public.auth_has_spa_permission('spa:finance:manage'))
  with check (public.auth_has_spa_permission('spa:finance:manage'));

drop policy if exists spa_memberships_authenticated on public.spa_memberships;
drop policy if exists spa_memberships_all on public.spa_memberships;
create policy spa_memberships_scoped on public.spa_memberships
  for all to authenticated
  using (public.auth_has_spa_permission('spa:finance:manage'))
  with check (public.auth_has_spa_permission('spa:finance:manage'));
