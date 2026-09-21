# Placas de base — as quatro numa mesa

Arquivo para imprimir: **`placas_base_4x.3mf`** · 180 × 180 × 4,5 mm · **103 g** · 2 filamentos

| Slot | Filamento |
|---|---|
| 1 | **Preto** (corpo das placas) |
| 2 | **Laranja** (letras e emblemas) |

Desde que as letras das quatro maquetes passaram a ser laranja sobre preto, as quatro
placas viraram a mesma dupla de cores — e não há razão para quatro trabalhos separados.

O ganho não é só juntar. As quatro têm a mesma estrutura em Z: corpo preto de 0 a 3 mm,
letra laranja de 3 a 4,4 mm. Numa mesa só, o fatiador faz as camadas de 0 a 3 inteiras em
preto e as de 3 a 4,4 inteiras em laranja — **uma troca de filamento para as quatro
placas**, contra uma por placa mais a torre de purga de cada trabalho.

| Placa | Maquete | Massa |
|---|---|---|
| `placa_weg` | contêiner WEG BESS | 25,6 g |
| `placa_dcco` | gerador Cummins | 26,2 g |
| `placa_powerstack` | Sungrow PowerStack | 25,2 g |
| `placa_ccr` | painel elétrico CCR | 26,4 g |

Para imprimir a placa de uma maquete só, abra este arquivo e apague as outras três na mesa.

## Como é gerado

`placas_base_4x.py` executa os quatro geradores das maquetes até a seção de exportação e
pega a placa de cada um. Nada é redesenhado aqui: mexer numa maquete e rodar este arquivo
mantém tudo em sincronia.
