-- UN ENVOI RÉEL FAIT AVANCER LE STATUT COMMERCIAL — POUR LES DEUX CANAUX.
--
-- Question de l'opératrice le 04/09 : « valider un envoi LinkedIn ne passe
-- pas le signal en contacté, est-ce normal ? ». L'instruction du code disait
-- depuis mai « un signal pipeline_status=sent aura un status=contacted » —
-- mais AUCUN mécanisme ne l'appliquait, pour aucun canal : le trigger email
-- ne touchait que le pipeline, et le statut commercial se posait à la main.
-- Une intention écrite en commentaire n'est pas un comportement.
--
-- Désormais : un email réellement accepté par le fournisseur (sent/delivered)
-- passe le signal de « new » à « contacted » — et UNIQUEMENT depuis « new ».
-- Un statut travaillé (meeting, proposal, won, lost, probleme, ignored) n'est
-- JAMAIS écrasé par un automatisme : c'est la parole de l'opératrice.
-- `contacted_at` est posé s'il est vide, comme le fait le flux manuel.
-- Les bounces et plaintes avancent le pipeline (l'envoi a bien eu lieu) mais
-- PAS le statut commercial : une adresse qui rebondit n'est pas un prospect
-- contacté.
--
-- Le même geste côté LinkedIn est fait dans l'interface, à la CONFIRMATION
-- humaine d'envoi (jamais au simple clic d'ouverture).

CREATE OR REPLACE FUNCTION public.auto_transition_sent_on_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('sent', 'delivered', 'bounced', 'complained')
     AND NEW.signal_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.signals
    SET pipeline_status = 'sent',
        pipeline_updated_at = now()
    WHERE id = NEW.signal_id
      AND pipeline_status IN ('detected', 'enriched', 'drafted', 'ready');

    -- Le statut commercial, seulement pour un envoi qui a VRAIMENT atteint
    -- quelqu'un — et seulement depuis « new ».
    IF NEW.status IN ('sent', 'delivered') THEN
      UPDATE public.signals
      SET status = 'contacted',
          contacted_at = COALESCE(contacted_at, now())
      WHERE id = NEW.signal_id
        AND status = 'new';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
