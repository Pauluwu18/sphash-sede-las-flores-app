# SPLASH Las Flores

Registro de cambios: [CAMBIOS_SPLASH_2026-10-04.txt](CAMBIOS_SPLASH_2026-10-04.txt).
Por indicación del usuario, publicar los cambios del proyecto en GitHub tras verificarlos.

Personas registradas permite eliminar desde la lista o el perfil, con confirmación.
Se revoca el acceso y se oculta la persona, conservando sus asistencias históricas.
Aplicar `migrations/20261004_delete_person.sql` después de las migraciones anteriores.

## Administración 1.4

- Excel diario con empleados, orden de llegada, estado y hora de Lima, descargable desde la web y la APK.
- Mantener sesión iniciada: 30 días si se marca la casilla; 12 horas sin marcarla. Se guarda el token, nunca la contraseña. Cerrar sesión revoca el acceso y los avisos del dispositivo.
- Los avisos duran 30 días desde el último registro autenticado del dispositivo, aunque se limpie la sesión web vencida.
- Configurar voz femenina permite escuchar una voz española instalada y guardarla después de confirmar que es femenina. Selecciona la voz real, sin alterar el tono. Android no ofrece un campo universal de género: sin una selección válida ni metadatos explícitos, se mantiene el aviso visual sin leer con una voz desconocida.
- Se respetan silencio y No molestar. La lectura usa nombre real y hora de Lima; los mensajes de voz vencen a los 60 segundos. Se conserva compatibilidad con APK anteriores.
- No se modifica la APK de operarios ni las contraseñas.

### Migraciones

Aplicar después de las migraciones existentes, en este orden:
1. migrations/20260928_admin_voice.sql
2. migrations/20261003_admin_push_lifetime.sql
3. migrations/20261003_admin_remember_session.sql

Las dos últimas son repetibles y no amplían sesiones ya emitidas. splash-admin-push debe conservar voice_tokens, mensajes de datos para voz y notificaciones tradicionales para APK anteriores.

### Verificación

npm test verifica Excel, sesiones, interfaz, permisos SQL y compatibilidad FCM. En admin-android ejecutar gradlew.bat :app:assembleDebug :app:lintDebug con Java y SDK Android configurados.

La compilación de distribución requiere firebase.properties o google-services.json local. No incluir credenciales privadas en Git. La opción -PallowUnconfiguredFirebase=true se reserva para CI: ese artefacto no recibe avisos ni reemplaza la APK configurada entregada localmente.

En el teléfono: instalar la APK administrativa, iniciar sesión, permitir notificaciones y elegir/escuchar una voz femenina. Comprobar un registro real con app abierta, en segundo plano y pantalla bloqueada; repetir con silencio y No molestar. Las pruebas automatizadas no sustituyen esta comprobación física.
