# Android · SPLASH SEDE LAS FLORES

Proyecto nativo Kotlin con WebView para el sitio HTTPS existente. Abre directamente `operarios.html`. La página mantiene el acceso con DNI/PIN, los perfiles, el historial, el enlace **Entrar como administrador** y la comunicación con Supabase. Requiere conexión a internet.

## Abrir y compilar en Android Studio

1. En Android Studio, **File > Open** y selecciona esta carpeta `android/` (no la raíz del repositorio).
2. Espera a que termine **Gradle Sync**. Usa el JDK incluido con Android Studio y el SDK Android 36 si se te solicita instalarlo.
3. En el menú **Build > Build Bundle(s) / APK(s) > Build APK(s)**. El APK de prueba queda en `app/build/outputs/apk/debug/app-debug.apk`.
4. Copia el APK al teléfono e instálalo. Android puede solicitar que autorices la instalación desde la app con la que abriste el archivo. El APK debug sirve para pruebas; para distribuir versiones definitivas, genera un APK firmado con una clave privada guardada fuera de Git.

También se puede compilar desde esta carpeta con `gradlew.bat :app:assembleDebug` en Windows o `./gradlew :app:assembleDebug` en otros sistemas.

La URL pública está en `app/build.gradle.kts`: `https://pauluwu18.github.io/sphash-sede-las-flores-app/`. Si cambia el dominio o la ruta, actualiza `SITE_ORIGIN` y `SITE_URL` juntos y recompila.

## Uso y permisos

- La cámara se solicita al tocar **Abrir cámara** en el escáner. Android y la WebView solo conceden captura de video al origen HTTPS del sitio. Las denegaciones permiten reintentar.
- **Escanear QR**, **Mis asistencias** y **Entrar como administrador** permanecen en la misma WebView. La navegación hacia atrás conserva el almacenamiento y la sesión del sitio. Los enlaces a otros sitios abren el navegador del teléfono.
- En administración, **Descargar QR** guarda el PNG en Imágenes/SPLASH (Android 10 o superior). En Android 7 a 9 queda en la carpeta de imágenes privada de la app. **Imprimir** abre la interfaz de impresión de Android; desde ella se puede elegir una impresora o guardar como PDF.
- **Tomar foto del QR** abre el selector de imágenes del teléfono. La cámara en vivo es la opción principal.

## Comprobación en un teléfono

Tras compilar, abre la app en un teléfono Android con internet y verifica inicio de sesión de operario, permiso de cámara, lectura y confirmación del QR, historial, navegación atrás, acceso de administración, descarga e impresión. La lectura de cámara, la impresora y las llamadas a la instancia real de Supabase requieren prueba en el dispositivo; las pruebas automatizadas del repositorio no sustituyen esas comprobaciones.

No guardes contraseñas, claves privadas ni archivos de firma en este proyecto.
