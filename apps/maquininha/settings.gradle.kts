/**
 * Projeto Android da maquininha — SEPARADO do monorepo pnpm de propósito.
 *
 * Este diretório não tem package.json: pnpm e turbo o ignoram por completo.
 * Quem o abre é o Android Studio (File > Open > apps/maquininha).
 */
pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
    // O wrapper do PlugPag (flavor "pagbank") é distribuído pelo GitHub Packages
    // do PagBank. Exige autenticação com um token pessoal do GitHub — ver
    // README.md, seção "Flavor pagbank". Sem credencial, use o flavor "simulado".
    maven {
      url = uri("https://maven.pkg.github.com/pagseguro/pagseguro-sdk-plugpagservicewrapper")
      credentials {
        username = providers.gradleProperty("gpr.user").orNull ?: System.getenv("GITHUB_ACTOR")
        password = providers.gradleProperty("gpr.token").orNull ?: System.getenv("GITHUB_TOKEN")
      }
    }
  }
}

rootProject.name = "bora-maquininha"
include(":app")
