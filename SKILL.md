---
name: sales-tracking-sheet
description: Met en place, vérifie ou répare une feuille Google de suivi des ventes qui se remplit seule. Un service lit les réservations de l'outil de prise de rendez-vous (iClosed, plusieurs calendriers), écrit chaque appel une seule fois dans l'onglet du mois, relie l'enregistrement de l'appel (Fathom), puis 3 h après l'appel remplit la colonne Outcome si elle est vide - No-Show quand le closer parle seul dans l'enregistrement ou qu'il n'y en a aucun, sinon le résultat du deal lu dans le CRM (perdu, pas le bon client, deuxième appel, payé en une ou plusieurs fois avec le montant). Une saisie humaine n'est jamais écrasée. Utilise ce skill pour « remplir automatiquement la feuille de ventes », « sales tracking sheet », « suivi des calls bookés », « marquer les no-shows », « shows et no-shows depuis Fathom », « reprendre les deals du CRM dans la feuille », ou quand quelqu'un dit que la feuille « ne se met plus à jour », qu'il manque des réservations, ou qu'un résultat semble faux. Pas pour construire un CRM, ni pour analyser les appels eux-mêmes.
---

# Feuille de suivi des ventes qui se remplit seule

Le closer ne devrait taper que ce qu'aucun outil ne sait : l'offre faite, l'objection, son ressenti. Tout le reste existe déjà ailleurs. La réservation est dans l'outil de rendez-vous, la présence se voit dans l'enregistrement, et le résultat du deal est dans le CRM. Ce skill branche ces trois sources sur la feuille que l'équipe utilise déjà, sans en changer la forme.

Lisez ces fichiers avant de toucher à une vraie feuille. Ils sont le skill, pas une annexe :

| Fichier | À lire pour |
| --- | --- |
| [references/01-fonctionnement.md](references/01-fonctionnement.md) | Une passe étape par étape, la feuille attendue, le registre, ce qui est écrit où |
| [references/02-regles-resultat.md](references/02-regles-resultat.md) | Comment le service décide d'un Outcome, et quand il se tait |
| [references/03-crm.md](references/03-crm.md) | L'adaptateur CRM : interface, correspondance des étapes, JSON, HTTP, module, Postgres |
| [references/04-pieges.md](references/04-pieges.md) | **Les pièges du jour de la mise en ligne.** À lire en entier |
| [references/05-mise-en-ligne.md](references/05-mise-en-ligne.md) | Compte de service Google, variables, Railway ou autre hébergeur, alerte, retour arrière |

## Les règles qui ne plient pas

1. **La saisie humaine gagne toujours.** Le service n'écrit que dans une case vide, ou par-dessus sa propre valeur précédente. Dès qu'un humain tape ou efface un Outcome, la ligne lui appartient pour de bon. Si l'enregistrement contredit ce qui a été tapé, le service signale la ligne et ne corrige rien.
2. **Une réservation, une ligne, une seule fois.** Un onglet caché `_sync` sert de registre, et chaque ligne écrite porte une métadonnée. Relancer une passe, rattraper quatre jours ou redéployer ne crée jamais de doublon. Une ligne effacée par l'équipe n'est jamais réécrite.
3. **La forme de la feuille ne bouge pas.** Les colonnes sont trouvées par leur en-tête, pas par leur lettre. Le service écrit sur la première ligne libre sous l'en-tête et ajoute ses colonnes d'information à droite. Il ne touche ni au tableau de bord, ni aux formules, ni aux couleurs.
4. **Pas de preuve, pas de résultat.** Un No-Show vient de l'enregistrement : le closer y parle seul, ou il n'y a aucun enregistrement après la date que vous avez choisie. Un résultat de deal vient du CRM. Si le CRM ne répond pas, la passe n'écrit aucun résultat. Si le prospect est venu et que rien n'est décidé, la case reste au closer.
5. **Lecture seule partout, sauf la feuille, et passage à blanc d'abord.** Le service lit l'outil de réservation, l'enregistreur et le CRM, sans jamais y écrire. Avant la première écriture réelle, faites `--check` puis `--dry-run` sur les vraies données, et relisez le résultat avec quelqu'un qui connaît les appels. La mise en ligne demande une demande explicite de l'utilisateur.

