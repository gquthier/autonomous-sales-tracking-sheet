# L'adaptateur CRM

Le service a besoin d'une seule chose de votre CRM : pour chaque prospect, ce que l'équipe a décidé après l'appel. Il ne l'écrit jamais.

## L'interface

Une source de CRM est une fonction asynchrone qui rend un tableau d'objets simples, une ligne par prospect. Ensuite, `normalizeLeads()` (`src/crm.js`) ramène chaque ligne à :

```js
{
  email: 'julie@atlas-fitness.example',  // en minuscules
  phone: '+33 6 00 00 01 01',                 // comparé sur les `phoneDigits` derniers chiffres
  status: 'won',                         // won | no_show | lost | bad_fit | follow_up | open
  amount: 2400,                          // montant du deal gagné, ou null
  split: false,                          // payé en plusieurs fois ?
}
```

Quatre sources sont fournies, choisies par `CRM_ADAPTER` :

| `CRM_ADAPTER` | Lit | Variables |
| --- | --- | --- |
| `none` (défaut) | Rien. Seul l'enregistreur décide (No-Show) | |
| `json` | Un export JSON : un tableau, ou `{ "leads": [...] }` | `CRM_JSON_FILE` |
| `http` | `GET` d'une URL qui rend un tableau, ou `{ "leads" }`, `{ "data" }`, `{ "items" }` | `CRM_HTTP_URL`, `CRM_HTTP_TOKEN` (en-tête `Authorization: Bearer`) |
| `./chemin/module.js` | Votre module, qui exporte `async fetchLeads({ env, settings, fetchImpl })` | les vôtres |

Exemple de module complet, sur une API REST paginée fictive : [examples/crm-adapter.example.js](../examples/crm-adapter.example.js). Si votre CRM a un webhook ou une vue « deals », l'adaptateur `http` sur une petite route en lecture seule est souvent le plus simple.

## La correspondance : vos champs, vos étapes

Les lignes de votre CRM gardent leurs noms. Le bloc `crm` de `config.json` dit où lire quoi :

```json
"crm": {
  "fields": {
    "email": "email",
    "phone": "telephone",
    "stage": ["etape"],
    "lostReason": "raison_perte",
    "amount": "montant",
    "paymentMethod": "paiement",
    "noShow": "absent_le",
    "paidAt": "paye_le"
  },
  "stages": {
    "won": ["Signé"],
    "noShow": ["Absent"],
    "lost": ["Perdu"],
    "badFit": ["Non qualifié"],
    "followUp": ["Second appel", "Proposition envoyée", "Relance"]
  },
  "ignoreStages": ["Nouveau", "RDV pris"],
  "badFitReasons": "bon client|qualif|not a fit|hors cible|hors zone",
  "splitPayment": "split|plusieurs|echeanc|mensual|\\b\\d+ ?x\\b"
}
```

- `stage` peut lister plusieurs champs (par exemple l'étape de la fiche et l'étape du pipeline). Il suffit que l'un d'eux corresponde.
- Les champs imbriqués s'écrivent avec des points : `"deal.stage"`.
- Les étapes sont comparées sans casse, sans accents, et `_` vaut une espace : `second_appel` = `Second appel`.
- Priorité : gagné (ou une date de paiement) > absent (ou une date d'absence) > perdu > pas le bon client > suivi. Le reste vaut `open` et n'écrit rien.
- `badFitReasons` : un « perdu » dont la raison correspond devient « pas le bon client ».
- `splitPayment` : un « gagné » dont le moyen de paiement correspond devient « payé en plusieurs fois ».
- Sans bloc `crm`, les lignes doivent déjà avoir les noms par défaut : `email`, `phone`, `status` (avec les valeurs `won`, `no_show`, `lost`, `bad_fit`, `follow_up`), `lostReason`, `amount`, `paymentMethod`, `noShowAt`, `paidAt`.

`node scripts/run.js --check` liste les étapes trouvées dans le CRM qui ne sont ni classées ni ignorées. Classez-les toutes avant la mise en ligne.

## Deux pièges vécus

- **Le CRM ne marque jamais les no-shows.** Personne ne prend le temps de passer une fiche en « absent ». La présence doit venir de l'enregistreur, pas du CRM.
- **Une étape posée automatiquement à la réservation ne prouve rien.** Si votre CRM passe la fiche en « RDV pris » ou « R1 » dès la réservation, cette étape ne dit pas que l'appel a eu lieu. Mettez-la dans `ignoreStages`, jamais dans `followUp`.

## Exemple : une base Postgres en lecture seule

Si votre CRM est votre propre application, lisez sa base dans une transaction en lecture seule. Ce module demande `npm install pg` dans votre copie ; le dépôt n'a aucune dépendance.

```js
// my-crm.js — CRM_ADAPTER=./my-crm.js, DATABASE_URL dans l'environnement
const { Client } = require('pg');
exports.fetchLeads = async ({ env }) => {
  const db = new Client({ connectionString: env.DATABASE_URL, options: '-c default_transaction_read_only=on', statement_timeout: 20000 });
  await db.connect();
  try {
    const { rows } = await db.query(`
      SELECT email, phone, stage, pipeline_stage, no_show_at, paid_at, paid_amount, payment_method, lost_reason
      FROM leads WHERE booked_at IS NOT NULL`);
    return rows;
  } finally { await db.end().catch(() => {}); }
};
```

Avec, dans `config.json` :

```json
"crm": {
  "fields": { "stage": ["stage", "pipeline_stage"], "noShow": "no_show_at", "paidAt": "paid_at", "amount": "paid_amount", "paymentMethod": "payment_method", "lostReason": "lost_reason" },
  "stages": { "won": ["won"], "noShow": ["no_show"], "lost": ["lost"], "badFit": ["not_qualified"], "followUp": ["second_call", "proposal", "thinking"] }
}
```

## Si le CRM ne répond pas

La passe des Outcomes s'arrête avant d'écrire quoi que ce soit, note `crmError` dans sa sortie et réessaie à la passe suivante. Les réservations et les liens continuent d'être écrits. Sans le CRM, le service pourrait écrire « No-Show » sur un prospect qui a signé au téléphone ; il préfère se taire.
