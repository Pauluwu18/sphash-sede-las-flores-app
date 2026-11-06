# SPLASH Administración para Android

Esta es una segunda app Android, con paquete `pe.splash.lasflores.admin`. Abre `admin.html` del sitio HTTPS. Las asistencias QR llegan mediante Firebase Cloud Messaging (FCM), también en segundo plano. Solo una sesión de administrador vigente puede inscribir el dispositivo; después la suscripción dura 30 días desde su última renovación, independientemente de la sesión web. Los operarios no pueden registrar dispositivos para estos avisos.

## Abrir y compilar

1. En Firebase Console crea o usa un proyecto y registra una app Android con paquete exacto `pe.splash.lasflores.admin`. Activa Firebase Cloud Messaging HTTP v1.
2. Copia `firebase.properties.example` a `firebase.properties` en esta carpeta y completa los cuatro valores públicos de Firebase. En `google-services.json`, corresponden a `project_info.project_id`, `project_info.project_number`, el `mobilesdk_app_id` del cliente con este paquete y su `api_key.current_key`. `firebase.properties` está excluido de Git. La cuenta de servicio privada **nunca** va en este archivo.
3. Abre esta carpeta `admin-android/` con **File > Open** en Android Studio. Espera la sincronización de Gradle y usa **Build > Build Bundle(s) / APK(s) > Build APK(s)**. El APK estará en `app/build/outputs/apk/debug/app-debug.apk`.
4. Instala el APK en un teléfono Android con Google Play Services. Entra como administrador y, en Android 13 o superior, acepta el permiso de notificaciones cuando lo solicite la app. La sesión web dura 12 horas; los avisos continúan hasta 30 días aunque venza esa sesión, después de aplicar la migración nueva. Volver a entrar renueva la inscripción. Cerrar sesión desactiva los avisos localmente incluso sin conexión y revoca la inscripción en el servidor cuando responde; cambiar la contraseña también revoca las inscripciones.

La compilación requiere `firebase.properties` para evitar distribuir una APK sin Firebase. Solo CI permite omitirlo con `-PallowUnconfiguredFirebase=true`; ese artefacto **no recibe notificaciones**. En esta copia se recuperaron los cuatro valores públicos desde la APK 1.2 en el archivo local ignorado por Git.

## Activar el envío en Supabase

