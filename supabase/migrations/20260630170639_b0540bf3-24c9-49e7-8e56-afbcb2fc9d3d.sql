
CREATE TABLE public.team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE (manager_id, email)
);
CREATE INDEX team_invites_email_idx ON public.team_invites (lower(email)) WHERE status = 'pending';
CREATE UNIQUE INDEX team_invites_token_idx ON public.team_invites (token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_invites TO authenticated;
GRANT ALL ON public.team_invites TO service_role;
GRANT SELECT ON public.team_invites TO anon;

ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view their invites"
  ON public.team_invites FOR SELECT TO authenticated
  USING (manager_id = auth.uid());

CREATE POLICY "Managers create their invites"
  ON public.team_invites FOR INSERT TO authenticated
  WITH CHECK (manager_id = auth.uid());

CREATE POLICY "Managers update their invites"
  ON public.team_invites FOR UPDATE TO authenticated
  USING (manager_id = auth.uid()) WITH CHECK (manager_id = auth.uid());

CREATE POLICY "Anon can look up invite by token"
  ON public.team_invites FOR SELECT TO anon
  USING (status = 'pending');

-- Update signup handler to auto-link pending invites
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invite RECORD;
BEGIN
  SELECT * INTO v_invite
  FROM public.team_invites
  WHERE lower(email) = lower(NEW.email)
    AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.profiles (id, full_name, email, manager_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.email,
    CASE WHEN v_invite.id IS NOT NULL THEN v_invite.manager_id ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_invite.id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee')
    ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.team_invites
      SET status = 'accepted', accepted_at = now()
      WHERE id = v_invite.id;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'individual')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END; $$;
