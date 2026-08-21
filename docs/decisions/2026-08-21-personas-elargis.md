# Élargissement des personas de recherche de contacts — 2026-08-21

## Ce qui a été constaté

L'audit contact par contact des signaux Presse et Pappers a montré un biais net :
sur OVHcloud, 9 des 11 contacts remontés étaient des office managers ou des
assistant(e)s de direction. Aucun décideur. Pour une offre de cadeaux
d'entreprise haut de gamme, l'interlocuteur utile est aussi bien le DG, le
directeur marketing, le responsable RH ou le responsable événementiel — ce sont
eux qui décident d'un budget cadeaux, pas seulement ceux qui l'exécutent.

La cause n'était pas l'extraction : c'était la liste de recherche elle-même.
`personas_presse` ne contenait que **4 fonctions**, contre 7 pour
`personas_pappers`. HarvestAPI ne pouvait pas remonter ce qu'on ne lui demandait
pas de chercher.

## Ce qui a été changé

Les deux listes (`settings.personas_presse` et `settings.personas_pappers`)
portent désormais les **mêmes 10 fonctions, dont 6 prioritaires** :

| Fonction | Prioritaire |
|---|---|
| Assistant(e) de direction | oui |
| Office Manager | oui |
| Responsable Communication | oui |
| Responsable RH | oui |
| Directeur Général | oui |
| Responsable Événementiel | oui |
| Directeur Marketing | non |
| DAF / CFO | non |
| Responsable Achats | non |
| Secrétaire Général | non |

**Aucune fonction n'a été retirée.** Les personas existants — y compris office
manager et assistant(e) de direction, qui restent des points d'entrée réels —
sont conservés en priorité. L'élargissement s'ajoute, il ne remplace pas.

C'est une modification de **données** (table `settings`), pas de code : la liste
est lue à chaque enrichissement par `enrich-contacts-linkedin`. Elle est
consignée ici parce qu'elle change ce que la plateforme va chercher chez le
fournisseur, donc ce qu'elle dépense et ce que l'opératrice verra.

## Conséquence : les signaux déjà enrichis

Les signaux enrichis avant ce changement l'ont été avec l'ancien ciblage. Leur
liste de contacts n'est pas fausse, elle est incomplète. Les rejouer suppose de
franchir le garde-fou anti-double-dépense de
`enqueue_enrichment_job_authorized`, qui refuse — à raison — tout signal déjà
`completed`.

C'est l'objet de la migration `20260821200000_authorize_enrichment_regeneration`
et de sa fonction `authorize_enrichment_regeneration(signal_id, motif, auteur)` :
une porte étroite, qui exige un motif écrit et le consigne, pour que la dépense
refaite reste explicable des mois plus tard.

## Point resté ouvert

La clé `personas_linkedin` n'existe pas en base. Les signaux de source
`LinkedIn` retombent donc sur les `DEFAULT_PERSONAS` du code. Sans effet
aujourd'hui (le flux Presse/Pappers n'y passe pas), mais à traiter si cette
source est activée.
