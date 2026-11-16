# Fonctionnement

Le service fait une passe toutes les 2 minutes (`POLL_SECONDS`). Les Outcomes sont calculés une passe sur cinq, toutes les 10 minutes (`OUTCOME_MINUTES`). Le code est court : `src/run.js` enchaîne les étapes ci-dessous.

## La feuille attendue

Une feuille Google avec un onglet par mois (`Jan` … `Dec` par défaut, réglable dans `monthTabs`, y compris avec l'année : `"Mars {yyyy}"`). Dans chaque onglet, quelque part dans les 40 premières lignes, une ligne d'en-tête du tableau des appels :

| Date | Name | Source | Booked | Outcome | Revenue | Cash | Offer | My Emotions | Objection | Call Summary | Video Call Recording Link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

- La ligne d'en-tête est la première où une cellule « Date » est **directement suivie** de « Name ». Ce qui est au-dessus (compteurs, titres) est ignoré.
- Les autres colonnes sont trouvées par leur nom, dans n'importe quel ordre. Une colonne absente est simplement sautée. Les noms se changent dans `headers` (expressions régulières, sans casse) : `{ "name": "^nom$", "outcome": "^résultat$" }`.
- Les valeurs écrites dans Outcome sont celles de `labels`. Mettez-y les mots exacts de la liste déroulante de votre feuille, sinon les formules du tableau de bord ne les compteront pas.

| Rempli par le service | Laissé au closer |
| --- | --- |
| Date et heure (fuseau de la feuille), Name, Source (quand les UTM le disent), Booked = Yes | Offer, My Emotions, Objection, Call Summary |
| Video Call Recording Link, si la case est vide | Outcome, Revenue, Cash quand le service n'a pas de preuve |
| Email, Phone, Website, Meet Link, Form Answers (colonnes ajoutées à droite) | Tout ce qu'il veut corriger : sa saisie prime |
| Outcome : Cancelled, Rescheduled, puis No-Show ou résultat du deal, si la case est vide | |
| Revenue et Cash d'un deal gagné, si les cases sont vides | |

## Une passe, étape par étape

1. **Lire les réservations** de tous les calendriers de `ICLOSED_EVENT_IDS`, de `max(SYNC_SINCE, maintenant − LOOKBACK_DAYS)` à dans 180 jours. Chaque réservation est ramenée à un objet simple : id, calendrier, début, nom, e-mail, téléphone, site, lien Meet, source, réponses au formulaire, annulée ou non (`normalizeCall()`).
2. **Écrire les nouvelles réservations.** Une réservation est identifiée par `id@début`. Si elle n'est pas dans le registre :
   - l'onglet est celui du mois de l'appel **dans le fuseau de la feuille**. Un appel le 30 à 23 h 30 UTC tombe le 1er du mois suivant à Paris ;
   - au premier passage dans un onglet, le service le prépare : il ajoute à droite les colonnes d'information qui manquent (`extraColumns`), au format de la colonne d'enregistrement, et ajoute les valeurs de `addSourceOptions` à la liste déroulante Source ;
   - la ligne est la première ligne entièrement vide sous l'en-tête. Une ligne tapée à la main est sautée ;
   - les réservations nouvelles sont écrites dans l'ordre des appels, en un seul envoi ;
   - la ligne reçoit une métadonnée `sales_sheet_booking = id@début`, et le registre reçoit une ligne.
3. **Annulations et déplacements.** Une réservation annulée reçoit Outcome = `Cancelled` si la case est vide. Une réservation déplacée (même id, autre heure) marque l'ancienne ligne `Rescheduled` et ouvre une nouvelle ligne à la nouvelle date.
4. **Relier les enregistrements** (si `FATHOM_API_KEYS`) : tous les comptes sont lus, puis chaque enregistrement est relié à une réservation, dans cet ordre :
   1. le même salon Google Meet ;
   2. l'e-mail d'un invité extérieur à l'entreprise de l'hôte ;
   3. l'heure, seulement si un seul appel est dans la fenêtre (15 min avant, 30 min après) et qu'aucun autre enregistrement ne la revendique.

   Plusieurs enregistrements pour un appel (coupure, reprise) : le plus long gagne. Le lien est écrit une fois, jamais par-dessus un lien tapé.
5. **Outcomes**, toutes les 10 minutes, pour les appels terminés depuis plus de `OUTCOME_WAIT_HOURS` (3 h) : lecture du CRM, lecture des transcriptions, décision ([02-regles-resultat.md](02-regles-resultat.md)), écriture.

## Le registre `_sync`

Un onglet caché, créé à la première passe. Une ligne par réservation :

| Colonne | Contenu |
| --- | --- |
| `booking` | `id@début` de la réservation |
| `status` | `booked`, `cancelled` ou `rescheduled` |
| `tab`, `row` | Où la ligne a été écrite |
| `logged_at` | Quand |
| `recording` | Le lien d'enregistrement écrit, s'il y en a un |
| `outcome_auto` | La dernière valeur d'Outcome écrite par le service, ou `(closer)` quand un humain a pris la main |

Ne le supprimez pas : sans lui, la passe suivante réécrirait tout. Si vous devez repartir de zéro sur un mois, videz les lignes de ce mois **et** les lignes correspondantes du registre.

## Les appels à Google

- Une passe sans nouveauté coûte quelques lectures : la liste des onglets (une fois par démarrage), le registre, et une recherche de métadonnées.
- Les Outcomes coûtent une recherche de métadonnées, une lecture d'en-tête par onglet, une lecture groupée et une écriture, quel que soit le nombre de lignes.
- Le quota de lectures appartient au **projet Google Cloud du compte de service** (60 lectures par minute et par utilisateur par défaut). Un autre service qui utilise le même compte mange le même quota. Sur un refus 429 ou une erreur 5xx, le client attend 20 s, 40 s puis 60 s et réessaie, au lieu de faire échouer la passe.

## Les sources

`sources` dans `config.json` : liste ordonnée, la première règle qui correspond gagne.

```json
{ "label": "Cold Call", "source": "^dialer$" }
{ "label": "Email", "any": "e-?mail|instantly|lemlist|smartlead|newsletter" }
{ "label": "Facebook", "source": "meta|facebook|instagram", "key": "fbclid" }
```

`source` teste `utm_source`, `medium` teste `utm_medium`, `any` teste les deux, `key` vérifie la présence d'un paramètre. Sans UTM, la case reste vide et le closer choisit. C'est fréquent : un lien de réservation partagé à la main ne porte aucun UTM. `label` doit exister dans la liste déroulante Source, ou dans `addSourceOptions`.

## Les commandes

| Commande | Effet |
| --- | --- |
| `node scripts/run.js --demo` | Démo fictive, aucune clé, rien ne sort de la machine |
| `node scripts/run.js --check` | Vérification en lecture seule de la feuille, des calendriers, de l'enregistreur et du CRM |
| `node scripts/run.js --dry-run` | Passe complète sur une copie en mémoire de la vraie feuille : liste de ce qui changerait |
| `node scripts/run.js --once` | Une passe réelle |
| `node scripts/run.js --setup Mar,Apr` | Préparer des onglets (colonnes, liste Source) sans rien écrire d'autre |
| `npm start` | Le service : une passe toutes les `POLL_SECONDS`, `GET /health` |
| `node --test` | Les tests hors ligne |
