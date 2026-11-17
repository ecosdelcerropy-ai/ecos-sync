# Sincronización de Booking y Airbnb con Google Apps Script (sin servidor)

Corre cada 5 minutos en los servidores de Google, gratis, con tu cuenta. Hace lo mismo que `sync.js` de GitHub.

## Instalar (una sola vez, 5 minutos)

1. Entrá a https://script.google.com con la cuenta de Google que quieras (la de Ecos del Cerro).
2. **Proyecto nuevo**. Ponele de nombre "Ecos sync".
3. Borrá lo que viene en `Code.gs` y pegá todo el contenido del archivo `Code.gs` de esta carpeta. Guardá (Ctrl+S).
4. Rueda de **Configuración del proyecto** (a la izquierda) → **Propiedades del script** → *Agregar propiedad*, cuatro veces:
   - `API_KEY`: la clave de API web de Firebase (la que está en Ajustes de la app).
   - `BOT_EMAIL`: el correo del usuario robot (el mismo que está en los Secrets de GitHub).
   - `BOT_PASSWORD`: la contraseña de ese usuario. La escribís vos.
   - `DB_URL`: la URL de la base con la clave, sin `.json` (está en `ecos.properties` del proyecto).
5. Volvé al editor, elegí la función **`sincronizar`** y tocá **Ejecutar**. Google pide permisos (conectarse a servicios externos): aceptá.
   Abajo, en el registro, tiene que aparecer una línea con `creadas`, `vinculadas`... y sin errores.
6. Elegí la función **`instalar`** y **Ejecutar**. Eso crea el activador de cada 5 minutos.

## Apagar la sincronización de GitHub

Para que no corran las dos a la vez, hay que quitar el paso `node sync.js` del flujo de GitHub
(el que publica las reservas directas se queda). Avisame cuando el paso 5 funcione y lo hago yo.

## Cancelaciones

Si una reserva desaparece del calendario de Booking o Airbnb y sigue ausente 25 minutos,
se elimina de la app y queda un aviso en Inicio, igual que antes.

## Ver si funciona

En Ajustes → Calendarios iCal, "Última sincronización" debe mostrar la hora y "Google Apps Script".
En script.google.com → **Ejecuciones** se ve cada vuelta.
Para apagarlo: función **`desinstalar`**.
