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
    // dentro do EMULADOR — não existe num aparelho físico. Na maquininha de
    // desenvolvimento, aponte para o IP do computador na mesma rede Wi-Fi, em
    // ~/.gradle/gradle.properties (nunca no repositório):
    //   bora.baseUrl=http://192.168.0.10:3001/api/v1
    buildConfigField(
      "String",
      "BORA_BASE_URL",
      "\"${providers.gradleProperty("bora.baseUrl").orNull ?: "http://10.0.2.2:3001/api/v1"}\"",
    )
  }

  /**
   * Assinatura do APK de campo (homologação PagBank: V1 e V2 obrigatórias).
   *
   * A chave fica FORA do repositório, no gradle.properties pessoal
   * (~/.gradle/gradle.properties):
   *   bora.keystore.path=C:/Users/<você>/bora-release.jks
   *   bora.keystore.password=…
   *   bora.key.alias=bora
   *   bora.key.password=…
   * Como gerar a chave: docs/payments/pagbank-homologacao-apk.md.
   * Sem essas propriedades, o release sai SEM assinatura — serve para
   * conferir o build, não para instalar no terminal.
   */
  signingConfigs {
    create("release") {
      val caminho = providers.gradleProperty("bora.keystore.path").orNull
      if (caminho != null) {
        storeFile = file(caminho)
        storePassword = providers.gradleProperty("bora.keystore.password").orNull
        keyAlias = providers.gradleProperty("bora.key.alias").orNull
        keyPassword = providers.gradleProperty("bora.key.password").orNull
        enableV1Signing = true
        enableV2Signing = true
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      // Endereço da API de produção: decisão de hospedagem adiada junto com a
      // FASE 4. Vem do gradle.properties pessoal (bora.baseUrl.release) para o
      // repositório não fixar servidor nenhum.
      buildConfigField(
        "String",
        "BORA_BASE_URL",
        "\"${providers.gradleProperty("bora.baseUrl.release").orNull ?: "https://TROQUE-PELA-API-DE-PRODUCAO/api/v1"}\"",
      )
      if (providers.gradleProperty("bora.keystore.path").isPresent) {
        signingConfig = signingConfigs.getByName("release")
      }
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
    create("pagbank") {
      dimension = "pagamento"
      // Exigência do Guia de Boas Práticas da homologação SmartPOS PagBank
      // (lido em 2026-08-05): "minSdkVersion(23) e targetSdkVersion(23)".
      // Só neste flavor — o simulado continua moderno para o emulador.
      targetSdk = 23
      // Código de ativação do terminal (o mesmo digitado ao ativar a
      // maquininha na conta PagBank). Vem do gradle.properties LOCAL
      // (~/.gradle/gradle.properties: bora.pagbank.codigoAtivacao=XXXXXX) —
      // nunca do repositório.
      buildConfigField(
        "String",
        "PAGBANK_CODIGO_ATIVACAO",
        "\"${providers.gradleProperty("bora.pagbank.codigoAtivacao").orNull ?: ""}\"",
      )
    }
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

  // SDK PlugPag — SÓ no flavor pagbank. 1.35.0 é a versão mais recente do
  // repositório oficial (maven-metadata conferido em 2026-08-05; o .aar desta
  // versão foi extraído e as assinaturas verificadas com javap).
  "pagbankImplementation"("br.com.uol.pagseguro.plugpagservice.wrapper:wrapper:1.35.0")

  // Testes da máquina de estados (FluxoRecarga) em JVM pura, sem Android:
  //   ./gradlew testSimuladoDebugUnitTest
  testImplementation("junit:junit:4.13.2")
  testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
}
