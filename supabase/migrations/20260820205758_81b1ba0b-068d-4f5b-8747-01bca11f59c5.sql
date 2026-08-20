-- L'historique des rôles ne prouve pas qu'un compte est encore autorisé :
-- l'ancien trigger attribuait automatiquement `user` à toute inscription
-- publique. Cette table est volontairement vide dans Git et doit être remplie
-- depuis Lovable avec les comptes propriétaires explicitement approuvés avant
-- d'appliquer la migration de policies suivante.
CREATE TABLE IF NOT EXISTS public.internal_access_allowlist (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  approved_at timestamptz NOT NULL DEFAULT now(),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.internal_access_allowlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS internal_access_allowlist_service_all
  ON public.internal_access_allowlist;
CREATE POLICY internal_access_allowlist_service_all
  ON public.internal_access_allowlist
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.internal_access_allowlist FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.internal_access_allowlist TO service_role;

COMMENT ON TABLE public.internal_access_allowlist IS
  'Comptes Gourrmet approuvés explicitement. Aucun identifiant personnel ne doit être versionné dans Git.';