# Homologação do aplicativo da maquininha (PagBank SmartPOS)

Checklist e evidências para submeter o APK à homologação do PagBank, mapeando o
**Guia de Boas Práticas** (lido em 2026-08-05, fase-8 §8.1-I) ao nosso
aplicativo. Preenchido conforme os testes no terminal DEBUG avançam.

## 1. Requisitos do Guia — situação

| Exigência                                              | Como atendemos                                                                    | Situação        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------- |
| Android nativo (Java/Kotlin), sem WebView              | Kotlin, Views/XML; nenhum WebView                                                 | ✅              |
| `minSdkVersion 23` / `targetSdkVersion 23`             | flavor `pagbank`: `minSdk 23`, `targetSdk 23`                                     | ✅              |
| Assinatura V1 + V2                                     | `signingConfigs.release` com `enableV1Signing`/`enableV2Signing`                  | ✅ config       |
| `versionCode` único e crescente por release            | `defaultConfig.versionCode` — incrementar a cada APK enviado                      | ⬜ a cada envio |
| Sem `debuggable`, `testOnly` em produção               | build `release`                                                                   | ✅              |
| `allowBackup` removido/false                           | `allowBackup="false"` (protege o token do terminal; discutir se exigirem remover) | ✅              |
| Sem `cleartextTrafficPermitted` em produção            | só no overlay `src/debug/AndroidManifest.xml`                                     | ✅              |
| Armazenamento seguro (Keystore)                        | token em `EncryptedSharedPreferences` com `MasterKey` do Keystore                 | ✅              |
| Permissões mínimas, da lista permitida                 | `INTERNET`, `ACCESS_NETWORK_STATE` (+ `MANAGE_PAYMENTS` do SDK)                   | ✅              |
| Uso exclusivo do WrapperPPS (sem SUNMI/PAX)            | só `PlugPagServiceWrapper` 1.35.0                                                 | ✅              |
| Sem Google Play Services, ADB, SD card, acessibilidade | nenhum uso                                                                        | ✅              |
| APK ≤ 200 MB                                           | ordem de poucos MB                                                                | ✅              |
| Serviços externos informados com justificativa         | a API Borá Carregar (nosso servidor) — declarar na submissão                      | ⬜              |
| Descrição e prints sem dados reais                     | coletar no terminal DEBUG com cartões de teste                                    | ⬜              |

## 2. Evidências no equipamento (Gertec GPOS780S DEBUG, Android 13)

| #   | Teste                                           | Data       | Resultado                                 |
| --- | ----------------------------------------------- | ---------- | ----------------------------------------- |
| 1   | Pareamento e contexto                           | 2026-10-09 | ✅                                        |
| 2   | Pré-autorização (`doPreAutoCreate`)             | 2026-10-10 | ✅ reserva de R$ 200,00                   |
| 3   | Recarga acompanhada e encerrada                 | 2026-10-10 | ✅                                        |
| 4   | **Captura parcial** (`doEffectuatePreAuto`)     | 2026-10-10 | ✅ R$ 5,00 de R$ 200,00 — CAPTURED        |
| 5   | Cancelamento da reserva (`doPreAutoCancel`)     | 2026-10-10 | ✅ "Reserva cancelada", R$ 0,00           |
| 6   | Reinício durante a efetivação                   |            | ⬜                                        |
| 7   | Desistência no cartão                           | 2026-10-10 | ✅                                        |
| 8   | Débito (`doPayment` TYPE_DEBITO)                |            | ⬜                                        |
| 9   | Pix (`doPayment` TYPE_PIX)                      |            | ⬜                                        |
| 10  | Estorno de pré-pago sem consumo (`voidPayment`) |            | ⬜ ressalva: pode pedir o cartão de volta |
| 11  | Encerrar antes de o carregador iniciar          |            | ⬜                                        |

Registrar, por teste: `result`, `errorCode`, `message`, `transactionId`,
`transactionCode` devolvidos pelo SDK (Logcat, filtro `okhttp` e tag do app).
**Nunca** anexar prints com dados de cartão.

## 3. Gerar o APK de release

1. Criar a chave UMA vez (guardar o `.jks` e as senhas fora do repositório, com
   backup — perdê-la impede atualizar o app na Loja de Aplicativos):
   ```
   keytool -genkeypair -v -keystore C:\Users\<você>\bora-release.jks -alias bora ^
     -keyalg RSA -keysize 2048 -validity 10000 ^
     -dname "CN=Sonare Engenharia, O=Sonare Engenharia, L=Cuiaba, ST=MT, C=BR"
   ```
2. Em `~/.gradle/gradle.properties` (pessoal): `bora.keystore.path`,
   `bora.keystore.password`, `bora.key.alias`, `bora.key.password` e
   `bora.baseUrl.release=https://<api de produção>/api/v1`.
3. Incrementar `versionCode` em `app/build.gradle.kts`.
4. Android Studio: _Build > Generate App Bundles or APKs > APK_, variante
   **pagbankRelease** — ou `gradlew assemblePagbankRelease`. O APK sai em
   `app/build/outputs/apk/pagbank/release/`.
5. Conferir a assinatura: `apksigner verify --print-certs app-pagbank-release.apk`
   (tem de listar v1 e v2).

## 4. Submissão

Portal de Integrações do PagBank (mesmo das vinculações por SN): APK, descrição
da empresa e do aplicativo, prints, justificativa do serviço externo (API Borá
Carregar). Depois de homologado: vincular os terminais de produção pelo
**número de série** (fase-8 §8.1-I).
