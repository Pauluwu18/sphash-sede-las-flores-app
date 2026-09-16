package pe.splash.lasflores.admin

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Notification
import android.content.Context
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

class AdminApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(
                "attendance", "Asistencias QR", NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Avisos de nuevas asistencias de operarios"
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
        if (BuildConfig.FIREBASE_PROJECT_ID.isNotBlank() &&
            BuildConfig.FIREBASE_SENDER_ID.isNotBlank() &&
            BuildConfig.FIREBASE_APP_ID.isNotBlank() &&
            BuildConfig.FIREBASE_API_KEY.isNotBlank()
        ) {
            val options = FirebaseOptions.Builder()
                .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .build()
            FirebaseApp.initializeApp(this, options)
        }
    }
}
