ALTER TABLE public.flow_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_identity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.flow_sessions FROM anon, authenticated;
REVOKE ALL ON public.user_identity FROM anon, authenticated;
GRANT ALL ON public.flow_sessions TO service_role;
GRANT ALL ON public.user_identity TO service_role;

DROP POLICY IF EXISTS "Managers delete their invites" ON public.team_invites;
CREATE POLICY "Managers delete their invites"
ON public.team_invites FOR DELETE TO authenticated
USING (manager_id = auth.uid());