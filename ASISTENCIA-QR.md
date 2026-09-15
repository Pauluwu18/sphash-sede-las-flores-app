# Asistencia por QR · SPLASH SEDE LAS FLORES

## Activación en Supabase

1. Publica los archivos de este cambio en el mismo sitio HTTPS de administración.
2. En el SQL Editor del proyecto `yyhvpbgvmnhonyqzevfr`, ejecuta completo `migrations/20260915_qr_attendance.sql`. Requiere las tablas del esquema existente. No vuelvas a ejecutar `supabase-schema.sql` después: sus políticas antiguas permiten acceso público a las asistencias.
3. Guarda en privado el resultado `usuario` / `clave_inicial`. Se entrega solo en la primera ejecución. Esta es la nueva clave de `admin`; reemplaza el acceso que antes se verificaba dentro del navegador. No subas esa clave a GitHub ni la compartas en el chat.
4. Recarga la página de administración e inicia sesión con esa clave. En **Personas registradas**, abre cada **Perfil** y completa su DNI real de ocho dígitos. No se inventan DNI. Los nombres históricos se importan automáticamente; al ingresar también se importa el padrón local de ese navegador.
5. En el menú, abre **QR de asistencia** desde la URL HTTPS definitiva. Descarga la imagen o imprímela y colócala en la base.

La migración es transaccional y puede repetirse. Conserva los registros, cuentas, PIN y la clave si ya estaba activada. Antes de ejecutarla, el administrador conserva el acceso anterior; los operarios verán que falta activar el sistema.

### Clave de administrador solicitada

Después de la migración principal, copiar `migrations/20260915_admin_password.sql` al SQL Editor y sustituir `REEMPLAZAR_CLAVE_EN_SUPABASE` por la clave solicitada, únicamente en Supabase. No guardar la clave en el repositorio. Esta consulta reemplaza la clave aleatoria inicial, cierra las sesiones de administración y limpia su bloqueo por intentos. No cambia los PIN de operarios ni sus asistencias. La clave queda almacenada como hash bcrypt en Supabase.

### Administradores sin bloqueo temporal

En instalaciones existentes, ejecutar `migrations/20260915_admin_without_lockout.sql` en el SQL Editor. Elimina el bloqueo temporal y limpia los intentos de `admin`, conservando su contraseña. Los operarios siguen sujetos al límite de cinco intentos en 15 minutos. Publicar el archivo en GitHub no lo ejecuta en Supabase.

## Uso de operarios

