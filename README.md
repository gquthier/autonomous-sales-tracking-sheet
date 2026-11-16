<div align="center">

<img src="https://img.shields.io/badge/SALES-SUIVI_DES_VENTES-B8893B?style=flat-square&labelColor=B8893B&color=14120E" alt="SALES · SUIVI DES VENTES">

# Autonomous Sales Tracking Sheet

### La feuille de suivi des ventes se remplit seule, sans jamais toucher à ce que le closer a tapé.

Chaque réservation devient une ligne dans l'onglet du mois.<br>
Trois heures après l'appel, le service écrit No-Show ou le résultat du deal,<br>
d'après l'enregistrement de l'appel et le CRM.

**[Installer le skill](#installation)** · **[Lire le playbook](SKILL.md)** · **[Les pièges du jour de la mise en ligne](references/04-pieges.md)**

<sub>Claude Code + Codex · iClosed · Fathom · Google Sheets · CRM par adaptateur · démo sans clé · Node 20+, aucune dépendance · MIT</sub>

<br><br>

<a href="https://bizos.cc"><img src="https://img.shields.io/badge/BizOS-build%20autonomous%20companies-14120E?style=for-the-badge&labelColor=14120E" alt="BizOS — build autonomous companies"></a>

<br><br>

<a href="https://x.com/gauthierthiry"><img src="https://img.shields.io/badge/@gauthierthiry-14120E?style=flat-square&logo=x&logoColor=white" alt="X"></a>
<a href="https://youtube.com/@gquthier"><img src="https://img.shields.io/badge/@gquthier-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube"></a>

</div>

---

## Ce que ça fait

Une équipe de vente tient une feuille de suivi : un onglet par mois, une ligne par appel, et une colonne Outcome qui nourrit le taux de présence et le taux de closing. Elle est toujours en retard. Les réservations sont recopiées à la main, les no-shows oubliés, les deals perdus jamais notés.

Pourtant, tout existe déjà ailleurs : la réservation dans l'outil de rendez-vous, la présence dans l'enregistrement, la décision dans le CRM. Ce service relie les trois à la feuille que l'équipe utilise déjà, sans en changer la forme.

| Moment | Le service écrit |
| --- | --- |
| **Réservation** (tous les calendriers de vente) | Une ligne dans l'onglet du mois de l'appel, une seule fois : date et heure, nom, source d'après les UTM, Booked = Yes, e-mail, téléphone, site, lien Meet, réponses au formulaire |
| **Annulation, déplacement** | Outcome = Cancelled, ou Rescheduled avec une nouvelle ligne à la nouvelle date |
| **Après l'appel** | Le lien de l'enregistrement |
| **3 h après l'appel**, si Outcome est vide | **No-Show** si le closer parle seul dans l'enregistrement, ou s'il n'y en a aucun. Sinon, le résultat du deal dans le CRM : perdu → Offer & Didn't Buy, pas le bon client → Bad Fit & No Offer, deuxième appel → No Deposit & Follow-Up, gagné → Full-Pay ou Split-Pay avec le montant |
| **Saisie humaine** | Rien, jamais. Si l'enregistrement la contredit, la ligne est signalée |

Ce qui ne peut pas arriver : une réservation écrite deux fois, une ligne effacée par l'équipe réécrite, une valeur tapée par le closer remplacée, un résultat inventé quand le CRM ne répond pas.

### La démo, sans aucune clé

Une agence fictive vend de l'acquisition d'adhérents à des salles de sport. Le script fait trois passes sur 13 réservations, 10 enregistrements et un export CRM. Entre deux passes, le closer tape deux résultats à la main.

```text
$ node scripts/run.js --demo
Pass 1, bookings and recording links: {"calls":13,"added":13,"cancelled":0,"rescheduled":0,"skipped":0,"linked":9,"kept":0}
Pass 2, outcomes: {"outcomes":7,"cleared":0,"closer":2,"conflicts":1}
  check Mar row 8: typed No-Show, but the prospect speaks in the recording (kept as typed)
Pass 3, same data again: {"added":0,"linked":0,"outcomes":0,"cleared":0}

Date            Name            Source     Outcome                 Revenue  Cash  Recording
09/03/26 10:00  Julie Moreau    Facebook   Full-Pay                2400     2400  yes
09/03/26 15:00  Karim Benali    Facebook   Offer & Didn't Buy                     yes
09/03/26 17:00  Maxime Lefevre  Facebook   No-Show                                yes
10/03/26 09:30  Sophie Laurent  Email      Bad Fit & No Offer                     yes
10/03/26 14:00  Thomas Girard   Email      No-Show                                yes
10/03/26 17:00  Nadia Haddad               No-Show
11/03/26 10:00  Lucas Petit     Facebook   No Deposit & Follow-Up                 yes
11/03/26 11:00  Emma Roux       Cold Call  Split-Pay               3600     3600  yes
11/03/26 16:00  Chloe Blanc     Email      Offer & Didn't Buy                     yes
12/03/26 09:00  Ines Garnier    Facebook   Cancelled
12/03/26 17:30  Lea Fontaine                                                      yes
13/03/26 10:00  Paul Mercier    Facebook
```

Personnes, entreprises, montants et liens sont inventés. Lea Fontaine a raccroché il y a moins de 3 heures, Paul Mercier n'a pas encore eu son appel. Le « No-Show » de Maxime a été tapé par le closer : le service le garde, mais signale la ligne, parce que Maxime parle pendant 42 minutes dans l'enregistrement.

## Installation

**Claude Code** — skill personnel :

```bash
git clone https://github.com/gquthier/autonomous-sales-tracking-sheet.git \
  ~/.claude/skills/sales-tracking-sheet
```

**Codex** — skill personnel :

```bash
git clone https://github.com/gquthier/autonomous-sales-tracking-sheet.git \
  ~/.codex/skills/sales-tracking-sheet
```

Ouvrez une nouvelle session, puis demandez :

> Avec le skill sales-tracking-sheet, branche nos calendriers iClosed, Fathom et notre CRM sur notre feuille de suivi des ventes. Montre-moi d'abord la vérification et un passage à blanc sur nos vraies données.

Ou, quand ça ne marche plus :

> Notre feuille de ventes ne se met plus à jour depuis quelques jours. Trouve pourquoi avec le skill sales-tracking-sheet et rattrape ce qui manque.

## Prérequis et clés

- **Node.js 20 ou plus.** Aucune dépendance : pas de `npm install` pour la démo, les tests ou le service.
- **Une feuille Google** avec un onglet par mois et un tableau des appels dont l'en-tête contient « Date » suivi de « Name ». Les autres colonnes sont trouvées par leur nom ([la feuille attendue](references/01-fonctionnement.md#la-feuille-attendue)).
- **Un compte de service Google**, Éditeur de la feuille ([pas à pas](references/05-mise-en-ligne.md)).
- Les clés vivent dans l'environnement, jamais dans un fichier commité. Noms dans [.env.example](.env.example) :

| Variable | Pour |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_B64` ou `_FILE`, `SPREADSHEET_ID` | Écrire dans la feuille |
| `ICLOSED_API_KEY`, `ICLOSED_EVENT_IDS` | Lire les réservations de tous les calendriers de vente |
| `FATHOM_API_KEYS` | Liens d'enregistrement et No-Show (une clé par compte) |
| `ABSENT_IF_NO_RECORDING_FROM` | À partir de quand un appel sans enregistrement compte comme No-Show |
| `CRM_ADAPTER` (`none`, `json`, `http`, ou votre module) | Résultat des deals ([l'adaptateur](references/03-crm.md)) |
| `ALERT_WEBHOOK_URL` | Être prévenu quand le service échoue plusieurs passes de suite |

Le vocabulaire de votre feuille et de votre CRM (noms des onglets, mots de la liste Outcome, règles de source, équipe, étapes du CRM) va dans `config.json`, sans aucun secret. Modèle : [examples/config.example.json](examples/config.example.json).

## Utilisation

```bash
cd ~/.claude/skills/sales-tracking-sheet
node scripts/run.js --demo       # données fictives, aucune clé
node --test                      # 44 tests hors ligne
```

Sur vos vraies données, dans cet ordre :

```bash
node scripts/run.js --check      # lecture seule : feuille partagée ? bonne feuille ? calendriers oubliés ? étapes CRM non classées ?
node scripts/run.js --dry-run    # passe complète sur une copie en mémoire : chaque cellule qui changerait, rien d'écrit
node scripts/run.js --once       # une passe réelle
npm start                        # le service : une passe toutes les 2 minutes, GET /health
```

## Dans le dépôt

```text
SKILL.md                          Le playbook de l'agent, du cadrage à la relecture de la feuille
references/01-fonctionnement.md   Une passe étape par étape, la feuille attendue, le registre
references/02-regles-resultat.md  Les règles de l'Outcome, qui a le dernier mot, les saisies contredites
references/03-crm.md              L'adaptateur CRM : interface, correspondance des étapes, exemples
references/04-pieges.md           Les pièges du jour de la mise en ligne
references/05-mise-en-ligne.md    Compte de service, variables, Railway ou autre, retour arrière
src/                              Le service : réservations, enregistrements, CRM, règles, feuille
scripts/run.js                    La ligne de commande : --demo, --check, --dry-run, --once, --setup
examples/                         Configuration, adaptateur CRM et données de démo, tous fictifs
test/                             Tests hors ligne, dont les vrais clients d'API sur des réponses simulées
```

## Limites honnêtes

- **Testé hors ligne dans ce dépôt.** Les 44 tests et la démo tournent sans réseau. Les clients iClosed, Fathom et Google sont testés contre des réponses qui suivent la forme des vraies. La logique vient d'un service qui tourne en production, mais ce dépôt en est une réécriture générique : commencez par `--check` et `--dry-run`.
- **Un seul outil de rendez-vous (iClosed) et un seul enregistreur (Fathom)** sont branchés. Un autre outil demande d'écrire un client qui rend les mêmes objets. Le reste ne change pas.
- **La présence se lit dans la transcription.** Si l'enregistreur ne reconnaît pas les voix, ou si un collègue n'est pas déclaré dans `team`, le décompte se trompe. Un appel au téléphone sans enregistrement compte comme No-Show dès que `ABSENT_IF_NO_RECORDING_FROM` est posé, sauf si le CRM dit autre chose.
- **Le résultat d'un deal ne vaut que ce que vaut le CRM.** Une étape mal classée donne un Outcome faux. `--check` liste les étapes non classées, et `--dry-run` montre ce qu'elles donnent.
- **La règle des 3 heures** venait d'être mise en ligne quand ce dépôt a été écrit. Elle avait tourné sur des appels passés, pas encore sur un appel du jour même.
- **La forme de la feuille est supposée stable** : un onglet par mois, un en-tête « Date » puis « Name ». Le tableau de bord, les formules et les couleurs ne sont jamais touchés, donc jamais réparés non plus.
- Les enregistrements contiennent des données personnelles. Le service ne les copie pas : il ne garde que le lien et le nombre de segments par voix, et ne met aucun nom dans ses logs. Respectez le droit de votre pays sur l'enregistrement des appels.

## Contribuer

Ouvrez une issue avec la commande, la sortie et, pour un problème d'API, la forme anonymisée de la réponse reçue. Gardez les exemples fictifs.

MIT pour le code, les instructions et les exemples de ce dépôt. iClosed, Fathom, Google Sheets et les autres outils cités appartiennent à leurs éditeurs ; ce projet n'est affilié à aucun d'eux.

---