## Le playbook

### 1. Cadrer avec l'utilisateur (5 minutes, pas plus)

Posez seulement les questions qui bloquent :

- **Quelle feuille ?** Demandez l'URL **que le closer a ouverte quand il tape ses résultats**, pas celle d'un document de passation. Le jour de la mise en ligne, l'équipe tapait dans une copie pendant que le service visait l'original (piège 2).
- **Quels calendriers ?** Tous les calendriers de vente, y compris celui de la campagne lancée la semaine dernière. Ne vous fiez pas à la liste : `--check` montrera les calendriers qui ont des réservations (piège 3).
- **Qui prend les appels, avec quel enregistreur ?** Un compte d'enregistreur par personne qui prend des appels, et les domaines e-mail et prénoms de l'équipe, pour ne pas compter un collègue comme un prospect.
- **Quel CRM, et que veulent dire ses étapes ?** Quelle étape veut dire « perdu », « pas le bon client », « deuxième appel », « signé », et lesquelles sont posées automatiquement à la réservation (celles-là ne prouvent rien).
- **Où tournera le service ?** Un hébergeur qui tourne en continu (Railway ou autre), pas le portable de quelqu'un. Notez-le là où l'équipe le retrouvera (piège 1).

### 2. Montrer la démo, sans aucune clé

```bash
node scripts/run.js --demo
```

C'est une agence fictive qui vend de l'acquisition d'adhérents à des salles de sport. Le script fait trois passes sur 13 réservations, 10 enregistrements et un export CRM. La première écrit les réservations et les liens. Entre deux passes, le closer tape deux résultats à la main. La deuxième passe remplit les Outcomes et signale le « No-Show » tapé alors que le prospect parle 42 minutes dans l'enregistrement. La troisième ne change rien. Montrez la sortie à l'utilisateur : c'est le contrat.

### 3. Configurer

- `config.json` (copie de [examples/config.example.json](examples/config.example.json)) : noms des onglets de mois, mots exacts de la liste Outcome de la feuille, règles de source (UTM vers Facebook, Email, Cold Call…), équipe, correspondance du CRM. Aucun secret dans ce fichier.
- Variables d'environnement ([.env.example](.env.example)) : clé Google, ID de la feuille, clé et calendriers iClosed, clés Fathom, CRM, webhook d'alerte.
- `ABSENT_IF_NO_RECORDING_FROM` : posez-le seulement à partir du jour où **chaque** appel est enregistré. Avant cette date, un appel sans enregistrement ne prouve rien.
- `SYNC_SINCE` : si l'équipe a déjà tapé des réservations à la main, posez la date du jour de mise en ligne. Le service ne reconnaît que ses propres lignes : sans cette date, il ajouterait une deuxième ligne pour chaque réservation déjà tapée sur les 21 derniers jours.

### 4. Donner l'accès, puis vérifier

1. Le propriétaire de la feuille la partage **lui-même** avec l'adresse du compte de service, en **Éditeur**. Un agent ou un connecteur Drive ne peut pas partager un fichier dont il n'est pas propriétaire.
2. Lancez la vérification, qui ne fait que lire :

   ```bash
   node scripts/run.js --check
   ```

   Lisez chaque ligne avec l'utilisateur :

   | Ligne | Ce qu'il faut faire |
   | --- | --- |
   | `ERROR Sheet … share the sheet with <adresse>` | Partager la feuille avec cette adresse, en Éditeur |
   | `OK Sheet reachable "<titre>"` | Faire confirmer que ce titre et cet ID sont ceux de la feuille où l'équipe tape |
   | `WARN Calendar <id> … NOT listed` | Un calendrier a des réservations mais n'est pas lu. Demander s'il est commercial, puis l'ajouter à `ICLOSED_EVENT_IDS` |
   | `WARN Tab <mois> missing` | Créer l'onglet du mois (copie du mois précédent, lignes vidées) |
   | `ERROR Tab … no call table` | L'en-tête doit avoir une cellule « Date » suivie directement de « Name » (ou vos en-têtes dans `headers`) |
   | `WARN CRM stages not mapped` | Classer chaque étape dans `crm.stages`, ou dans `crm.ignoreStages` si elle ne veut rien dire |
   | `ERROR Recorder account #n` | Clé invalide ou compte coupé : les appels de ce compte deviendraient des No-Show |

