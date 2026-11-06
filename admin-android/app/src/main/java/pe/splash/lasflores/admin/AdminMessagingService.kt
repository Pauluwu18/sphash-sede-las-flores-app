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
        if (!getSharedPreferences("push", MODE_PRIVATE).getBoolean("notifications_enabled", true)) return
        val notification = message.notification
        val voice = message.data["kind"] == "attendance_voice"
        if (notification == null && !voice) return
        val eventId = message.data["event_id"] ?: message.messageId ?: return
        if (voice) {
            val preferences = getSharedPreferences("spoken_events", MODE_PRIVATE)
            val seen = preferences.getString("ids", "")!!.split("\n").filter { it.isNotEmpty() }
            if (eventId in seen) return
            preferences.edit().putString("ids", (seen.takeLast(127) + eventId).joinToString("\n")).apply()
        }
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
        // Android 8+ uses the user's channel settings. Older versions need
        // an explicit sound on each notification, including foreground alerts.
        if (Build.VERSION.SDK_INT < 26) builder.setDefaults(Notification.DEFAULT_SOUND)
        val alert = builder
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFF008C95.toInt())
            .setContentTitle(notification?.title ?: "Nueva asistencia QR")
            .setContentText(notification?.body ?: "Abre administración para ver el registro.")
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build()
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(eventId.hashCode(), alert)
        val name = message.data["name"]?.trim()?.take(160)
        val time = message.data["time"]
        if (voice && !name.isNullOrBlank() && time != null &&
            Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$").matches(time) &&
            (message.sentTime == 0L || System.currentTimeMillis() - message.sentTime < 60_000) &&
            AttendanceVoiceService.canSpeak(this)
        ) {
            val parts = time.split(":").map { it.toInt() }
            val text = "$name se registró a las ${parts[0]} horas y ${parts[1]} minutos."
            val intent = Intent(this, AttendanceVoiceService::class.java).putExtra("speech", text)
            try {
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent)
                else startService(intent)
            } catch (_: RuntimeException) {
                // Android may downgrade FCM priority and deny background audio.
                // The visible attendance notification has already been delivered.
            }
        }
    }

    override fun onNewToken(token: String) {
        // Registration is refreshed when the administrator next opens the app.
        getSharedPreferences("push", MODE_PRIVATE).edit().putBoolean("needs_registration", true).apply()
    }
}
