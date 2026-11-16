# Les pièges du jour de la mise en ligne

Voici ce qui s'est réellement passé le jour où la feuille a été remise en route et a commencé à remplir les résultats seule. Le métier et les noms sont retirés, les chiffres de l'activité aussi.

Le contexte : le propriétaire signale que la feuille « ne met plus à jour les leads, les shows, les calls bookés ». Il croit que l'automatisation tourne sur son ordinateur. La demande avait déjà été confiée à un autre agent, qui n'avait rien fait. En un quart d'heure, il a fallu trouver le service, comprendre pourquoi il n'écrivait plus, rattraper ce qui manquait, ajouter les résultats, tester, faire un passage à blanc, mettre en ligne et relire la feuille.

## 1. Quatre jours de refus, et personne ne l'a vu

**Ce qui s'est passé.** Le service tournait chez l'hébergeur, pas sur l'ordinateur du propriétaire. Il visait la feuille d'origine, qui n'avait jamais été partagée avec son compte de service. Toutes les 2 minutes pendant 4 jours, Google a refusé l'accès. Le service consignait l'erreur dans ses logs et recommençait. Personne ne lit les logs d'un service qui « marche ».

**Pourquoi c'est grave.** Une feuille muette ressemble à une semaine calme. L'équipe ne voit pas qu'il manque des lignes : elle voit moins de lignes.

**Ce qu'il faut faire.**
- Faire partager la feuille par son **propriétaire**, en **Éditeur**, avec l'adresse du compte de service. Un agent ou un connecteur Drive ne peut pas partager un fichier dont il n'est pas propriétaire. En revanche, une copie qu'il a faite lui-même, il peut la partager.
- `node scripts/run.js --check` avant la mise en ligne. Un refus y est une erreur qui donne l'adresse à ajouter.
- Brancher `ALERT_WEBHOOK_URL` : après 3 passes ratées de suite, un message part, puis un autre quand ça repart.
- Brancher un moniteur de disponibilité sur `GET /health?strict=1`, qui répond 503 tant que les passes échouent.
- Écrire quelque part où tourne le service (hébergeur, projet, nom du service). « Je croyais que ça tournait en local » a coûté la moitié du diagnostic.

## 2. L'équipe tapait dans une copie

**Ce qui s'est passé.** Il existait deux feuilles : l'originale, visée par le service, et une copie faite pour les essais. C'est dans la copie que le closer tapait ses résultats. La cible a été changée pour la copie, puisque c'est là que l'équipe vit.

**Ce qu'il faut faire.**
- Demander au closer l'URL **qu'il a ouverte quand il tape**, et comparer l'identifiant avec `SPREADSHEET_ID`.
- `--check` affiche le titre de la feuille atteinte. Faites-le confirmer.
- Ne garder qu'une feuille vivante. Renommez l'autre « NE PAS UTILISER », ou archivez-la.

## 3. Un calendrier oublié, près de 30 réservations manquantes

**Ce qui s'est passé.** Le service lisait deux calendriers de vente. Un troisième avait été créé pour une nouvelle campagne publicitaire, et personne ne l'avait ajouté. Le rattrapage a ajouté près de 30 réservations d'un coup, plus une annulation et quelques liens d'enregistrement. Le registre a garanti que chacune n'apparaisse qu'une fois.

**Ce qu'il faut faire.**
- `--check` lit **tous** les calendriers du compte et signale ceux qui ont des réservations sans être listés dans `ICLOSED_EVENT_IDS`.
- Règle d'équipe : chaque nouveau calendrier de vente est ajouté le jour de sa création. Relancez `--check` après chaque lancement de campagne.
- Après avoir ajouté un calendrier, une passe rattrape seule les `LOOKBACK_DAYS` derniers jours.

## 4. Un quota de lectures partagé avec un autre service

**Ce qui s'est passé.** Le compte de service Google servait aussi à un autre service, qui remplissait les feuilles d'une autre activité. Le quota de lectures de l'API Sheets (60 par minute et par utilisateur, par défaut) appartient au projet Google Cloud, pas à la feuille : les deux services puisaient dans la même réserve.

