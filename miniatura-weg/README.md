# Miniatura WEG BESS — contêiner ISO 20 pés, 1:80

Arquivo para imprimir: **`miniatura_weg_multicor.3mf`**

Antes de importar, o projeto aberto no Bambu Studio precisa ter **3 filamentos
carregados**. Com menos que isso o importador joga tudo no filamento 1 sem avisar.

| Slot | Filamento | Onde aparece |
|---|---|---|
| 1 | **Cinza** | contêiner, teto, corpo da chapa do logo |
| 2 | **Preto** | placa de base, logo weg + BESS |
| 3 | **Branco** | letras e emblema da placa |

> Atenção: aqui o filamento 1 é o **cinza**. Nas maquetes da CCR e do PowerStack o 1 é
> o branco, e no gerador da DCCO é o verde.

## Peças

| Peça | Medidas | Massa | Como imprime |
|---|---|---|---|
| contêiner | 75,7 × 30,5 × 30,2 mm | 16,8 g | apoiado na base, sem suporte |
| teto | 75,7 × 30,5 × 5,2 mm | 7,0 g | de cabeça para baixo |
| chapa do logo | 19 × 20,4 × 1,6 mm | 0,8 g | **deitada**, arte para cima |
| placa de base | 84 × 84 × 4,4 mm | 25,4 g | deitada |

Total: **50 g**. Cabe na cúpula de acrílico de 90 × 90 × 110 mm internos.

## Montagem

1. A **chapa do logo** é peça à parte e vai **colada** no bolso do costado, entre as
   venezianas e as portas. Folga de 0,25 mm por lado; encaixa rente à parede.
2. O teto encaixa por aba, sem cola.
3. O contêiner assenta no rebaixo da placa de base.

O logo é peça separada porque relevo de segunda cor em parede vertical não imprime: cada
camada vira uma ilha solta depositada logo depois de uma troca de filamento. Deitada, a
troca de cor acontece em 3 camadas horizontais em vez de 101 verticais.

Para conferir o encaixe sem gastar o contêiner inteiro, imprima só
`miniatura_weg_chapa_logo.stl` (0,8 g, poucos minutos).

## STL avulsos (uma cor só)

`miniatura_weg_corpo.stl`, `miniatura_weg_teto.stl`, `miniatura_weg_chapa_logo.stl`,
`miniatura_weg_placa.stl` — para imprimir peça a peça ou abrir em outro programa.

Gerado por `weg_bess_miniatura.py` (`python3 weg_bess_miniatura.py` regrava tudo).
