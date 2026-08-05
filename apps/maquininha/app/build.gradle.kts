plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "br.com.sonare.bora.pos"
  // SmartPOS roda Android antigo (a Moderninha Smart 2 usa Android 8.1).
  // compileSdk alto não é problema — o que limita é o minSdk.
  compileSdk = 34

  defaultConfig {
    applicationId = "br.com.sonare.bora.pos"
    minSdk = 23
    targetSdk = 34
    versionCode = 1
    versionName = "0.1.0"

    // Para onde o aplicativo fala. 10.0.2.2 é o "localhost do host" visto de
    // dentro do emulador Android — casa com a API NestJS rodando na sua máquina.
    // Na maquininha real, troque pelo endereço público da API (release abaixo).
    buildConfigField("String", "BORA_BASE_URL", "\"http://10.0.2.2:3001/api/v1\"")
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      // Sem servidor de produção definido ainda (decisão adiada junto com a
      // FASE 4). Preencher antes de gerar o APK de campo.
      buildConfigField("String", "BORA_BASE_URL", "\"https://TROQUE-PELA-API-DE-PRODUCAO/api/v1\"")
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  /**
   * O PONTO ONDE O PLUGPAG SE ENCAIXA.
   *
   * A camada de pagamento é uma porta (PagamentoPort) com uma implementação por
   * flavor — a mesma disciplina do PaymentProvider no backend:
   *
   *   simulado — pré-autorização de mentira, aprova depois de 2 s. Roda em
   *              QUALQUER emulador/celular, hoje, casando com o provedor
   *              terminal-mock do backend. É o flavor de desenvolvimento.
   *
   *   pagbank  — a MESMA porta implementada com o PlugPag (SDK da maquininha
   *              PagBank): doPreAutoCreate / doEffectuatePreAuto / doPreAutoCancel.
   *              Só compila com o wrapper do SDK resolvido (ver settings.gradle.kts)
   *              e só roda no equipamento do PagBank.
   *
   * O resto do aplicativo não sabe qual flavor está ativo — ele fala com a
   * interface. Trocar de adquirente amanhã é escrever outro flavor, não
   * reescrever o aplicativo.
   */
  flavorDimensions += "pagamento"
  productFlavors {
    create("simulado") { dimension = "pagamento" }
    create("pagbank") { dimension = "pagamento" }
  }

  buildFeatures {
    viewBinding = true
    buildConfig = true
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

  // Contrato HTTP da FASE 8 §3 (Retrofit + Gson: simples e roda em Android velho)
  implementation("com.squareup.retrofit2:retrofit:2.11.0")
  implementation("com.squareup.retrofit2:converter-gson:2.11.0")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

  // Guarda do token bora_pos_… — cifrado em repouso, nunca em SharedPreferences puro
  implementation("androidx.security:security-crypto:1.1.0-alpha06")

  // SDK PlugPag — SÓ no flavor pagbank. A versão é a mais recente publicada no
  // repositório oficial quando este arquivo foi escrito; confirme no GitHub do
  // PagBank (pagseguro-sdk-plugpagservicewrapper) antes de compilar.
  "pagbankImplementation"("br.com.uol.pagseguro.plugpagservice.wrapper:wrapper:1.30.10")
}