**Ce qu'il faut faire.**
- Le client attend et réessaie sur un refus 429 (20 s, 40 s, 60 s) au lieu de faire échouer la passe. C'est déjà dans `src/google.js`.
- Le service groupe ses lectures : une passe sans nouveauté ne coûte que quelques appels.
- Si vous le pouvez, un compte de service par activité.

## 5. Le passage à blanc sur les vraies données, avant la mise en ligne

**Ce qui s'est passé.** Les tests passaient tous, sur des données inventées. Avant de mettre en ligne, le service a fait une passe complète sur les vraies réservations, les vrais enregistrements et le vrai CRM, sans écrire, pour voir les résultats qu'il aurait posés. Après la mise en ligne, la feuille elle-même a été relue.

**Pourquoi.** Les tests vérifient les règles. Seules les vraies données montrent ce que les règles font de **votre** CRM : une étape qu'on croyait claire, un collègue qui prend des appels sans enregistreur, un prospect qui a réservé deux fois.

**Ce qu'il faut faire.** `node scripts/run.js --dry-run`, puis relire chaque Outcome proposé avec quelqu'un qui connaît les appels. Ne mettez en ligne que quand plus rien ne surprend.

## 6. Une saisie à la main contredite par l'enregistrement

**Ce qui s'est passé.** À la relecture, presque toutes les valeurs tapées à la main concordaient avec les enregistrements, sauf une : un prospect noté « No-Show » alors que l'enregistrement montrait plus de 40 minutes de conversation. C'était sans doute une erreur de ligne.

**Ce qu'il faut faire.** Le service ne corrige jamais une saisie humaine. Il signale la ligne (`conflicts`, par onglet et numéro de ligne) pour que le closer corrige. Une erreur de ligne fausse deux prospects d'un coup : celui qui est marqué à tort, et celui qui aurait dû l'être.

## 7. Le CRM ne connaît pas les no-shows

**Ce qui s'est passé.** L'équipe ne passait jamais une fiche en « absent ». Et l'étape de premier appel était posée **automatiquement** dès la réservation. Aucune des deux ne disait si le prospect était venu.

**Ce qu'il faut faire.** La présence vient de l'enregistreur seul. Mettez les étapes automatiques dans `crm.ignoreStages`. Ne mappez en `followUp` que des étapes posées par un humain **après** l'appel.

## 8. Un appel sans enregistreur devient un No-Show

**Ce qui s'est passé.** Seuls les comptes d'enregistreur du closer principal étaient lus. Un appel mené par quelqu'un d'autre, sans enregistreur, serait noté No-Show dès que `ABSENT_IF_NO_RECORDING_FROM` est posé.

**Ce qu'il faut faire.**
- Une clé par compte d'enregistreur, pour **chaque** personne qui prend des appels (`FATHOM_API_KEYS=cle1,cle2`).
- Ne posez `ABSENT_IF_NO_RECORDING_FROM` qu'à partir du jour où tous les appels sont enregistrés.
- Le closer peut corriger : sa correction reste pour toujours.

## 9. Venus, mais aucun résultat nulle part

**Ce qui s'est passé.** Après la mise en ligne, quelques prospects venus n'avaient de résultat ni dans le CRM ni dans la feuille. Le service les a laissés vides, comme prévu.

**Ce qu'il faut faire.** Rien côté service : une case Outcome vide sur un appel passé, c'est la liste de tâches du closer. Un filtre « Outcome vide et date passée » dans la feuille la rend visible.

## 10. La règle des 3 heures n'avait pas encore été vue sur un appel du jour

**Ce qui s'est passé.** Au moment de la mise en ligne, les résultats avaient été écrits sur des appels des jours précédents. La règle « 3 h après l'appel » n'avait pas encore tourné sur un appel du jour même.

**Ce qu'il faut faire.** Revenir le lendemain et relire les appels de la veille. Une règle qui n'a tourné que sur du passé n'est pas encore prouvée.
