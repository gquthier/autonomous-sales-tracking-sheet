# Mise en ligne

Le service est un seul processus Node (20 ou plus), sans dépendance. Il tourne en continu et répond sur `GET /health`. Il lui faut un hébergeur qui le garde allumé : Railway, Render, Fly.io, un petit serveur. Pas un ordinateur portable.

## 1. Le compte de service Google

1. Dans Google Cloud, créez un projet (de préférence un par activité, à cause du quota partagé), puis activez l'**API Google Sheets**.
2. Créez un **compte de service** et une **clé JSON**. Si l'organisation interdit la création de clés, demandez une exception sur ce projet seulement.
3. Encodez la clé pour la variable d'environnement :

   ```bash
   base64 < cle-compte-de-service.json | tr -d '\n'   # macOS et Linux -> GOOGLE_SERVICE_ACCOUNT_B64
   ```

   Ou, sur un serveur à vous, `GOOGLE_SERVICE_ACCOUNT_FILE=/chemin/vers/cle.json`. Ne commitez jamais la clé : `.gitignore` exclut déjà les fichiers `*service-account*.json`.
4. Le **propriétaire** de la feuille la partage avec l'adresse du compte (`…@….iam.gserviceaccount.com`), en **Éditeur**.
5. `node scripts/run.js --check` : la ligne `Sheet reachable` doit afficher le titre de la bonne feuille.

## 2. Les variables

| Variable | Pour |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_B64` ou `GOOGLE_SERVICE_ACCOUNT_FILE` | La clé du compte de service, **Éditeur** de la feuille |
| `SPREADSHEET_ID` | La feuille où l'équipe tape vraiment |
| `ICLOSED_API_KEY`, `ICLOSED_EVENT_IDS` | Lire les réservations, de **tous** les calendriers de vente |
| `FATHOM_API_KEYS` | Une clé par compte d'enregistreur |
| `ABSENT_IF_NO_RECORDING_FROM` | Date à partir de laquelle un appel sans enregistrement compte comme No-Show (vide : jamais) |
| `CRM_ADAPTER` et ses variables | Le résultat des deals ([03-crm.md](03-crm.md)) |
| `SALES_SHEET_CONFIG` | Chemin de `config.json`, s'il n'est pas à la racine du dépôt |
| `ALERT_WEBHOOK_URL`, `ALERT_AFTER_FAILURES` (3) | Être prévenu quand le service échoue |
| `SYNC_SINCE` | Les appels avant cette date ne sont jamais écrits. À poser au jour de la mise en ligne si l'équipe a déjà tapé des lignes à la main : le service ne reconnaît que les siennes |
| `LOOKBACK_DAYS` (21), `POLL_SECONDS` (120), `OUTCOME_MINUTES` (10), `OUTCOME_WAIT_HOURS` (3), `SHEET_TIME_ZONE` | Réglages facultatifs |

`config.json` ne contient aucun secret. Vous pouvez le commiter dans **votre** copie privée, ou le monter comme fichier chez l'hébergeur.

## 3. Railway

1. Nouveau service depuis votre copie du dépôt (ou `railway up` depuis le dossier).
2. Réglez sur le service lui-même, pas dans un fichier de configuration de la plateforme :
   - commande de démarrage : `npm start` ;
   - contrôle de santé : `/health` ;
   - redémarrage : toujours.
3. Posez les variables du tableau ci-dessus. Si votre CRM est une base Postgres du même projet, référencez sa variable de connexion plutôt que de la recopier.
4. Déployez, puis ouvrez `https://<service>/health` : `lastRun` doit montrer une passe sans `error`.

Un seul exemplaire du service à la fois : deux exemplaires sur la même feuille se disputeraient les mêmes lignes libres.

## 4. Sans service permanent

Si votre hébergeur ne garde rien allumé, une tâche planifiée toutes les 2 à 5 minutes fait le même travail :

```bash
node scripts/run.js --once
```

Chaque appel refait la passe complète, Outcomes compris. Le registre garantit qu'une passe répétée n'ajoute rien.

## 5. Après la mise en ligne

- Relisez la feuille : réservations du mois, liens, Outcomes. Comptez les réservations du mois contre celles de l'outil de rendez-vous.
- `GET /health` : `added`, `linked`, `outcomes`, `closer` (lignes reprises par un humain), `conflicts` (saisies contredites, par ligne).
- Le lendemain, vérifiez que les appels de la veille ont reçu leur Outcome.
- Notez où tourne le service et qui reçoit l'alerte.

## 6. Retour arrière

- **Arrêter le service** suffit : il n'écrit nulle part ailleurs que dans la feuille.
- **Annuler une passe** : l'historique des versions de Google Sheets (Fichier → Historique des versions) restaure tout le classeur, registre `_sync` compris. Ne restaurez jamais un onglet de mois sans le registre : le service croirait ses lignes déjà écrites.
- **Une ligne fausse** : corrigez-la à la main. Le service ne la touchera plus.
