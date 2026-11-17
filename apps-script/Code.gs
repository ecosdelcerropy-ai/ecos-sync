/**
 * Ecos del Cerro: sincronización con Booking y Airbnb desde Google Apps Script (sin servidor propio).
 * Corre cada 5 minutos con un activador de Google. Hace lo mismo que sync.js de GitHub, con dos diferencias:
 *  - una reserva que desaparece del calendario se da por cancelada cuando lleva ausente MIN_AUSENCIA_MIN minutos
 *    (en GitHub eran "dos revisiones seguidas"; a 5 minutos por vuelta hace falta medir el tiempo);
 *  - el estado se guarda en la misma base (icalMissing pasa a ser la hora en que se la dejó de ver).
 *
 * Datos que se guardan en Propiedades del script (Configuración del proyecto), nunca en el código:
 *   API_KEY, BOT_EMAIL, BOT_PASSWORD, DB_URL  (los mismos que los Secrets de GitHub).
 */
var MIN_AUSENCIA_MIN = 25;

/* ---------- lógica de iCal (misma que ecos-sync/ical.js) ---------- */
function iso_(d) { return d.toISOString().slice(0, 10); }
function addDays_(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso_(d); }
function toDate_(v) { return v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8); }
function hash_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 12);
}

function parseIcs_(text) {
  var lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  var out = [], cur = null;
  lines.forEach(function (line) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') {
      if (cur && cur.start) { if (!cur.end || cur.end <= cur.start) cur.end = addDays_(cur.start, 1); out.push(cur); }
      cur = null;
    } else if (cur) {
      var i = line.indexOf(':'); if (i < 0) return;
      var key = line.slice(0, i).split(';')[0].toUpperCase(), val = line.slice(i + 1).trim();
      if (key === 'DTSTART') cur.start = toDate_(val);
      else if (key === 'DTEND') cur.end = toDate_(val);
      else if (key === 'UID') cur.uid = val;
      else if (key === 'SUMMARY') cur.summary = val;
      else if (key === 'DESCRIPTION') cur.desc = val.replace(/\\n/g, '\n').replace(/\\,/g, ',');
    }
  });
  return out;
}

