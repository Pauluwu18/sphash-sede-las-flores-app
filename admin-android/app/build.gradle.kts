import java.util.Properties

plugins {
    id("com.android.application")
}

val firebaseConfig = Properties().apply {
    val configFile = rootProject.file("firebase.properties")
    if (configFile.exists()) configFile.inputStream().use(::load)
}
fun configValue(name: String): String =
    "\"" + (firebaseConfig.getProperty(name) ?: "").replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "pe.splash.lasflores.admin"
    compileSdk {
        version = release(36) { minorApiLevel = 1 }
    }
    defaultConfig {
        applicationId = "pe.splash.lasflores.admin"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "SITE_ORIGIN", "\"https://pauluwu18.github.io\"")
        buildConfigField("String", "SITE_URL", "\"https://pauluwu18.github.io/sphash-sede-las-flores-app/\"")
        for (name in listOf("FIREBASE_PROJECT_ID", "FIREBASE_SENDER_ID", "FIREBASE_APP_ID", "FIREBASE_API_KEY")) {
            buildConfigField("String", name, configValue(name))
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-messaging")
}
