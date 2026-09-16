package pe.splash.lasflores

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
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
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import java.io.File

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var cameraRequest: PermissionRequest? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val cameraPermissionCode = 1001
    private val fileChooserCode = 1002
    private val mainHandler = Handler(Looper.getMainLooper())
    private val sitePrefix = Uri.parse(BuildConfig.SITE_URL).path!!.trimEnd('/') + "/"

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
            mediaPlaybackRequiresUserGesture = true
            allowFileAccess = false
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        webView.addJavascriptInterface(SiteActions(), "SplashAndroid")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                if (isSitePage(request.url)) return false
                openExternal(request.url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                denyCameraRequest()
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!isSitePage(Uri.parse(url))) return
                // The existing admin page uses window.print() and a PNG data URL download.
                // Intercept only those two actions; the web app and Supabase calls stay intact.
                view.evaluateJavascript(
                    """(function(){
                      if(window.__splashAndroidReady)return;
                      window.__splashAndroidReady=true;
                      window.print=function(){SplashAndroid.printPage()};
                      document.addEventListener('click',function(event){
                        var link=event.target.closest('a[download]');
                        if(!link || link.download!=='QR-SPLASH-LAS-FLORES.png' ||
                           !link.href.startsWith('data:image/png;base64,'))return;
                        event.preventDefault();
                        SplashAndroid.saveQrImage(link.href);
                      },true);
                    })();""".trimIndent(), null
                )
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) toast("No se pudo cargar el sitio. Comprueba tu conexión.")
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { handleCameraRequest(request) }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                runOnUiThread { if (cameraRequest === request) cameraRequest = null }
            }

            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: WebChromeClient.FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = filePathCallback
                return try {
                    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "image/*"
                    }
                    startActivityForResult(Intent.createChooser(intent, "Seleccionar foto del QR"), fileChooserCode)
                    true
                } catch (_: Exception) {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = null
                    false
                }
            }
        }
        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            if (!isSitePage(Uri.parse(webView.url ?: ""))) return@setDownloadListener
            if (url.startsWith("data:image/png;base64,")) {
                saveQr(url)
            } else if (Uri.parse(url).scheme == "https") {
                val request = DownloadManager.Request(Uri.parse(url))
                request.setMimeType(mimeType)
                request.setDestinationInExternalPublicDir(
                    Environment.DIRECTORY_DOWNLOADS,
                    URLUtil.guessFileName(url, contentDisposition, mimeType)
                )
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                toast("Descarga iniciada")
            }
        }
        if (savedInstanceState == null) webView.loadUrl(BuildConfig.SITE_URL + "operarios.html")
        else webView.restoreState(savedInstanceState)
    }

    private fun isSitePage(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == Uri.parse(BuildConfig.SITE_ORIGIN).host &&
            (uri.path == sitePrefix.dropLast(1) || (uri.path ?: "").startsWith(sitePrefix))

    private fun openExternal(uri: Uri) {
        if (uri.scheme != "https" && uri.scheme != "http") return
        try { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        catch (_: Exception) { toast("No hay navegador para abrir este enlace") }
    }

    private fun handleCameraRequest(request: PermissionRequest) {
        denyCameraRequest()
        if (request.origin.toString().trimEnd('/') != BuildConfig.SITE_ORIGIN ||
            !isSitePage(Uri.parse(webView.url ?: "")) ||
            !request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        ) {
            request.deny()
            return
        }
        cameraRequest = request
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            grantCameraRequest()
        } else {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), cameraPermissionCode)
        }
    }

    private fun grantCameraRequest() {
        val request = cameraRequest ?: return
        cameraRequest = null
        if (request.origin.toString().trimEnd('/') == BuildConfig.SITE_ORIGIN &&
            isSitePage(Uri.parse(webView.url ?: "")) &&
            checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        ) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        else request.deny()
    }

    private fun denyCameraRequest() {
        cameraRequest?.deny()
        cameraRequest = null
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != cameraPermissionCode) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) grantCameraRequest()
        else {
            denyCameraRequest()
            toast("Permiso de cámara denegado. Puedes intentarlo otra vez.")
        }
    }

    @Deprecated("Activity result API is used here without additional dependencies")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == fileChooserCode) {
            fileCallback?.onReceiveValue(if (resultCode == RESULT_OK) data?.data?.let { arrayOf(it) } else null)
            fileCallback = null
        }
    }

    private inner class SiteActions {
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
            mainHandler.post {
                if (isSitePage(Uri.parse(webView.url ?: ""))) saveQr(dataUrl)
            }
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

    override fun onPause() {
        denyCameraRequest()
        if (::webView.isInitialized) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('splash-native-pause'))", null)
            webView.onPause()
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        denyCameraRequest()
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        webView.destroy()
        super.onDestroy()
    }
}