/** Devuelve { updates, avisos, stats }. updates: rutas relativas a /reservas (null = borrar). now: milisegundos. */
function planSync_(o) {
  var plat = o.plat, text = o.text, reservas = o.reservas, today = o.today, now = o.now;
  var stats = { creadas: 0, vinculadas: 0, borradas: 0, perdidas: 0, avisos: 0, canceladas: 0, eventos: '', errores: [] };
  var updates = {}, avisos = {};
  if (!/BEGIN:VCALENDAR/.test(text)) { stats.errores.push(plat + ': la respuesta no es un calendario iCal'); return { updates: updates, avisos: avisos, stats: stats }; }
  var todos = parseIcs_(text).map(function (e) { e.uid = e.uid || (plat + '-' + e.start + '-' + e.end); return e; });
  var events = todos.filter(function (e) { return e.end >= addDays_(today, -30); });
  stats.eventos = events.length + ' vigentes de ' + todos.length + ' leídos';
  var mine = Object.keys(reservas).map(function (k) { return reservas[k]; }).filter(function (r) { return r && r.plataforma === plat; });
  var autoCount = mine.filter(function (r) { return r.auto && r.estado === 'bloqueada'; }).length;
  var uids = {}; events.forEach(function (e) { uids[e.uid] = true; });

  events.forEach(function (e) {
    var r = mine.filter(function (x) { return x.icalUid === e.uid; })[0] ||
      mine.filter(function (x) { return !x.icalUid && x.checkin === e.start && x.checkout === e.end; })[0];
    if (r) {
      if (r.icalUid !== e.uid) { updates[r.id + '/icalUid'] = e.uid; r.icalUid = e.uid; stats.vinculadas++; }
      if (r.icalMissing) updates[r.id + '/icalMissing'] = null;
      var cambio = r.checkin !== e.start || r.checkout !== e.end;
      if (cambio && (r.auto && r.estado === 'bloqueada')) { updates[r.id + '/checkin'] = e.start; updates[r.id + '/checkout'] = e.end; }
      else if (cambio) { updates[r.id + '/icalAviso'] = 'El calendario de ' + plat + ' ahora indica ' + e.start + ' → ' + e.end; stats.avisos++; }
      else if (r.icalAviso) updates[r.id + '/icalAviso'] = null;
      return;
    }
    var id = 'i' + hash_(plat + e.uid);
    var reservada = plat === 'Airbnb' && /reserved/i.test(e.summary || '');
    var url = (e.desc || '').match(/https?:\/\/\S+/);
    updates[id] = {
      id: id, plataforma: plat, checkin: e.start, checkout: e.end, huespedes: 0, total: 0, pagado: 0, comision: 0, telefono: '', resena: 'No',
      cliente: reservada ? 'Reserva Airbnb (completar)' : 'Cerrado (' + plat + ' iCal)',
      estado: reservada ? 'pendiente' : 'bloqueada',
      notas: 'Creado automáticamente desde el iCal de ' + plat + (e.summary ? ' (' + e.summary + ')' : '') + '.' + (url ? ' ' + url[0] : '') + ' Completá nombre, teléfono y montos.',
      icalUid: e.uid, auto: true
    };
    stats.creadas++;
  });

  var vacio = events.length === 0 && autoCount > 3;
  if (vacio) stats.errores.push(plat + ': el calendario vino sin eventos; no se borró nada por seguridad');
  else mine.forEach(function (r) {
    if (!r.icalUid || uids[r.icalUid] || r.checkout < today || r.estado === 'cancelada') return;
    if (r.auto && r.estado === 'bloqueada') { updates[r.id] = null; stats.borradas++; }
    else if (events.length === 0) return; // un calendario vacío puede ser un fallo de la plataforma: no se cancela nada
    else if (r.icalMissing) {
      // icalMissing = hora en que se la dejó de ver (true = marca vieja de GitHub). Se cancela si lleva MIN_AUSENCIA_MIN minutos ausente.
      var desde = typeof r.icalMissing === 'number' ? r.icalMissing : 0;
      if (now - desde < MIN_AUSENCIA_MIN * 60000) return;
      updates[r.id] = null;
      var aid = 'a' + hash_(r.id + '|' + today);
      avisos[aid] = {
        id: aid, tipo: 'cancelacion', fecha: today, plataforma: plat, cliente: r.cliente || '', checkin: r.checkin, checkout: r.checkout,
        total: +r.total || 0, pagado: +r.pagado || 0, telefono: r.telefono || '', notas: (r.notas || '').slice(0, 300),
        texto: (r.cliente || 'Una reserva') + ' canceló en ' + plat + ' (' + r.checkin + ' → ' + r.checkout + '). Se eliminó de la app.'
      };
      stats.canceladas++;
    }
    else { updates[r.id + '/icalMissing'] = now; stats.perdidas++; }
  });
  return { updates: updates, avisos: avisos, stats: stats };
}

/* ---------- base de datos (Firebase REST) ---------- */
function conf_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  ['API_KEY', 'BOT_EMAIL', 'BOT_PASSWORD', 'DB_URL'].forEach(function (k) { if (!p[k]) throw new Error('Falta la propiedad ' + k + ' en Configuración del proyecto → Propiedades del script.'); });
  return { apiKey: p.API_KEY, email: p.BOT_EMAIL, pass: p.BOT_PASSWORD, base: p.DB_URL.replace(/\/+$/, '') };
}
function token_(c) {
  var cache = CacheService.getScriptCache(), t = cache.get('idToken');
  if (t) return t;
  var r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + c.apiKey, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: c.email, password: c.pass, returnSecureToken: true })
  });
  var j = JSON.parse(r.getContentText());
  if (!j.idToken) throw new Error('No se pudo iniciar sesión: ' + ((j.error && j.error.message) || r.getResponseCode()));
  cache.put('idToken', j.idToken, 50 * 60); // el token dura 1 hora
  return j.idToken;
}
function db_(c, method, path, body) {
  var opt = { method: method.toLowerCase(), contentType: 'application/json', muteHttpExceptions: true };
  if (body !== undefined) opt.payload = JSON.stringify(body);
  var r = UrlFetchApp.fetch(c.base + path + '.json?auth=' + token_(c), opt);
  if (r.getResponseCode() === 401) { CacheService.getScriptCache().remove('idToken'); r = UrlFetchApp.fetch(c.base + path + '.json?auth=' + token_(c), opt); }
  if (r.getResponseCode() !== 200) throw new Error('Base de datos ' + method + ' ' + path + ': HTTP ' + r.getResponseCode());
  return JSON.parse(r.getContentText());
}

