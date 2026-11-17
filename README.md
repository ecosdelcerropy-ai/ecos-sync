# Ecos del Cerro — sincronización iCal

Corre en GitHub Actions cada 30 minutos (`.github/workflows/sync.yml`). Lee los enlaces iCal guardados en la base
(`config/ical`, se cargan desde la app en Ajustes), crea/actualiza/borra las fechas de Booking y Airbnb y deja el
resultado en `meta/ical`.

Secrets del repositorio (Settings → Secrets and variables → Actions):

| Secret | Valor |
|---|---|
| `API_KEY` | Clave de API web de Firebase |
| `DB_URL` | URL de la base, sin `.json` (ej. `https://…firebaseio.com/ecos/CLAVE`) |
| `BOT_EMAIL` | Email del usuario de Firebase Auth creado para el script |
| `BOT_PASSWORD` | Contraseña de ese usuario |

Ese email también tiene que estar en la lista de las reglas de Realtime Database.

Después de sincronizar, `export.js` publica (vía GitHub Pages, público, sin datos de huéspedes):
- `docs/directas.ics`: reservas directas (Instagram/WhatsApp) y cierres manuales, para que Booking/Airbnb las importen.
- `docs/disponibilidad.json`: **todas** las fechas ocupadas (cualquier plataforma), `{"actualizado":"YYYY-MM-DD","ocupado":[{"desde":"...","hasta":"..."}]}`, que usa la página pública de reservas (`web-reservas/`) para pintar el calendario.
