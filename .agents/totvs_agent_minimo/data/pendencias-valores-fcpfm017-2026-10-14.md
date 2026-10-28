# Pendências para orçamento FCPFM017 — 14/10/2026

Conferência **sem gravação no TOTVS**. A matriz do plano retornou 2.881 SKUs; a análise de consumo retornou 1.442 MPs. Consultando preços em lotes de até 500, 414 MPs ficaram com valor positivo. Dessas, 19 não possuem vínculo `seqgrupo + cor` em `app_mp_despesa`, portanto ainda não há código de despesa seguro para receber seus valores no FCPFM017.

Os valores abaixo são **estimativas de necessidade de compra com folga** (5%, mínimo R$ 250 por MP), calculadas como no painel `/orcamento-mp`. Não são valores de pedidos efetivamente lançados. Os centavos foram arredondados por MP para conferência; a soma das linhas exibidas é R$ 25.205,89, enquanto a diferença entre totais calculados antes do arredondamento por MP é R$ 25.205,88.

| MP | Seqgrupo | Cor | Descrição | Valor estimado | Cadastro local da MP |
|---|---:|---:|---|---:|---|
| 1004031 | 3329 | 300 | ELAST MANACA BRILHOSO 17MM PRETO U | R$ 269,35 | Ausente |
| 1011461 | 1409 | 0071 | REGULADOR PLAST 10MM APR 001 20041 LOVE U | R$ 250,01 | Ausente |
| 1011955 | 10979 | 1847 | AVIAMENTO LINHA MISTA 2.500 METROS (CA02) CONHAQUE U | R$ 254,85 | Ausente |
| 1012650 | 12843 | 300 | ELASTICO CERRUTI 11MM PRETO U | R$ 301,82 | Presente, valor anterior zero |
| 1013020 | 1600 | 0071 | GANCHO APG 005 10MM LOVE U | R$ 250,19 | Ausente |
| 1014576 | 12664 | 1885 | ELASTICO MYCORE 13MM TRUFA U | R$ 286,93 | Presente, valor anterior zero |
| 1014698 | 615 | 2379 | ABOTOADOR 60MM X 03 REGULAGEM - 8758483 MAUVE U | R$ 639,67 | Ausente |
| 1014970 | 13951 | 300 | RENDA JL312214 PRETO U | R$ 319,53 | Ausente |
| 1015809 | 14378 | 300 | ELAST JERI 11MM PRETO U | R$ 342,90 | Ausente |
| 1015810 | 14378 | 1902 | ELAST JERI 11MM MILKSHAKE U | R$ 362,50 | Ausente |
| 1016252 | 805 | 1901 | BJ 213.385 EXT CONFORT TAM 50 AMEIXA U | R$ 457,40 | Presente, valor anterior zero |
| 5000110 | 269 | 904 | SACO PP LISO P/ PICOTE 08X11X0,06 UNICA U | R$ 251,74 | Ausente |
| 5000126 | 299 | 904 | PROT.CONJ PP 36X25 0,05 IMPRESSO NORMAL UNICA U | R$ 250,79 | Ausente |
| 5000127 | 301 | 904 | PROT.CONJ ESP PP 40 X 27 0,05 C/OXI UNICA U | R$ 251,96 | Ausente |
| 5000138 | 319 | 904 | EMB 15X18+3X0,05 PP ADS IMPRES NORMAL UNICA U | R$ 2.447,03 | Ausente |
| 5000140 | 323 | 904 | EMB 18X37+3 X 0,05 PP ADS IMPRES NORMA UNICA U | R$ 8.446,99 | Ausente |
| 5000141 | 325 | 904 | EMB 20X40+3 X 0,05 PP ADS IMPRE NORMAL UNICA U | R$ 5.745,40 | Ausente |
| 5000681 | 4608 | 904 | EMBALAGEN SEM IMPRESSAO 28 X 40 3 X 0,05 UNICA U | R$ 250,48 | Ausente |
| 5002671 | 12203 | 904 | CONSUMO PINO DE NYLON FIX PIN 20 MM UNICA U | R$ 3.826,35 | Ausente |

Além dessas 19, as MPs **1011733** (necessidade 61,6 unidades) e **1015290** (12 unidades), ambas `VIES DE 2,5CM - VISCOSE M.V.S`, têm necessidade mas nenhum preço válido nem última compra. Seu valor ainda não está incluído no orçamento estimado.

Antes de qualquer lançamento: validar o vínculo de despesa para as 19 MPs, obter preço para os 2 viés, reconciliar os pedidos existentes com despesa/CC 506 e separar outubro–dezembro de 2026 de janeiro–fevereiro de 2027. O cache persistido do painel e o FCPFM017 **não foram atualizados** nesta conferência.

## Cruzamento complementar: cadastro, pedidos e plano 500

Consulta de leitura em `vr_prd_prdgrade`, `vr_fcp_despesaitem`,
`vr_prd_prddesp`, `vr_cmp_pedidoi`/rateios e `vr_fcp_planoctai`:

- Nenhuma das 19 MPs tem uma despesa com **descrição exata** no espelho
  `vr_fcp_despesaitem`. As 11 MPs de aviamentos/tecidos/bojos têm despesas
  semelhantes de outras cores ou tipos, mas não se pode reutilizar esses
  códigos para a cor faltante. Os pedidos históricos delas usam sobretudo
  categorias genéricas, como ELASTICO (107), RENDA (108), BOJO (106),
  ABOTOADOR (178), LINHAS E FIOS (185) e ACESSORIO (299).
- As 7 MPs de saco/protetor/embalagem (`5000110`, `5000126`, `5000127`,
  `5000138`, `5000140`, `5000141`, `5000681`) somam **R$ 17.644,39** na
  estimativa. Estão ligadas, no cadastro de produto, à despesa genérica **3
  EMBALAGENS / CC 1**, e pedidos recentes normalmente usam **3 / CC 510
  EXPEDICAO**. A despesa 3 aparece nos planos 1 e 3, mas **não** no plano
  500. É preciso decidir se esses itens pertencem ao orçamento de PCP/506
  ou se devem seguir o orçamento de Expedição/510; cadastrá-los
  automaticamente em PCP poderia duplicar/mudar a classificação.
- O pino `5002671` soma **R$ 3.826,35**. Seus pedidos usam despesa genérica
  3 com CC 501 PRODUCAO ou não têm rateio; também requer decisão de
  classificação. As 11 MPs restantes somam **R$ 3.735,15** (soma das
  linhas arredondadas acima).
- Os viés `1011733` (PRETO) e `1015290` (PEAR) já têm despesas distintas
  **11070** e **11069** em `app_mp_despesa` e `vr_fcp_despesaitem`, mas essas
  despesas **não constam no plano 500/506** espelhado. Não há pedidos de
  compra para nenhum produto do grupo 12013; as tabelas de solicitação de
  material e ficha de custo consultadas também não trouxeram preço para
  os dois produtos. O custo TOTVS consultado anteriormente foi zero/ausente.
  Portanto, seu valor não pode ser calculado com base comprovada.
- Como controle adicional, o lote anterior do FCPFM043 contém **292
  despesas únicas**, das quais **269** constam em `vr_fcp_planoctai` com
  plano 500 e CC 506; **23** ainda não constam. Esse lote é uma foto
  anterior e não permite inferir exatamente quantas das 259 despesas
  do cálculo atual estão fora do plano. A conferência dos vínculos do
  orçamento atual ainda é necessária antes do FCPFM017.

Nenhum cadastro de despesa, vínculo ao plano, preço provisório ou valor
orçado foi gravado nesta etapa.
