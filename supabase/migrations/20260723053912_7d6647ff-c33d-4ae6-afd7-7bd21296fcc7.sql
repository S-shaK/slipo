
-- Fix privilege escalation: managers can only claim unassigned profiles or update their own reports, and can only set manager_id to themselves
DROP POLICY IF EXISTS "Managers update report manager_id" ON public.profiles;
CREATE POLICY "Managers update report manager_id"
ON public.profiles
FOR UPDATE
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND (manager_id IS NULL OR manager_id = auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND manager_id = auth.uid()
);

-- Fix invite token exposure: remove anon SELECT policy. Public lookup will use service role in the server fn.
DROP POLICY IF EXISTS "Anon can look up invite by token" ON public.team_invites;
REVOKE SELECT ON public.team_invites FROM anon;
