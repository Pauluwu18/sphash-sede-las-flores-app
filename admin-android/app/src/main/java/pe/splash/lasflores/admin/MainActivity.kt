package pe.splash.lasflores.admin

import android.Manifest
import android.app.Activity
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
    private var registering = false
    private var registrationNonce: String? = null
    private var notificationPermissionRequested = false
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
        if (!resumed || registeredForPage || registering || !isSitePage(Uri.parse(webView.url ?: ""))) return
        if (FirebaseApp.getApps(this).isEmpty()) return
        webView.evaluateJavascript("!!sessionStorage.getItem('splash-admin-session')") { hasSession ->
            if (!resumed || hasSession != "true" || registeredForPage || registering) return@evaluateJavascript
            if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                if (!notificationPermissionRequested) {
                    notificationPermissionRequested = true
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), notificationPermissionCode)
                }
                return@evaluateJavascript
            }
            registering = true
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (!resumed || !task.isSuccessful || task.result.isNullOrBlank()) {
                    registering = false
                    return@addOnCompleteListener
                }
                registerToken(task.result)
            }
        }
    }

    private fun registerToken(fcmToken: String) {
        val nonce = UUID.randomUUID().toString()
        registrationNonce = nonce
        val tokenLiteral = JSONObject.quote(fcmToken)
        val nonceLiteral = JSONObject.quote(nonce)
        webView.evaluateJavascript(
            """(async function(){
              let success=false;
              try {
                const session=sessionStorage.getItem('splash-admin-session');
                if(session && window.Splash){
                  const response=await fetch(Splash.url+'/rest/v1/rpc/splash_push_registration',{
                    method:'POST',
                    headers:{apikey:Splash.key,Authorization:'Bearer '+Splash.key,'Content-Type':'application/json'},
                    body:JSON.stringify({action:'register',session_token:session,device_token:$tokenLiteral})
                  });
                  const result=await response.json();
                  success=response.ok && result.ok===true;
                }
              } catch (_) {}
              SplashAdminNative.registrationResult($nonceLiteral,success);
            })();""".trimIndent(), null
        )
    }

    private inner class SiteActions {
        @JavascriptInterface fun registrationResult(nonce: String, success: Boolean) {
            mainHandler.post {
                if (nonce != registrationNonce || !isSitePage(Uri.parse(webView.url ?: ""))) return@post
                registrationNonce = null
                registering = false
                registeredForPage = success
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

    @Deprecated("Uses WebView navigation history")
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
