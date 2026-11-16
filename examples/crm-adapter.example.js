'use strict';
// Example of a custom CRM adapter: CRM_ADAPTER=./examples/crm-adapter.example.js
//
// The contract is one function: async fetchLeads({ env, settings, fetchImpl }) -> array of plain objects.
// Return the raw fields of your CRM and describe them in the "crm" block of config.json,
// or return objects that already use the default names: { email, phone, status, lostReason, amount, paymentMethod }
// with status in won | no_show | lost | bad_fit | follow_up (anything else counts as "open").
//
// This one reads a fictional paginated REST API: GET {EXAMPLE_CRM_URL}/deals?page=N -> { deals: [...], next: bool }.
// Read only: the service never writes to your CRM.
async function fetchLeads({ env, fetchImpl = fetch }) {
  const base = env.EXAMPLE_CRM_URL;
  if (!base) throw new Error('EXAMPLE_CRM_URL is missing');
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await fetchImpl(`${base}/deals?page=${page}`, { headers: { authorization: `Bearer ${env.EXAMPLE_CRM_TOKEN || ''}` } });
    if (!res.ok) throw new Error(`Example CRM ${res.status}`);
    const body = await res.json();
    for (const d of body.deals || []) {
      rows.push({
        email: d.contact?.email,
        phone: d.contact?.phone,
        status: { closed_won: 'won', closed_lost: 'lost', disqualified: 'bad_fit', second_call: 'follow_up', no_show: 'no_show' }[d.stage] || 'open',
        lostReason: d.lost_reason,
        amount: d.value,
        paymentMethod: d.installments > 1 ? 'split' : 'full',
      });
    }
    if (!body.next) break;
  }
  return rows;
}

module.exports = { fetchLeads };
