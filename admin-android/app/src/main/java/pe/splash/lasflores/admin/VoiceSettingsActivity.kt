package pe.splash.lasflores.admin

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import java.util.Locale
import java.util.UUID

class VoiceSettingsActivity : Activity() {
    private var engine: TextToSpeech? = null
    private var voices = emptyList<Voice>()
    private var selected: Voice? = null
    private var heard: String? = null
    private var previewId: String? = null
    private var destroyed = false
    private lateinit var status: TextView
    private lateinit var picker: Spinner
    private lateinit var preview: Button
    private lateinit var confirm: CheckBox
    private lateinit var save: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val padding = (24 * resources.displayMetrics.density).toInt()
            setPadding(padding, padding, padding, padding)
            setBackgroundColor(Color.WHITE)
        }
        fun text(value: String, size: Float) = TextView(this).apply {
            text = value; textSize = size; setTextColor(Color.rgb(16, 47, 73)); setPadding(0, 12, 0, 12)
            content.addView(this)
        }
        text("Voz femenina en español", 24f)
        text("Escucha una voz y confirma que es femenina. Se usará para leer el nombre del operario y su hora de llegada.", 16f)
        text("Se respetan silencio, volumen de notificaciones y No molestar.", 14f)
        status = text("Cargando las voces instaladas…", 15f)
        picker = Spinner(this).also { content.addView(it) }
        preview = Button(this).apply { text = "Escuchar ejemplo"; isEnabled = false; content.addView(this) }
        confirm = CheckBox(this).apply { text = "Confirmo que la voz escuchada es femenina"; isEnabled = false; content.addView(this) }
        save = Button(this).apply { text = "Usar esta voz"; isEnabled = false; content.addView(this) }
        Button(this).apply {
            text = "Instalar voces en español"
            setOnClickListener {
                try { startActivity(Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).setPackage(engine?.defaultEngine)) }
                catch (_: Exception) { status.text = "Instala voces españolas desde los ajustes de Texto a voz del teléfono." }
            }
            content.addView(this)
        }
        Button(this).apply { text = "Volver"; setOnClickListener { finish() }; content.addView(this) }
        setContentView(ScrollView(this).apply { addView(content) })
        confirm.setOnCheckedChangeListener { _, checked -> save.isEnabled = checked && heard == selected?.name && heard != null }
        preview.setOnClickListener { previewVoice() }
        save.setOnClickListener {
            val voice = selected ?: return@setOnClickListener
            val tts = engine ?: return@setOnClickListener
            if (heard != voice.name || !confirm.isChecked) return@setOnClickListener
            VoicePreferences.save(this, tts, voice)
            status.text = "Voz femenina guardada. Se usará en las próximas asistencias."
            save.isEnabled = false
        }
        engine = TextToSpeech(this) { result -> runOnUiThread {
            if (destroyed) return@runOnUiThread
            val tts = engine
            if (result != TextToSpeech.SUCCESS || tts == null) { status.text = "No se pudo iniciar Texto a voz. Instala o activa un motor de voz en español."; return@runOnUiThread }
            tts.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) { runOnUiThread {
                    if (!destroyed && previewId == id) {
                        heard = selected?.name
                        confirm.isEnabled = true
                        status.text = "Si escuchaste una voz femenina, marca la confirmación y pulsa Usar esta voz."
                    }
                } }
                @Deprecated("Legacy TTS callback")
                override fun onError(id: String?) { runOnUiThread {
                    if (!destroyed && previewId == id) status.text = "No se pudo escuchar esta voz. Prueba otra o instala sus datos."
                } }
                override fun onError(id: String?, code: Int) = onError(id)
            })
            voices = VoicePreferences.available(tts)
            picker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item,
                voices.mapIndexed { index, voice ->
                    "${voice.locale.getDisplayName(Locale.forLanguageTag("es"))} · Voz ${index + 1}" +
                        (if (VoicePreferences.explicitlyFemale(voice)) " · Femenina" else "") +
                        (if (voice.isNetworkConnectionRequired) " · Necesita Internet" else " · Sin Internet")
                })
            picker.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: AdapterView<*>?) {}
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                    previewId = null; tts.stop(); heard = null; confirm.isChecked = false; confirm.isEnabled = false
                    selected = voices.getOrNull(position)
                    preview.isEnabled = selected != null
                    status.text = "Pulsa Escuchar ejemplo para comprobar esta voz."
                }
            }
            val preferred = VoicePreferences.resolve(this, tts)
            if (preferred != null) picker.setSelection(voices.indexOf(preferred))
            if (voices.isEmpty()) status.text = "No hay voces españolas disponibles. Instálalas y vuelve a abrir esta pantalla."
        } }
    }

    private fun previewVoice() {
        val tts = engine ?: return
        val voice = selected ?: return
        if (!AttendanceVoiceService.canSpeak(this)) { status.text = "Activa el sonido y el volumen de notificaciones, y desactiva No molestar para escuchar la prueba."; return }
        heard = null; confirm.isChecked = false; confirm.isEnabled = false
        if (tts.setVoice(voice) != TextToSpeech.SUCCESS) { status.text = "Esta voz no está disponible. Elige otra."; return }
        val id = UUID.randomUUID().toString()
        previewId = id
        if (tts.speak("Adriano se registró a las 7 horas y 30 minutos.", TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.ERROR)
            status.text = "No se pudo reproducir la voz seleccionada."
    }

    override fun onPause() { previewId = null; engine?.stop(); super.onPause() }
    override fun onDestroy() { destroyed = true; engine?.stop(); engine?.shutdown(); super.onDestroy() }
}
