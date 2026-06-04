-- Allow admins to delete placed_bets and pin_ledger rows to support the
-- "cancel placed bet" flow (a total undo: the placed_bet row and every
-- pin_ledger entry tied to it are removed, restoring the player's balance to
-- exactly what it was before the bet was placed).
--
-- These tables have RLS enabled but no DELETE policy, so deletes are currently
-- denied for everyone. We add admin-only DELETE policies, gated on the role
-- embedded in the JWT app_metadata by the custom access token hook — the same
-- check used by the security-hardening RLS migration. anon gets no delete
-- access, and a non-admin authenticated user is also denied.

CREATE POLICY "admin can delete" ON public.placed_bets FOR DELETE TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can delete" ON public.pin_ledger FOR DELETE TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