### 5. Passage à blanc sur les vraies données

```bash
node scripts/run.js --dry-run
```

Le service copie la feuille en mémoire (3 lectures), fait une passe complète avec les vraies réservations, les vrais enregistrements et le vrai CRM, puis liste chaque cellule qu'il écrirait. Rien n'est envoyé à Google. Relisez la sortie avec quelqu'un qui connaît les appels :

- les réservations manquantes sont-elles toutes là, chacune une seule fois ?
- chaque No-Show est-il plausible ? Un No-Show sur un appel mené par quelqu'un dont l'enregistreur n'est pas branché veut dire qu'il manque un compte ;
- chaque résultat de deal correspond-il à ce que l'équipe sait ?
- les lignes signalées comme contradictoires (`check Nov row 14: typed No-Show, but the prospect speaks in the recording`) sont à corriger par le closer, pas par le service.

Corrigez la configuration et recommencez jusqu'à ce que la sortie ne surprenne plus personne.

### 6. Mettre en ligne

Seulement sur demande explicite. Suivez [references/05-mise-en-ligne.md](references/05-mise-en-ligne.md) : variables sur le service, commande `npm start`, contrôle de santé `/health`, redémarrage automatique, `ALERT_WEBHOOK_URL` branché. La première passe rattrape seule tout ce qui manque sur `LOOKBACK_DAYS` (21 jours par défaut, jamais avant `SYNC_SINCE`), sans doublon.

### 7. Prouver sur la feuille, pas dans les logs

- Ouvrez la feuille et relisez les lignes écrites : réservations du mois, liens d'enregistrement, Outcomes, montants.
- `GET /health` montre la dernière passe (`added`, `linked`, `outcomes`, `closer`, `conflicts`) ou son erreur.
- Revenez le lendemain : la règle des 3 h doit avoir rempli les appels de la veille. Le jour de la mise en ligne, elle n'avait encore été vue que sur des appels passés, pas sur un appel du jour même.

### 8. Rendre compte

Trois lignes à l'utilisateur, avec les sources :

- ce qui a été ajouté (réservations, annulations, liens, Outcomes) ;
- ce qui reste au closer (prospects venus sans résultat nulle part) ;
- les lignes à vérifier à la main, par onglet et numéro de ligne, jamais par nom dans un canal partagé.

## Diagnostic : « la feuille ne se met plus à jour »

C'est la demande qui a lancé ce skill. L'ordre qui a résolu le problème en un quart d'heure :

1. **Où tourne le service ?** Pas sur le Mac de quelqu'un : chez l'hébergeur. Trouvez le service et ses logs.
2. **`/health` ou les logs** : une erreur 403 ou 404 répétée veut dire que la feuille n'est pas partagée avec le compte de service, ou que l'ID n'est pas le bon.
3. **Est-ce la bonne feuille ?** Comparez l'ID de `SPREADSHEET_ID` avec l'URL que le closer a ouverte.
4. **`--check`** : un calendrier de vente non listé ?
5. **`--dry-run`**, puis une passe réelle `--once`. Le registre garantit qu'il n'y aura pas de doublon. Si le trou dépasse 21 jours, montez `LOOKBACK_DAYS` le temps d'une passe.
6. **Relire la feuille** et compter les réservations du mois contre celles de l'outil de rendez-vous.

## Ce que le skill ne fait pas

- Il n'écrit jamais dans l'outil de réservation, l'enregistreur ou le CRM.
- Il ne remplit ni Offer, ni Objection, ni Call Summary, ni les émotions du closer. Ces colonnes restent humaines.
- Il ne devine pas un résultat sur le ton de l'appel. Pas de CRM, pas de résultat de deal.
- Il ne touche pas au tableau de bord de la feuille, à ses formules ni à ses couleurs.
- Un autre outil de rendez-vous (Calendly, Cal.com…) demande d'écrire un `fetchCalls()` qui rend les mêmes objets que `normalizeCall()` dans `src/iclosed.js`. Le reste ne change pas.
