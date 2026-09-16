plugins {
    id("com.android.application")
}

android {
    namespace = "pe.splash.lasflores"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "pe.splash.lasflores"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "SITE_ORIGIN", "\"https://pauluwu18.github.io\"")
        buildConfigField("String", "SITE_URL", "\"https://pauluwu18.github.io/sphash-sede-las-flores-app/\"")
    }

    buildFeatures {
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
