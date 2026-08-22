INSERT INTO public.provider_cost_rates
  (provider, operation, unit_price, currency, source, effective_from, evidence)
SELECT v.provider, v.operation, v.unit_price, 'USD', 'configured_rate',
       '2026-01-01T00:00:00Z',
       jsonb_build_object(
         'motif', v.motif,
         'pose_le', '2026-08-22',
         'source_documentaire', v.source_doc
       )
FROM (VALUES
  ('newsapi', 'everything', 0::numeric,
   'Plan Developer : gratuit, plafonne a 100 requetes/jour et 100 resultats/requete',
   'newsapi.org/pricing — plan constate sur le compte le 2026-08-22'),
  ('lovable_email', 'send_email', 0::numeric,
   'Envoi transactionnel inclus dans l abonnement Lovable, pas de facturation a l envoi',
   'Abonnement Lovable Pro constate le 2026-08-22')
) AS v(provider, operation, unit_price, motif, source_doc)
WHERE NOT EXISTS (
  SELECT 1 FROM public.provider_cost_rates r
  WHERE r.provider = v.provider AND r.operation = v.operation
    AND r.effective_from = '2026-01-01T00:00:00Z'
);