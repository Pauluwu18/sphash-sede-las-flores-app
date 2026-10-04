package pe.splash.lasflores.admin

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice

object VoicePreferences {
    fun available(tts: TextToSpeech): List<Voice> = tts.voices.orEmpty()
        .filter { it.locale.language == "es" && TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features.orEmpty() }
        .sortedWith(compareBy<Voice> { it.isNetworkConnectionRequired }
            .thenBy { if (it.locale.country == "PE") 0 else 1 }.thenByDescending { it.quality }.thenBy { it.name })

    // Android has no standard gender field. Only trust explicit engine metadata
    // or an exact voice/engine pair the administrator listened to and confirmed.
    fun explicitlyFemale(voice: Voice): Boolean {
        val label = Regex("(^|[ _:=;-])(female|femenina|femenino|mujer)([ _:=;-]|$)", RegexOption.IGNORE_CASE)
        return label.containsMatchIn(voice.name) || voice.features.orEmpty().any { label.containsMatchIn(it) }
    }

    fun resolve(context: Context, tts: TextToSpeech): Voice? {
        val settings = context.getSharedPreferences("attendance_voice", Context.MODE_PRIVATE)
        val voices = available(tts)
        val saved = settings.getString("voice_name", null)
        if (saved != null && settings.getString("engine", null) == tts.defaultEngine) {
            voices.find { it.name == saved }?.let { return it }
        }
        return voices.firstOrNull { explicitlyFemale(it) }
    }

    fun save(context: Context, tts: TextToSpeech, voice: Voice) {
        context.getSharedPreferences("attendance_voice", Context.MODE_PRIVATE).edit()
            .putString("engine", tts.defaultEngine).putString("voice_name", voice.name).putBoolean("needs_setup", false).apply()
    }
}
