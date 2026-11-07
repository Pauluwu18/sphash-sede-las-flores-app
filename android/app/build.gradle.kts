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
        versionCode = 3
        versionName = "1.2"
        buildConfigField("String", "SITE_ORIGIN", "\"https://pauluwu18.github.io\"")
        buildConfigField("String", "SITE_URL", "\"https://pauluwu18.github.io/sphash-sede-las-flores-app/\"")
    }

    signingConfigs {
        create("release") {
            storeFile = file("splash.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("release")
        }
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
}
