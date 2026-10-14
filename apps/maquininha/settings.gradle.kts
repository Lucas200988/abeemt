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
    // O wrapper do PlugPag (flavor "pagbank") é servido como repositório Maven
    // PÚBLICO, direto do GitHub do PagBank — sem credencial nenhuma.
    // Verificado em 2026-08-05: o repositório foi clonado e o artefato 1.35.0
    // extraído e inspecionado (assinaturas conferidas com javap).
    // O README oficial cita github.com/pagseguro/PlugPagServiceWrapper/raw/master;
    // este é o endereço equivalente do repositório atual.
    maven {
      url = uri("https://raw.githubusercontent.com/pagseguro/pagseguro-sdk-plugpagservicewrapper/master")
    }
  }
}

rootProject.name = "bora-maquininha"
include(":app")
