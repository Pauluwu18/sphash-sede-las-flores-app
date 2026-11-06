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
        // Support both the original notification payload and 1.2's data + voice payload.
        val notification = message.notification
        val voice = message.data["kind"] == "attendance_voice"
        if (notification == null && !voice) return
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val eventId = message.data["event_id"] ?: message.messageId
        if (eventId != null) {
            val preferences = getSharedPreferences("spoken_events", MODE_PRIVATE)
            val previous = preferences.getString("ids", "")!!.split('\n').filter { it.isNotEmpty() }
            if (eventId in previous) return
            preferences.edit().putString("ids", (previous + eventId).takeLast(64).joinToString("\n")).apply()
        }
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
            .setContentTitle(notification?.title ?: "Nueva asistencia QR")
            .setContentText(notification?.body ?: "Abre administración para ver el registro.")
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build()
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(message.messageId?.hashCode() ?: System.currentTimeMillis().toInt(), alert)
        val name = message.data["name"]?.take(100)
        val time = message.data["time"]
        if (voice && !name.isNullOrBlank() && time != null &&
            time.matches(Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$")) && AttendanceVoiceService.canSpeak(this)) {
            val (hour, minute) = time.split(':').map { it.toInt() }
            val intent = Intent(this, AttendanceVoiceService::class.java)
                .putExtra("speech", "$name se registró a las $hour horas y $minute minutos.")
            try {
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
            } catch (_: Exception) { /* Notification remains available if Android blocks voice playback. */ }
        }
    }

    override fun onNewToken(token: String) {
        // Registration is refreshed when the administrator next opens the app.
        getSharedPreferences("push", MODE_PRIVATE).edit().putBoolean("needs_registration", true).apply()
    }
}
