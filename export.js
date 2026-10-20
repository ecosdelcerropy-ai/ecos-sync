'use strict';
/* Genera docs/directas.ics con las reservas directas (Instagram, WhatsApp) para que Booking y Airbnb las importen
   y bloqueen esas fechas. Solo publica fechas ("Reservado"): nunca nombres, teléfonos ni montos. */
const fs = require('fs');
const { addDays, iso } = require('./ical');

const DIRECTAS = ['Instagram', 'Whatsapp'];

function buildIcs(reservas, today) {
  const d8 = s => s.replace(/-/g, '');
  const evs = Object.values(reservas || {})
    .filter(r => r && DIRECTAS.includes(r.plataforma) && (r.estado === 'confirmada' || r.estado === 'pendiente')
      && r.checkin && r.checkout > r.checkin && r.checkout >= addDays(today, -30))
    .sort((a, b) => (a.checkin + a.id).localeCompare(b.checkin + b.id));
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ecos del Cerro//Reservas directas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Ecos del Cerro - reservas directas'];
  for (const r of evs) L.push('BEGIN:VEVENT', `UID:${r.id}@ecosdelcerro`, 'DTSTAMP:20260101T000000Z', `DTSTART;VALUE=DATE:${d8(r.checkin)}`, `DTEND;VALUE=DATE:${d8(r.checkout)}`, 'SUMMARY:Reservado', 'TRANSP:OPAQUE', 'END:VEVENT');
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

async function main() {
  const { API_KEY, BOT_EMAIL, BOT_PASSWORD, DB_URL } = process.env;
  if (!API_KEY || !BOT_EMAIL || !BOT_PASSWORD || !DB_URL) throw new Error('Faltan variables de entorno.');
  const lr = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: BOT_EMAIL, password: BOT_PASSWORD, returnSecureToken: true })
  });
  const lj = await lr.json();
  if (!lj.idToken) throw new Error('No se pudo iniciar sesión: ' + (lj.error?.message || lr.status));
  const r = await fetch(`${DB_URL.replace(/\/+$/, '')}/reservas.json?auth=${lj.idToken}`);
  if (!r.ok) throw new Error('Base de datos: HTTP ' + r.status);
  const ics = buildIcs(await r.json(), iso(new Date()));
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/directas.ics', ics);
  console.log(`docs/directas.ics: ${(ics.match(/BEGIN:VEVENT/g) || []).length} fechas`);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { buildIcs };
