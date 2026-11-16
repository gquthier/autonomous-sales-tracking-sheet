# Les règles de résultat

Le service remplit Outcome 3 heures après l'appel (`OUTCOME_WAIT_HOURS`), le temps que l'enregistreur publie sa transcription et que l'équipe mette le CRM à jour. Il a deux témoins :

- **l'enregistreur**, qui dit qui a parlé ;
- **le CRM**, qui dit ce que l'équipe a décidé après l'appel.

Le code est dans `src/outcome.js` : une fonction, une trentaine de lignes, testée cas par cas.

## Le prospect est-il venu ?

Pour l'enregistrement relié à l'appel, le service compte les segments de transcription prononcés par quelqu'un qui n'est **pas** de l'équipe :

- une voix dont l'e-mail est sur le domaine de l'hôte ou sur un domaine de `team.emailDomains` est de l'équipe ;
- une voix sans e-mail est de l'équipe si son prénom est celui de l'hôte ou est dans `team.firstNames`.

| Ce que montre l'enregistrement | `came` |
| --- | --- |
| Au moins `minProspectSegments` (5) segments hors équipe | `true` : le prospect est venu |
| Moins que ça : le closer a parlé seul, ou presque | `false` : personne n'est venu |
| Aucun enregistrement relié | `null` : on ne sait pas |

Un closer qui attend seul dit « vous m'entendez ? », « je vous envoie un message » : quelques segments, tous à lui. Un vrai appel en compte des dizaines de chaque côté.

## La décision

Dans cet ordre, la première règle qui s'applique gagne :

| # | Situation | Outcome écrit |
| --- | --- | --- |
| 1 | Réservation annulée, ou appel terminé depuis moins de 3 h | rien |
| 2 | CRM : deal gagné (étape « gagné » ou date de paiement) | `Full-Pay`, ou `Split-Pay` si le moyen de paiement dit plusieurs fois, et le montant dans Revenue et Cash si ces cases sont vides |
| 3 | CRM : marqué absent | `No-Show` |
| 4 | CRM : perdu, **et** le closer n'était pas seul | `Offer & Didn't Buy`, ou `Bad Fit & No Offer` si la raison dit « pas le bon client » (`badFitReasons`) |
| 5 | CRM : pas le bon client, **et** le closer n'était pas seul | `Bad Fit & No Offer` |
| 6 | CRM : deuxième appel, proposition, réflexion, **et** le closer n'était pas seul | `No Deposit & Follow-Up` |
| 7 | Le closer était seul dans l'enregistrement | `No-Show` |
| 8 | Aucun enregistrement, appel à partir de `ABSENT_IF_NO_RECORDING_FROM` | `No-Show` |
| 9 | Tout le reste (le prospect est venu, rien n'est décidé) | rien : la case reste au closer |

Ce qu'il faut retenir :

- **« Perdu » avec un closer seul devient No-Show.** Une équipe classe parfois « perdu » un prospect qui n'est jamais venu. L'enregistrement tranche.
- **« Deuxième appel » sans enregistrement compte quand même.** L'appel a pu se faire au téléphone : le CRM suffit.
- **Le CRM ne parle que pour la dernière réservation de la personne.** Si quelqu'un a réservé deux fois, sa fiche CRM décrit le dernier appel. Le premier est jugé sur l'enregistrement seul.
- **La fiche CRM est trouvée par e-mail, sinon par les 9 derniers chiffres du téléphone** (`phoneDigits`, à régler selon votre pays).
- **Sans enregistreur** (`FATHOM_API_KEYS` vide), seules les règles 2 à 6 jouent, et un appel sans enregistrement ne prouve rien.

## Qui a le dernier mot

| Case Outcome au moment d'écrire | Ce que fait le service |
| --- | --- |
| Vide, jamais écrite par le service | Il écrit |
| Contient la dernière valeur écrite par le service | Il la remplace si la décision a changé (le CRM a avancé, un enregistrement est arrivé), ou l'efface si la décision est retombée à « rien » |
| Contient autre chose, ou a été vidée par un humain | Il note `(closer)` dans le registre et ne touchera plus jamais cette ligne |

Revenue et Cash ne sont écrits que dans des cases vides.

## Les saisies contredites

Quand un humain a tapé un Outcome et que l'enregistrement dit le contraire, le service le signale une fois par ligne, dans la sortie de la passe (`conflicts`) et dans les logs, **par onglet et numéro de ligne, sans nom** :

| Tapé | L'enregistrement montre | Signalement |
| --- | --- | --- |
| `No-Show` | Le prospect parle | `typed No-Show, but the prospect speaks in the recording` |
| Un résultat d'appel (perdu, suivi, payé…) | Le closer est seul | `typed a call result, but the closer is alone in the recording` |

La valeur tapée reste. Le jour de la mise en ligne, un « No-Show » tapé à la main portait sur un appel de plus de 40 minutes dans l'enregistrement. C'était très probablement une erreur de ligne, à corriger par le closer.

## Les mots écrits

Les valeurs par défaut viennent d'un modèle de feuille de suivi courant en anglais. Changez-les dans `labels` pour coller exactement à votre liste déroulante :

```json
"labels": {
  "cancelled": "Annulé", "rescheduled": "Déplacé", "noShow": "Absent",
  "lost": "Offre refusée", "badFit": "Pas qualifié", "followUp": "Relance",
  "fullPay": "Payé comptant", "splitPay": "Payé en plusieurs fois"
}
```
