'use strict';
/* Lógica pura de iCal: parseo y decisión de cambios. Sin dependencias, para poder probarla localmente. */

const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const toDate = v => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;

function parseIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') {
      if (cur && cur.start) { if (!cur.end || cur.end <= cur.start) cur.end = addDays(cur.start, 1); out.push(cur); }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':'); if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].toUpperCase(), val = line.slice(i + 1).trim();
      if (key === 'DTSTART') cur.start = toDate(val);
      else if (key === 'DTEND') cur.end = toDate(val);
      else if (key === 'UID') cur.uid = val;
      else if (key === 'SUMMARY') cur.summary = val;
      else if (key === 'DESCRIPTION') cur.desc = val.replace(/\\n/g, '\n').replace(/\\,/g, ',');
    }
  }
  return out;
}

/* Devuelve { updates, stats } donde updates es un mapa de rutas relativas a /reservas (null = borrar). */
function planSync({ plat, text, reservas, today, hash }) {
  const stats = { creadas: 0, vinculadas: 0, borradas: 0, perdidas: 0, avisos: 0, eventos: 0, errores: [] };
  const updates = {};
  if (!/BEGIN:VCALENDAR/.test(text)) { stats.errores.push(`${plat}: la respuesta no es un calendario iCal`); return { updates, stats }; }
  const events = parseIcs(text).filter(e => e.uid && e.end >= addDays(today, -30));
  stats.eventos = events.length;
  const mine = Object.values(reservas).filter(r => r && r.plataforma === plat);
  const autoCount = mine.filter(r => r.auto && r.estado === 'bloqueada').length;
  const uids = new Set(events.map(e => e.uid));

  for (const e of events) {
    const r = mine.find(x => x.icalUid === e.uid) || mine.find(x => !x.icalUid && x.checkin === e.start && x.checkout === e.end);
    if (r) {
      if (r.icalUid !== e.uid) { updates[`${r.id}/icalUid`] = e.uid; r.icalUid = e.uid; stats.vinculadas++; }
      if (r.icalMissing) updates[`${r.id}/icalMissing`] = null;
      const cambio = r.checkin !== e.start || r.checkout !== e.end;
      if (cambio && (r.auto && r.estado === 'bloqueada')) { updates[`${r.id}/checkin`] = e.start; updates[`${r.id}/checkout`] = e.end; }
      else if (cambio) { updates[`${r.id}/icalAviso`] = `El calendario de ${plat} ahora indica ${e.start} → ${e.end}`; stats.avisos++; }
      else if (r.icalAviso) updates[`${r.id}/icalAviso`] = null;
      continue;
    }
    const id = 'i' + hash(plat + e.uid);
    const reservada = plat === 'Airbnb' && /reserved/i.test(e.summary || '');
    const url = (e.desc || '').match(/https?:\/\/\S+/);
    updates[id] = {
      id, plataforma: plat, checkin: e.start, checkout: e.end, huespedes: 0, total: 0, pagado: 0, comision: 0, telefono: '', resena: 'No',
      cliente: reservada ? 'Reserva Airbnb (completar)' : `Cerrado (${plat} iCal)`,
      estado: reservada ? 'pendiente' : 'bloqueada',
      notas: `Creado automáticamente desde el iCal de ${plat}${e.summary ? ` (${e.summary})` : ''}.${url ? ' ' + url[0] : ''} Completá nombre, teléfono y montos.`,
      icalUid: e.uid, auto: true
    };
    stats.creadas++;
  }

  const vacio = events.length === 0 && autoCount > 3;
  if (vacio) stats.errores.push(`${plat}: el calendario vino sin eventos; no se borró nada por seguridad`);
  else for (const r of mine) {
    if (!r.icalUid || uids.has(r.icalUid) || r.checkout < today) continue;
    if (r.auto && r.estado === 'bloqueada') { updates[r.id] = null; stats.borradas++; }
    else if (!r.icalMissing) { updates[`${r.id}/icalMissing`] = true; stats.perdidas++; }
  }
  return { updates, stats };
}

module.exports = { parseIcs, planSync, addDays, iso };
