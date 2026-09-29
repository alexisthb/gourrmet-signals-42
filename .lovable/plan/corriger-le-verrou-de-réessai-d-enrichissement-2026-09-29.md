# Corriger le verrou de réessai d’enrichissement

## Objectif
Éviter qu’un enrichissement déjà déclaré en échec reste bloqué uniquement parce qu’une ancienne soumission Dropcontact est encore présente, sans affaiblir la protection contre les doubles appels fournisseur.

## Changements
- Modifier la règle de blocage en base pour distinguer un lot réellement en cours d’un enrichissement explicitement terminé en échec.
- Autoriser immédiatement le réessai lorsque l’échec terminal est horodaté après le dernier suivi fournisseur et qu’aucune opération non confirmée récente ne subsiste.
- Conserver le blocage pour les enrichissements encore en traitement et pour toute opération fournisseur dont l’issue reste réellement inconnue.
- Ajouter des tests SQL couvrant le cas observé et les protections anti-double facturation.

## Vérification
- Confirmer que FABRIQUE DE STYLES n’est plus bloquée après la migration.
- Confirmer que MONNET CONSEIL EQUIPEMENT, encore réellement en cours, reste protégée.
- Recompter tous les motifs de blocage et vérifier la santé de la base.
