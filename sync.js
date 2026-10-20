'use strict';
/* Sincroniza los calendarios iCal (Booking, Airbnb) con la base de Ecos del Cerro.
   Se ejecuta en GitHub Actions cada 30 minutos. Inicia sesión con un usuario de Firebase Auth. */
const crypto = require('crypto');
const { planSync, iso } = require('./ical');

const { API_KEY, BOT_EMAIL, BOT_PASSWORD, DB_URL } = process.env;
if (!API_KEY || !BOT_EMAIL || !BOT_PASSWORD || !DB_URL) { console.error('Faltan variables de entorno (API_KEY, BOT_EMAIL, BOT_PASSWORD, DB_URL).'); process.exit(1); }
const base = DB_URL.replace(/\/+$/, '');
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

async function login() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: BOT_EMAIL, password: BOT_PASSWORD, returnSecureToken: true })
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('No se pudo iniciar sesión: ' + (j.error?.message || r.status));
  return j.idToken;
}
async function db(method, path, token, body) {
  const r = await fetch(`${base}${path}.json?auth=${token}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`Base de datos ${method} ${path}: HTTP ${r.status}`);
  return r.json();
}

(async () => {
  const token = await login();
  const cfg = (await db('GET', '/config/ical', token)) || {};
  const reservas = (await db('GET', '/reservas', token)) || {};
  const today = iso(new Date());
  const total = { creadas: 0, vinculadas: 0, borradas: 0, perdidas: 0, avisos: 0, errores: [] };
  const cambios = {};

  for (const [plat, url] of Object.entries(cfg)) {
    if (!/^https?:\/\//.test(url || '')) continue;
    let text;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'EcosDelCerro/1.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      text = await r.text();
    } catch (e) { total.errores.push(`${plat}: ${e.message}`); continue; }
    const { updates, stats } = planSync({ plat, text, reservas, today, hash });
    Object.assign(cambios, updates);
    for (const c of ['creadas', 'vinculadas', 'borradas', 'perdidas', 'avisos']) total[c] += stats[c];
    total.errores.push(...stats.errores);
  }

  if (Object.keys(cambios).length) await db('PATCH', '/reservas', token, cambios);
  await db('PUT', '/meta/ical', token, { ultima: new Date().toISOString(), ...total, errores: total.errores.length ? total.errores : null });
  console.log(JSON.stringify({ ...total, cambios: Object.keys(cambios).length }));
  if (total.errores.length) process.exit(1);
})().catch(e => { console.error(e.message); process.exit(1); });
