package pe.splash.lasflores.admin

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.provider.Settings
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.io.File
import java.util.UUID

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val mainHandler = Handler(Looper.getMainLooper())
    private val sitePrefix = Uri.parse(BuildConfig.SITE_URL).path!!.trimEnd('/') + "/"
    private var resumed = false
    private var registeredForPage = false
    private var registeredSession: String? = null
    private var lastRegistration = 0L
    private var pendingExcel: ByteArray? = null
    private val excelRequestCode = 11
    private val excelMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    private var registering = false
    private var registrationNonce: String? = null
    private var notificationPermissionRequested = false
    private var soundSettingsExplained = false
    private val notificationPermissionCode = 10
    private val poll = object : Runnable {
        override fun run() {
            if (!resumed) return
            checkAdminSession()
            mainHandler.postDelayed(this, 2500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(16, 42, 67)
        window.navigationBarColor = Color.rgb(16, 42, 67)
        webView = WebView(this)
        setContentView(webView, FrameLayout.LayoutParams(-1, -1))
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT) {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        webView.addJavascriptInterface(SiteActions(), "SplashAdminNative")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                if (isSitePage(request.url)) return false
                if (request.url.scheme == "https" || request.url.scheme == "http") {
                    try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    catch (_: Exception) { toast("No hay navegador para abrir este enlace") }
                }
                return true
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                registeredForPage = false
                registering = false
                registrationNonce = null
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!isSitePage(Uri.parse(url))) return
                view.evaluateJavascript(
                    """(function(){
                      if(window.__splashAdminNativeReady)return;
                      window.__splashAdminNativeReady=true;
                      window.print=function(){SplashAdminNative.printPage()};
                      document.addEventListener('click',function(event){
                        var link=event.target.closest('a[download]');
                        if(!link || link.download!=='QR-SPLASH-LAS-FLORES.png' ||
                           !link.href.startsWith('data:image/png;base64,'))return;
                        event.preventDefault();
                        SplashAdminNative.saveQrImage(link.href);
                      },true);
                    })();""".trimIndent(), null
                )
                checkAdminSession()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) toast("No se pudo cargar el sitio. Comprueba tu conexión.")
            }
        }
        webView.setDownloadListener { url, _, _, _, _ ->
            if (isSitePage(Uri.parse(webView.url ?: "")) && url.startsWith("data:image/png;base64,")) saveQr(url)
        }
        if (savedInstanceState == null) webView.loadUrl(BuildConfig.SITE_URL + "admin.html")
        else webView.restoreState(savedInstanceState)
    }

    private fun isSitePage(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == Uri.parse(BuildConfig.SITE_ORIGIN).host &&
            (uri.path == sitePrefix.dropLast(1) || (uri.path ?: "").startsWith(sitePrefix))

    private fun checkAdminSession() {
        if (!resumed || registering || !isSitePage(Uri.parse(webView.url ?: ""))) return
        if (!getSharedPreferences("push", MODE_PRIVATE).getBoolean("notifications_enabled", true)) return
        if (FirebaseApp.getApps(this).isEmpty()) {
            pushStatus("Esta APK no tiene configurado Firebase. Instala la versión configurada.")
            return
        }
        webView.evaluateJavascript("window.Splash?.adminSession ? Splash.adminSession() : (sessionStorage.getItem('splash-admin-session') || '')") { session ->
            if (!resumed || registering || !isSitePage(Uri.parse(webView.url ?: ""))) return@evaluateJavascript
            if (session == "\"\"" || session == "null") {
                registeredForPage = false
                registeredSession = null
                return@evaluateJavascript
            }
            val needsRegistration = getSharedPreferences("push", MODE_PRIVATE).getBoolean("needs_registration", false)
            if (registeredForPage && registeredSession == session && !needsRegistration &&
                System.currentTimeMillis() - lastRegistration < 60_000) return@evaluateJavascript
            if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                pushStatus("Activa el permiso de notificaciones de Android para recibir las asistencias.")
                if (!notificationPermissionRequested) {
                    notificationPermissionRequested = true
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), notificationPermissionCode)
                }
                return@evaluateJavascript
            }
            explainSilentChannel()
            if (!(getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).areNotificationsEnabled()) {
                pushStatus("Las notificaciones están desactivadas en los ajustes de Android.")
                return@evaluateJavascript
            }
            registering = true
            registeredSession = session
            val attempt = UUID.randomUUID().toString()
            registrationNonce = attempt
            // Recover even if the WebView request never completes (offline / navigation).
            mainHandler.postDelayed({
                if (registering && registrationNonce == attempt) {
                    registering = false
                    registrationNonce = null
                    pushStatus("No se pudo confirmar el registro de avisos. Reintentando…")
                }
            }, 20_000)
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (registrationNonce != attempt) return@addOnCompleteListener
                if (!resumed || !task.isSuccessful || task.result.isNullOrBlank()) {
                    registering = false
                    pushStatus("No se pudo conectar con Firebase. Comprueba tu conexión y Google Play Services.")
                    return@addOnCompleteListener
                }
                if (isSitePage(Uri.parse(webView.url ?: ""))) registerToken(task.result, attempt, session)
                else registering = false
            }
        }
    }

    private fun registerToken(fcmToken: String, nonce: String, sessionLiteral: String) {
        val tokenLiteral = JSONObject.quote(fcmToken)
        val nonceLiteral = JSONObject.quote(nonce)
        webView.evaluateJavascript(
            """(async function(){
              let success=false, error='No se pudo registrar este dispositivo. Revisa la conexión y la configuración de avisos.';
              try {
                const session=window.Splash?.adminSession ? Splash.adminSession() : sessionStorage.getItem('splash-admin-session');
                if(session && session===$sessionLiteral && window.Splash){
                  const response=await fetch(Splash.url+'/rest/v1/rpc/splash_push_registration_voice',{
                    method:'POST',
                    headers:{apikey:Splash.key,Authorization:'Bearer '+Splash.key,'Content-Type':'application/json'},
                    body:JSON.stringify({action:'register',session_token:session,device_token:$tokenLiteral})
                  });
                  const result=await response.json();
                  success=response.ok && result.ok===true;
                  if(result.error) error=result.error;
                }
              } catch (_) {}
              SplashAdminNative.registrationResult($nonceLiteral,success,error);
            })();""".trimIndent(), null
        )
    }

    private fun explainSilentChannel() {
        if (Build.VERSION.SDK_INT < 26 || soundSettingsExplained) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = manager.getNotificationChannel("attendance") ?: return
        if (manager.areNotificationsEnabled() && channel.importance >= NotificationManager.IMPORTANCE_DEFAULT && channel.sound != null) return
        soundSettingsExplained = true
        AlertDialog.Builder(this).setTitle("Activa el sonido de las asistencias")
            .setMessage("Android tiene estos avisos bloqueados o en silencio. En Asistencias QR, permite las notificaciones y elige un sonido.")
            .setPositiveButton("Abrir ajustes") { _, _ ->
                startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                    putExtra(Settings.EXTRA_CHANNEL_ID, "attendance")
                })
            }.setNegativeButton("Ahora no", null).show()
    }

    private inner class SiteActions {
        @JavascriptInterface fun configureVoice() {
            mainHandler.post {
                if (isSitePage(Uri.parse(webView.url ?: "")))
                    startActivity(Intent(this@MainActivity, VoiceSettingsActivity::class.java))
            }
        }
        @JavascriptInterface fun enableNotifications() {
            mainHandler.post {
                if (!isSitePage(Uri.parse(webView.url ?: ""))) return@post
                getSharedPreferences("push", MODE_PRIVATE).edit().putBoolean("notifications_enabled", true).apply()
                registeredForPage = false
                checkAdminSession()
            }
        }
        @JavascriptInterface fun registrationResult(nonce: String, success: Boolean, error: String) {
            mainHandler.post {
                if (nonce != registrationNonce || !isSitePage(Uri.parse(webView.url ?: ""))) return@post
                registrationNonce = null
                registering = false
                registeredForPage = success
                if (success) {
                    lastRegistration = System.currentTimeMillis()
                    getSharedPreferences("push", MODE_PRIVATE).edit()
                        .putBoolean("needs_registration", false).putBoolean("notifications_enabled", true).apply()
                }
                val voiceSaved = getSharedPreferences("attendance_voice", MODE_PRIVATE).contains("voice_name")
                pushStatus(if (!success) error else if (voiceSaved) "Avisos de asistencia activos." else
                    "Avisos activos. En el menú, abre Configurar voz femenina para elegir y escuchar la voz.")
            }
        }

        @JavascriptInterface fun disableNotifications() {
            mainHandler.post {
                if (!isSitePage(Uri.parse(webView.url ?: ""))) return@post
                registrationNonce = null
                registering = false
                registeredForPage = false
                registeredSession = null
                getSharedPreferences("push", MODE_PRIVATE).edit().putBoolean("notifications_enabled", false).apply()
                stopService(Intent(this@MainActivity, AttendanceVoiceService::class.java))
                (getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).cancelAll()
            }
        }

        @JavascriptInterface fun saveExcel(filename: String, dataUrl: String) {
            mainHandler.post {
                if (!isSitePage(Uri.parse(webView.url ?: ""))) return@post
                if (!filename.matches(Regex("Registro-Diario-\\d{4}-\\d{2}-\\d{2}\\.xlsx")) ||
                    !dataUrl.startsWith("data:$excelMime;base64,") || dataUrl.length > 16_000_000) return@post
                if (pendingExcel != null) { toast("Termina de guardar el archivo anterior."); return@post }
                try {
                    val bytes = Base64.decode(dataUrl.substringAfter(','), Base64.DEFAULT)
                    if (bytes.size < 4 || bytes[0] != 80.toByte() || bytes[1] != 75.toByte()) return@post
                    pendingExcel = bytes
                    startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = excelMime
                        putExtra(Intent.EXTRA_TITLE, filename)
                    }, excelRequestCode)
                } catch (_: Exception) { pendingExcel = null; toast("No se pudo preparar la descarga del Excel.") }
            }
        }

        @JavascriptInterface fun printPage() {
            mainHandler.post {
                if (!isSitePage(Uri.parse(webView.url ?: ""))) return@post
                (getSystemService(Context.PRINT_SERVICE) as PrintManager).print(
                    "QR SPLASH SEDE LAS FLORES",
                    webView.createPrintDocumentAdapter("QR SPLASH SEDE LAS FLORES"),
                    PrintAttributes.Builder().setColorMode(PrintAttributes.COLOR_MODE_COLOR).build()
                )
            }
        }

        @JavascriptInterface fun saveQrImage(dataUrl: String) {
            mainHandler.post { if (isSitePage(Uri.parse(webView.url ?: ""))) saveQr(dataUrl) }
        }
    }

    private fun saveQr(dataUrl: String) {
        if (!dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 8_000_000) return
        try {
            val bytes = Base64.decode(dataUrl.substringAfter(','), Base64.DEFAULT)
            if (bytes.size < 8 || !bytes.copyOfRange(0, 8).contentEquals(
                    byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)
                )) return
            val name = "QR-SPLASH-LAS-FLORES.png"
            if (Build.VERSION.SDK_INT >= 29) {
                val values = android.content.ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, name)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/SPLASH")
                }
                val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("No se pudo crear la imagen")
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw IllegalStateException("No se pudo guardar la imagen")
            } else {
                val dir = File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "SPLASH")
                dir.mkdirs()
                File(dir, name).writeBytes(bytes)
            }
            toast("QR guardado en Imágenes/SPLASH")
        } catch (_: Exception) { toast("No se pudo guardar la imagen del QR") }
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    private fun pushStatus(message: String) {
        if (!isSitePage(Uri.parse(webView.url ?: ""))) return
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('splash-push-status',{detail:${JSONObject.quote(message)}}))", null)
    }

    @Deprecated("Uses the platform document picker")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != excelRequestCode) return
        val bytes = pendingExcel
        pendingExcel = null
        if (resultCode != RESULT_OK || data?.data == null || bytes == null) return
        try {
            contentResolver.openOutputStream(data.data!!)?.use { it.write(bytes) }
                ?: throw IllegalStateException("No se pudo abrir el archivo")
            toast("Excel guardado correctamente.")
        } catch (_: Exception) { toast("No se pudo guardar el Excel. Vuelve a descargarlo.") }
    }

    // Android 13+ uses the callback above; this handles older devices only.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Deprecated("Legacy back navigation for Android 12 and below")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != notificationPermissionCode) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) checkAdminSession()
        else toast("Activa las notificaciones de esta app para recibir las asistencias.")
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (::webView.isInitialized) webView.onResume()
        registeredForPage = false
        mainHandler.removeCallbacks(poll)
        mainHandler.post(poll)
    }

    override fun onPause() {
        resumed = false
        mainHandler.removeCallbacks(poll)
        if (::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(poll)
        webView.destroy()
        super.onDestroy()
    }
}