1. Habilita la extensión `pg_net` en el panel de Supabase.
2. Crea un secreto aleatorio de al menos 32 bytes (por ejemplo, 64 caracteres hexadecimales). Guarda el valor en Supabase Vault con nombre `splash_push_webhook_secret` y el mismo valor en los secretos de Edge Functions como `SPLASH_PUSH_WEBHOOK_SECRET`. Hazlo en los paneles de Supabase; no pegues el valor en el repositorio ni en un chat.
3. Crea los secretos de Edge Functions `FIREBASE_PROJECT_ID` (ID del proyecto Firebase) y `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON completo de una cuenta de servicio con permiso para enviar mediante FCM HTTP v1). No incluyas ese JSON en el APK ni en Git.
4. Ejecuta `migrations/20260916_admin_push.sql` en el SQL Editor del proyecto Supabase `yyhvpbgvmnhonyqzevfr`, después de la migración de asistencia existente.
5. Despliega la función `supabase/functions/splash-admin-push` con `verify_jwt = false` como indica `supabase/config.toml`. El secreto compartido del paso 2 autentica cada llamada del disparador. Con Supabase CLI: `supabase functions deploy splash-admin-push --project-ref yyhvpbgvmnhonyqzevfr --no-verify-jwt`.

Para actualizar una instalación existente, conserva los secretos actuales, ejecuta **`migrations/20261003_admin_push_lifetime.sql`**, publica los archivos web modificados y despliega la Edge Function actualizada. Instala la APK 1.3 y vuelve a iniciar sesión en cada dispositivo. La migración es repetible y no modifica asistencias, perfiles ni contraseñas. Si la inscripción ya fue eliminada por el vencimiento anterior, el inicio de sesión es necesario para recuperarla.

La APK acepta los avisos originales y los mensajes de datos `attendance_voice` de la versión 1.2. La Edge Function envía estos últimos con identificador de evento, nombre y hora. La notificación visible mantiene el texto genérico; la voz lee el nombre y hora y respeta silencio y No molestar. Los eventos repetidos se omiten y los avisos caducan en FCM a los cinco minutos.

## Mantener mi sesión (versión 1.4)

La casilla opcional **Mantener mi sesión** del inicio de sesión guarda únicamente el token de acceso en este dispositivo, nunca la contraseña. Al reabrir la APK se valida el token en Supabase antes de mostrar administración. Marcada, una sesión nueva dura 30 días; sin marcar, dura 12 horas y se guarda solo en la sesión de la ventana. Cerrar sesión borra ambas formas de almacenamiento y revoca el token en el servidor cuando hay conexión. Si vence o se revoca el token, se solicita iniciar sesión otra vez; un fallo de conexión conserva el token sin abrir el panel.

Aplicar también `migrations/20261003_admin_remember_session.sql` después de las migraciones anteriores y publicar los archivos web actualizados. La actualización no amplía sesiones ya emitidas: vuelve a entrar y marca la casilla. Los operarios mantienen su duración actual.

## Descarga del registro diario

En administración, usa **Descargar Excel del día** o abre una fecha del historial y pulsa **Descargar Excel de esta fecha**. Se consultan de nuevo el registro guardado y el padrón en Supabase usando la sesión del administrador. Los cambios manuales se deben guardar primero. La APK abre el selector de Android para elegir dónde guardar el `.xlsx`; en navegador se descarga directamente.

El archivo contiene una hoja con el título verde, fecha, EMPLEADO, N° OPERARIO, ESTADO y HORA ENTRADA. El número corresponde al orden almacenado de las llegadas del día. Puntual aparece en verde y Tardanza en amarillo; al final se añaden las personas activas del padrón actual que no figuran en ese registro, con `—`, sin número ni hora. Los nombres históricos y las horas guardadas se conservan; una hora ausente queda vacía. Supabase no guarda una copia histórica del padrón, por lo que las filas sin llegada se basan en el padrón actual.

El disparador escucha solo nuevas asistencias con origen `QR`; no envía avisos por accesos al historial ni por cambios manuales. La notificación no incluye nombre, DNI ni PIN en la pantalla bloqueada. Al cerrar sesión, el servidor revoca la sesión y elimina la inscripción del dispositivo. No se cambia ninguna contraseña.

## Prueba en teléfono físico

### Lectura en voz alta (versión 1.2)

La APK administrativa lee el nombre real y la hora de Lima: «Adriano se registró
a las 7 horas y 30 minutos». Actualizar la APK, abrirla e iniciar sesión de
administrador para registrar la capacidad de voz del teléfono. Los operarios
no reciben estos avisos. El texto visible sigue siendo genérico; el nombre se
envía al dispositivo administrativo para la lectura, incluso con pantalla bloqueada.

Requiere un motor de texto a voz con español instalado en Android. Respeta el
volumen de notificaciones, el canal Asistencias QR, silencio y No molestar.
Si el motor no admite español o Android impide iniciar la reproducción, permanece
el aviso visual. Un servicio breve mantiene la lectura en segundo plano y muestra
«Detener lectura»; se cierra al terminar o, como máximo, a los 30 segundos.
Las llegadas se leen en cola y se descartan repeticiones recientes. Los mensajes
de voz caducan a los 60 segundos para evitar leer asistencias antiguas al reconectar.

Aplicar `migrations/20260928_admin_voice.sql` después de la migración push y
publicar la Edge Function actualizada. La nueva APK registra el teléfono con
`splash_push_registration_voice`; las APK anteriores conservan el aviso FCM
habitual, sin TTS. El nombre y los tokens solo se consultan mediante la función
de servidor con rol de servicio. Las sesiones de administrador siguen venciendo
a las 12 horas.

Comprobado: compilación APK y pruebas automatizadas de permisos, migración
repetible y mensajes FCM de versiones antiguas/nuevas. Pendiente de dispositivo
físico: voz española, pantalla bloqueada, varias llegadas, silencio y motor TTS
ausente. La migración y el envío se activaron en Supabase durante esta actualización.

### Sonido de los avisos (versión 1.1)

El envío FCM solicita `default_sound: true`; la APK define el tono predeterminado
de notificación al crear el canal `attendance` y lo solicita explícitamente en
Android 7 cuando está abierta. En Android 8 o superior, el sistema conserva los
ajustes de sonido del canal existente al actualizar la app. Si está silenciado,
la APK ofrece abrir sus ajustes después del acceso de administrador.

Para activarlo en una instalación existente: Ajustes de Android → Aplicaciones →
SPLASH Administración → Notificaciones → Asistencias QR → Sonido. Elegir un tono
y permitir alertas. Comprobar también el volumen de notificaciones y No molestar.
No se borran ni recrean canales para sobrescribir las preferencias del teléfono.

Referencias: [canales de Android](https://developer.android.com/develop/ui/compose/notifications/channels)
y [sonido en FCM HTTP v1](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages).

Validación local del cambio: `:app:assembleDebug` genera la APK. `:app:lintDebug`
detecta el error preexistente `GestureBackNavigation` en `onBackPressed` y cinco
advertencias; queda pendiente probar sonido con un teléfono físico, tanto con
la APK abierta como cerrada.

Instala la app administradora en un teléfono con Google Play Services, inicia sesión y concede las notificaciones. En otro teléfono, registra una asistencia QR real de un operario. Comprueba que llega **Nueva asistencia QR** con la app administradora abierta, en segundo plano y con pantalla bloqueada. Abre el aviso y confirma el registro en administración. Después cierra sesión y repite: no debe llegar otro aviso a ese dispositivo. Prueba también denegar el permiso de notificaciones y una sesión vencida. El emulador sin Google Play Services no sirve para validar entrega FCM real.
