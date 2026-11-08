# Extensión SPLASH Agenda → Administración

Cuando exportas el Excel en https://splashapp.net.pe/agenda, la extensión lo lee y lo envía a la base
de administración. Allí se calculan los servicios pendientes por reportar de cada operario.

## Instalar (Chrome o Edge)
1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. Pulsa **Cargar descomprimida** y elige esta carpeta (`extension-agenda`).
3. Fija la extensión con el icono del rompecabezas.
4. Pulsa su icono e **inicia sesión con el usuario administrador** (30 días; solo se guarda el token).

## Usar
Abre la agenda del día y pulsa **Exportar Excel** como siempre. Aparece un aviso verde abajo a la derecha:
"Agenda del dd/mm enviada a administración". Si el aviso es rojo, inicia sesión en el icono de la extensión.
También puedes subir un Excel a mano desde el icono, o desde el panel admin (Servicios pendientes).

## Antes de usarla
Aplicar en Supabase `migrations/20261110_agenda_pending.sql`.

## Mantenimiento
`agenda-parser.js` y `exceljs.min.js` son copias de los de la raíz del proyecto; si cambias uno, copia el otro.