- Al abrir el sitio, `index.html` dirige a `operarios.html`. Debajo del login aparece **Entrar como administrador**, que abre `admin.html`.
- Primera vez: escanear el QR físico, ingresar el DNI registrado y pulsar **Iniciar sesión**. Crear y confirmar un PIN de cuatro dígitos, incluidos PIN que empiezan por cero.
- Después de ingresar: **Escanear QR** o **Mis asistencias**. Cada opción abre otra pestaña: `operarios.html?view=scan` o `operarios.html?view=history`.
- Las pestañas comparten la sesión del operario mediante almacenamiento del mismo sitio, con vencimiento del servidor a las 12 horas. La sesión no se incluye en los enlaces. Al cerrar sesión se revoca el acceso y se ocultan las vistas abiertas en otras pestañas.
- El escáner solicita la cámara al pulsar **Abrir cámara**, con visor y guía de tres pasos. Muestra estados de espera, lectura y confirmación, y permite reintentar si se deniega el permiso. Si no responde en 15 segundos libera la interfaz; cualquier cámara concedida después de cancelar se cierra.
- **Tomar foto del QR** permite usar la captura de imagen del teléfono o seleccionar una foto, según el navegador. La imagen se decodifica localmente y aún requiere confirmar la asistencia. La guía de permisos permite copiar un enlace limpio, sin sesión ni token QR, para abrir el escáner en otro navegador.
- Un permiso bloqueado por el navegador o por la aplicación instalada debe habilitarse en sus ajustes. La página no puede concedérselo a sí misma. Ver [comportamiento de getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- El historial muestra fecha, hora y origen del registro. Permite filtrar por mes, ver todas y actualizar; incluye total mostrado y última llegada.
- Registrar: abrir la cámara integrada o escanear con la cámara del teléfono, y pulsar **Confirmar mi asistencia**. Abrir el enlace por sí solo no registra una llegada.
- La fecha y hora del QR se calculan en el servidor, zona `America/Lima`. No hay una hora de tardanza configurada; la llegada QR comienza sin marca de tarde y el administrador puede editarla.
- Cada cuenta puede registrar una llegada por fecha. Si ya hay una llegada manual, el QR informa que ya está registrada.
- Cada operario solo consulta su historial, incluidas llegadas manuales asociadas a su perfil.

## Administración

- Agregar cuentas con nombre, DNI y tipo; editar perfiles y desactivar cuentas desde el perfil.
- El registro manual admite únicamente nombres del padrón. Los perfiles importados pueden usarse manualmente mientras se completan sus DNI.
- **Consultar PIN** muestra el PIN dentro del perfil. Se guarda cifrado en una tabla privada; no aparece en las listas ni en los eventos de tiempo real. Cada consulta deja una fecha en `pin_access_log`.
- Cambiar el DNI elimina el PIN anterior y revoca las sesiones de esa cuenta. Desactivar una cuenta bloquea sus siguientes solicitudes.
- **Reemplazar QR** invalida el código anterior. Debe imprimirse nuevamente.
- Supabase Realtime avisa de cambios sin incluir datos personales; la página consulta los registros mediante su sesión. Hay consulta de respaldo cada tres segundos. Mientras hay una edición o guardado pendiente no se reemplaza la vista local.
- Si otro dispositivo modificó el registro desde que se leyó, se rechaza el guardado antiguo y se solicita actualizar/repetir el cambio, para no borrar nuevas llegadas QR.

## Alcance y operación

- Requiere internet y HTTPS para registrar y usar la cámara. No muestra éxito si la solicitud no se confirma.
- El QR impreso es reutilizable hasta reemplazarlo. Una fotografía puede reutilizarse fuera de la base; no prueba ubicación física. La primera activación requiere DNI más ese QR, sin validación de identidad adicional.
- Sesiones de 12 horas, PIN verificado con bcrypt, cinco intentos fallidos por cuenta de operario cada 15 minutos. Los administradores verifican contraseña sin bloqueo temporal. El PIN cifrado y la clave de cifrado solo existen en el esquema privado del servidor.
- No se modifica la integración de inventario. La migración protege el acceso a `daily_records` y las cuentas nuevas; no es una revisión completa de permisos del resto del sistema.
- El servidor Python antiguo no gestiona estas cuentas: el navegador llama directamente a las funciones de Supabase. No usar sus endpoints antiguos para escribir asistencias tras la migración, pues no aplican el control de versiones del flujo nuevo.
- No se ha ejecutado esta migración en producción desde la sesión del asistente: no hay navegador ni conector Supabase accesible. La activación y la prueba de cámara/impresión real quedan pendientes hasta ejecutar el SQL.

## Comprobación

`npm ci` y `npm test`. Las pruebas usan PostgreSQL aislado (PGlite con pgcrypto real) y DOM simulado (jsdom); no acceden a datos de producción. Cubren permisos, PIN, activación, duplicados, cambios concurrentes, historial, invalidación del QR, atomicidad y los flujos de las dos páginas.

Las bibliotecas se incluyen localmente, con versiones fijas y licencias en `vendor/`: QRCode.js 1.0.0, jsQR 1.4.0 y supabase-js 2.57.4. El canal usa [Broadcast de Supabase](https://supabase.com/docs/guides/realtime/broadcast); las funciones siguen la configuración de permisos y `search_path` de la [documentación de funciones](https://supabase.com/docs/guides/database/functions).
