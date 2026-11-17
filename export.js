'use strict';
/* Genera docs/directas.ics con las reservas directas (Instagram, WhatsApp) y las fechas cerradas desde la app,
   para que Booking y Airbnb las importen y bloqueen esas fechas. Solo publica fechas ("Reservado"): nunca nombres, teléfonos ni montos.
   También genera docs/disponibilidad.json con TODAS las fechas ocupadas (Booking, Airbnb, directas y cierres),
   para la página pública de reservas: tampoco lleva nombres, teléfonos ni montos, solo rangos de fechas. */
const fs = require('fs');
const { addDays, iso } = require('./ical');

const DIRECTAS = ['Instagram', 'Whatsapp'];
const vigente = (r, today) => r && r.checkin && r.checkout > r.checkin && r.checkout >= addDays(today, -30);
// 'bloqueada' no es solo cierres manuales: el sync de Booking/Airbnb también crea reservas 'bloqueada'
// cuando el iCal no trae huésped (ver ical.js). Cualquiera de estos tres estados ocupa la fecha.
const ocupa = r => r.estado === 'confirmada' || r.estado === 'pendiente' || r.estado === 'bloqueada';

function buildIcs(reservas, today) {
  const d8 = s => s.replace(/-/g, '');
  const evs = Object.values(reservas || {})
    // reservas directas vigentes y fechas cerradas desde la app (plataforma 'Cierre')
    .filter(r => r && vigente(r, today) && ((DIRECTAS.includes(r.plataforma) && (r.estado === 'confirmada' || r.estado === 'pendiente')) || (r.plataforma === 'Cierre' && r.estado === 'bloqueada')))
    .sort((a, b) => (a.checkin + a.id).localeCompare(b.checkin + b.id));
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ecos del Cerro//Reservas directas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Ecos del Cerro - reservas directas'];
  for (const r of evs) L.push('BEGIN:VEVENT', `UID:${r.id}@ecosdelcerro`, 'DTSTAMP:20260101T000000Z', `DTSTART;VALUE=DATE:${d8(r.checkin)}`, `DTEND;VALUE=DATE:${d8(r.checkout)}`, r.plataforma === 'Cierre' ? 'SUMMARY:Cerrado' : 'SUMMARY:Reservado', 'TRANSP:OPAQUE', 'END:VEVENT');
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

function buildDisponibilidad(reservas, today) {
  const rangos = Object.values(reservas || {})
    .filter(r => r && ocupa(r) && vigente(r, today))
    .map(r => ({ desde: r.checkin, hasta: r.checkout }))
    .sort((a, b) => a.desde.localeCompare(b.desde));
  return JSON.stringify({ actualizado: today, ocupado: rangos }) + '\n';
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
  const reservas = await r.json();
  const today = iso(new Date());
  const ics = buildIcs(reservas, today);
  const disponibilidad = buildDisponibilidad(reservas, today);
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/directas.ics', ics);
  fs.writeFileSync('docs/disponibilidad.json', disponibilidad);
  console.log(`docs/directas.ics: ${(ics.match(/BEGIN:VEVENT/g) || []).length} fechas`);
  console.log(`docs/disponibilidad.json: ${JSON.parse(disponibilidad).ocupado.length} rangos ocupados`);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { buildIcs, buildDisponibilidad };
