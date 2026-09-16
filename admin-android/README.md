# SPLASH Administración para Android

Esta es una segunda app Android, con paquete `pe.splash.lasflores.admin`. Abre `admin.html` del sitio HTTPS. Las asistencias QR llegan como notificaciones de Android mediante Firebase Cloud Messaging (FCM), incluso si la app está en segundo plano, siempre que el dispositivo esté registrado con una sesión de administrador vigente. Los operarios no pueden registrar dispositivos para estos avisos.

## Abrir y compilar

1. En Firebase Console crea o usa un proyecto y registra una app Android con paquete exacto `pe.splash.lasflores.admin`. Activa Firebase Cloud Messaging HTTP v1.
2. Copia `firebase.properties.example` a `firebase.properties` en esta carpeta y completa los cuatro valores públicos de Firebase. En `google-services.json`, corresponden a `project_info.project_id`, `project_info.project_number`, el `mobilesdk_app_id` del cliente con este paquete y su `api_key.current_key`. `firebase.properties` está excluido de Git. La cuenta de servicio privada **nunca** va en este archivo.
3. Abre esta carpeta `admin-android/` con **File > Open** en Android Studio. Espera la sincronización de Gradle y usa **Build > Build Bundle(s) / APK(s) > Build APK(s)**. El APK estará en `app/build/outputs/apk/debug/app-debug.apk`.
4. Instala el APK en un teléfono Android con Google Play Services. Entra como administrador y, en Android 13 o superior, acepta el permiso de notificaciones cuando lo solicite la app. La sesión web dura 12 horas; al vencer, el administrador debe volver a entrar para que el dispositivo reciba nuevos avisos.

El proyecto compila sin `firebase.properties` para poder revisar la app, pero **no recibirá notificaciones** hasta configurarlo. El APK de CI también se genera sin esos valores y solo verifica la compilación.

## Activar el envío en Supabase

1. Habilita la extensión `pg_net` en el panel de Supabase.
2. Crea un secreto aleatorio de al menos 32 bytes (por ejemplo, 64 caracteres hexadecimales). Guarda el valor en Supabase Vault con nombre `splash_push_webhook_secret` y el mismo valor en los secretos de Edge Functions como `SPLASH_PUSH_WEBHOOK_SECRET`. Hazlo en los paneles de Supabase; no pegues el valor en el repositorio ni en un chat.
3. Crea los secretos de Edge Functions `FIREBASE_PROJECT_ID` (ID del proyecto Firebase) y `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON completo de una cuenta de servicio con permiso para enviar mediante FCM HTTP v1). No incluyas ese JSON en el APK ni en Git.
4. Ejecuta `migrations/20260916_admin_push.sql` en el SQL Editor del proyecto Supabase `yyhvpbgvmnhonyqzevfr`, después de la migración de asistencia existente.
5. Despliega la función `supabase/functions/splash-admin-push` con `verify_jwt = false` como indica `supabase/config.toml`. El secreto compartido del paso 2 autentica cada llamada del disparador. Con Supabase CLI: `supabase functions deploy splash-admin-push --project-ref yyhvpbgvmnhonyqzevfr --no-verify-jwt`.

El disparador escucha solo nuevas asistencias con origen `QR`; no envía avisos por accesos al historial ni por cambios manuales. La notificación no incluye nombre, DNI ni PIN en la pantalla bloqueada. Al cerrar sesión, el servidor revoca la sesión y elimina la inscripción del dispositivo. No se cambia ninguna contraseña.

## Prueba en teléfono físico

Instala la app administradora en un teléfono con Google Play Services, inicia sesión y concede las notificaciones. En otro teléfono, registra una asistencia QR real de un operario. Comprueba que llega **Nueva asistencia QR** con la app administradora abierta, en segundo plano y con pantalla bloqueada. Abre el aviso y confirma el registro en administración. Después cierra sesión y repite: no debe llegar otro aviso a ese dispositivo. Prueba también denegar el permiso de notificaciones y una sesión vencida. El emulador sin Google Play Services no sirve para validar entrega FCM real.
