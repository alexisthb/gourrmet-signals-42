-- LES TARIFS CERTAINS — ET SEULEMENT EUX.
--
-- L'audit du 2026-08-22 relève que le coût par signal est incalculable :
-- `provider_cost_rates` est vide, donc `provider_usage_costed` laisse
-- `effective_cost_amount` à NULL partout où le fournisseur n'a pas rapporté
-- de coût exact.
--
-- Ce que cette migration POSE : les tarifs dont la valeur est certaine et
-- documentée. NewsAPI plan Developer est GRATUIT (100 requêtes/jour) — un
-- zéro vrai, pas un zéro par défaut. Lovable Emails est inclus dans
-- l'abonnement Lovable, sans facturation à l'envoi.
--
-- Ce qu'elle REFUSE de poser : tout tarif qui dépend de l'abonnement réel —
-- le prix d'un crédit Dropcontact, d'un crédit Pappers, d'un token Perplexity
-- ou d'un crédit Lovable AI varie selon le plan souscrit. Les inventer
-- produirait des coûts faux qui ont l'air vrais, pires que NULL : NULL au
-- moins se voit (`is_priced = false`).
--
-- À savoir avant d'aller plus loin (consigné pour le chantier télémétrie) :
-- poser ces tarifs ne suffira PAS à tout tarifer. Plusieurs enregistrements
-- d'usage écrivent `units: 0` (les soumissions Dropcontact, notamment) — le
-- volume facturable n'est pas encore porté par le ledger pour toutes les
-- opérations. Tarif × zéro donnerait zéro : le chantier commence par les
-- unités, pas par les prix.

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
-- Idempotent : ne double jamais un tarif déjà posé pour la même période.
WHERE NOT EXISTS (
  SELECT 1 FROM public.provider_cost_rates r
  WHERE r.provider = v.provider AND r.operation = v.operation
    AND r.effective_from = '2026-01-01T00:00:00Z'
);
