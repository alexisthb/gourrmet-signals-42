-- Les deux fonctions `__tmp_*` ont été créées le 2026-08-21 pour réaligner le
-- secret du coffre après la panne des 401, puis supprimées à la main. Mais leurs
-- migrations, elles, restent dans l'historique : tout rejeu de la chaîne les
-- recrée. Or `__tmp_upsert_vault_secret` ÉCRIT dans le coffre — ce n'est pas un
-- outil qui doit survivre à l'opération qui l'a justifié.
--
-- Cette migration ferme la parenthèse. Elle est volontairement datée après les
-- deux autres pour que l'ordre lexical garantisse la suppression, rejeu compris.
DROP FUNCTION IF EXISTS public.__tmp_upsert_vault_secret(text, text);
DROP FUNCTION IF EXISTS public.__tmp_check_vault_secret(text, text);