function bajarCalendario_(url) {
  var falla = '';
  for (var intento = 1; intento <= 3; intento++) {
    try {
      var r = UrlFetchApp.fetch(url, { headers: { 'User-Agent': 'EcosDelCerro/1.0' }, muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) throw new Error('HTTP ' + r.getResponseCode());
      return { text: r.getContentText() };
    } catch (e) {
      falla = e.message;
      if (intento < 3) Utilities.sleep(3000 * intento);
    }
  }
  return { error: falla };
}

/* ---------- vuelta principal (la llama el activador cada 5 minutos) ---------- */
function sincronizar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // otra vuelta sigue en curso
  try {
    var c = conf_();
    var cfg = db_(c, 'GET', '/config/ical') || {};
    var reservas = db_(c, 'GET', '/reservas') || {};
    var now = Date.now(), today = iso_(new Date(now));
    var total = { creadas: 0, vinculadas: 0, borradas: 0, perdidas: 0, avisos: 0, canceladas: 0, eventos: {}, errores: [] };
    var cambios = {}, avisosNuevos = {};

    Object.keys(cfg).forEach(function (plat) {
      var url = cfg[plat];
      if (!/^https?:\/\//.test(url || '')) return;
      var res = bajarCalendario_(url);
      if (res.text === undefined) { total.errores.push(plat + ': ' + res.error); return; }
      var plan = planSync_({ plat: plat, text: res.text, reservas: reservas, today: today, now: now });
      Object.keys(plan.updates).forEach(function (k) { cambios[k] = plan.updates[k]; });
      Object.keys(plan.avisos).forEach(function (k) { avisosNuevos[k] = plan.avisos[k]; });
      total.eventos[plat] = plan.stats.eventos + ', ' + res.text.length + ' bytes';
      ['creadas', 'vinculadas', 'borradas', 'perdidas', 'avisos', 'canceladas'].forEach(function (k) { total[k] += plan.stats[k]; });
      plan.stats.errores.forEach(function (e) { total.errores.push(e); });
    });

    // El aviso se guarda primero: si algo falla después, la reserva sigue ahí y se reintenta en la próxima vuelta.
    if (Object.keys(avisosNuevos).length) db_(c, 'PATCH', '/avisos', avisosNuevos);
    if (Object.keys(cambios).length) db_(c, 'PATCH', '/reservas', cambios);
    var meta = { ultima: new Date(now).toISOString(), origen: 'Google Apps Script' };
    Object.keys(total).forEach(function (k) { meta[k] = total[k]; });
    meta.errores = total.errores.length ? total.errores : null;
    db_(c, 'PUT', '/meta/ical', meta);
    console.log(JSON.stringify({ creadas: total.creadas, vinculadas: total.vinculadas, borradas: total.borradas, canceladas: total.canceladas, cambios: Object.keys(cambios).length, errores: total.errores }));
  } finally {
    lock.releaseLock();
  }
}

/** Se ejecuta una sola vez a mano: crea el activador que corre sincronizar() cada 5 minutos. */
function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sincronizar') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(5).create();
  console.log('Listo: sincronizar() correrá cada 5 minutos.');
}

/** Para apagar la sincronización de este script. */
function desinstalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  console.log('Activadores eliminados.');
}
