package pe.splash.lasflores.admin

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import java.util.UUID

class AttendanceVoiceService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null
    private var ready = false
    private var destroyed = false
    private val waiting = ArrayDeque<String>()
    private val speaking = mutableSetOf<String>()
    private val timeout = Runnable { stopSelf() }

    companion object {
        fun canSpeak(context: Context): Boolean {
            val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (!manager.areNotificationsEnabled() ||
                audio.ringerMode != AudioManager.RINGER_MODE_NORMAL ||
                audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION) == 0 ||
                manager.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL
            ) return false
            if (Build.VERSION.SDK_INT >= 26) {
                val channel = manager.getNotificationChannel("attendance") ?: return false
                if (channel.importance < NotificationManager.IMPORTANCE_DEFAULT || channel.sound == null) return false
            }
            return true
        }
    }

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
            NotificationChannel("attendance_voice", "Lectura de asistencias", NotificationManager.IMPORTANCE_LOW)
                .apply { setSound(null, null) }
        )
        val stop = PendingIntent.getService(this, 0,
            Intent(this, AttendanceVoiceService::class.java).setAction("STOP"),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "attendance_voice")
            else Notification.Builder(this)
        startForeground(12002, builder
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Leyendo asistencia")
            .setContentText("La lectura terminará automáticamente.")
            .setOngoing(true).setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, "Detener lectura", stop).build())
            .build())
        handler.postDelayed(timeout, 30_000)
        engine = TextToSpeech(this) { status ->
            handler.post {
                if (destroyed) return@post
                val tts = engine
                if (status != TextToSpeech.SUCCESS || tts == null) {
                    stopSelf(); return@post
                }
                var language = tts.setLanguage(Locale.forLanguageTag("es-PE"))
                if (language < 0) language = tts.setLanguage(Locale.forLanguageTag("es-ES"))
                if (language < 0) { stopSelf(); return@post }
                tts.setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String?) {}
                    override fun onDone(id: String?) = completed(id)
                    @Deprecated("Legacy TTS callback")
                    override fun onError(id: String?) = completed(id)
                    override fun onError(id: String?, errorCode: Int) = completed(id)
                })
                ready = true
                while (waiting.isNotEmpty()) speak(waiting.removeFirst())
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val text = intent?.getStringExtra("speech")
        if (intent?.action == "STOP" || text.isNullOrBlank() || !canSpeak(this)) {
            stopSelf(); return START_NOT_STICKY
        }
        if (ready) speak(text.take(250)) else waiting.addLast(text.take(250))
        return START_NOT_STICKY
    }

    private fun speak(text: String) {
        if (!canSpeak(this)) { stopSelf(); return }
        val id = UUID.randomUUID().toString()
        speaking.add(id)
        if (engine?.speak(text, TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS) completed(id)
    }

    private fun completed(id: String?) {
        handler.post {
            if (destroyed) return@post
            speaking.remove(id)
            if (speaking.isEmpty() && waiting.isEmpty()) stopSelf()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        destroyed = true
        handler.removeCallbacksAndMessages(null)
        engine?.stop()
        engine?.shutdown()
        engine = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
