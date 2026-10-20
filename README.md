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
