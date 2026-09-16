package pe.splash.lasflores.admin

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class AdminMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        // FCM displays notification payloads itself while the app is in the background.
        // This path displays the same alert while the admin app is open.
        val notification = message.notification ?: return
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "attendance")
                      else Notification.Builder(this)
        val alert = builder
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFF008C95.toInt())
            .setContentTitle(notification.title ?: "Nueva asistencia QR")
            .setContentText(notification.body ?: "Abre administración para ver el registro.")
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build()
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(message.messageId?.hashCode() ?: System.currentTimeMillis().toInt(), alert)
    }

    override fun onNewToken(token: String) {
        // Registration is refreshed when the administrator next opens the app.
        getSharedPreferences("push", MODE_PRIVATE).edit().putBoolean("needs_registration", true).apply()
    }
}
