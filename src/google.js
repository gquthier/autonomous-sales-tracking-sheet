'use strict';
// Minimal Google service-account auth + Sheets REST client. No SDK, no dependency.
const crypto = require('node:crypto');

const b64url = s => Buffer.from(s).toString('base64url');

function createSheetsClient(credentials, { fetchImpl = fetch, now = () => Date.now(), retries = 3, retryMs = 20_000, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (!credentials || !credentials.client_email || !credentials.private_key) throw new Error('Google service account key is missing or incomplete');
  let cached = null;

  async function token() {
    if (cached && cached.exp - 60_000 > now()) return cached.value;
    const iat = Math.floor(now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
    const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(credentials.private_key, 'base64url');
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
    });
    if (!res.ok) throw Object.assign(new Error(`Google token ${res.status}`), { status: res.status });
    const d = await res.json();
    cached = { value: d.access_token, exp: now() + d.expires_in * 1000 };
    return cached.value;
  }

  // The per-minute read quota belongs to the Google Cloud project of the service account, not to the sheet:
  // every other job using the same account eats from it. On 429 or 5xx, wait and retry instead of failing the pass.
  async function call(method, path, body, attempt = 0) {
    const res = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
      method,
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await wait(retryMs * (attempt + 1));
      return call(method, path, body, attempt + 1);
    }
    if (res.status === 403 || res.status === 404) {
      // The most common silent failure: the sheet was never shared with the service account.
      throw Object.assign(new Error(`Sheets ${res.status}: share the sheet with ${credentials.client_email} as Editor (or check SPREADSHEET_ID)`), { status: res.status });
    }
    if (!res.ok) throw Object.assign(new Error(`Sheets ${method} ${res.status}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 200)}`), { status: res.status });
    return res.json();
  }

  return { call, email: credentials.client_email };
}

// Key from GOOGLE_SERVICE_ACCOUNT_B64 (base64 of the JSON key) or GOOGLE_SERVICE_ACCOUNT_FILE (path to the JSON key).
function credentialsFromEnv(env, readFile = p => require('node:fs').readFileSync(p, 'utf8')) {
  if (env.GOOGLE_SERVICE_ACCOUNT_B64) return JSON.parse(Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString());
  if (env.GOOGLE_SERVICE_ACCOUNT_FILE) return JSON.parse(readFile(env.GOOGLE_SERVICE_ACCOUNT_FILE));
  return null;
}

module.exports = { createSheetsClient, credentialsFromEnv };
