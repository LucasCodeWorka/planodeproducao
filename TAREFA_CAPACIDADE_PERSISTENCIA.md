# Capacidade: o que o painel perde no deploy

Aberto em 27/10/2026. Motivo: o Fagner avisou que "o painel perdeu as informações que subi".

## O que está acontecendo

O `render.yaml` **não declara disco persistente**. Todo deploy recria o container do zero e
`data/*.json` volta para a versão commitada no repositório. Quem salvava em arquivo perdia tudo.

Das três configurações de capacidade que a tela grava:

| o que a tela salva | onde ia parar | situação |
|---|---|---|
| referência → grupo | banco (`app_capacidade_grupo_refs`) | já estava correto |
| capacidade diária por grupo | arquivo em disco | **corrigido, falta deploy** |
| dias úteis por mês | arquivo em disco | **corrigido, falta deploy** |

Isso explica dois sintomas que pareciam problemas separados:

- **`capacidade_dias.json` diz que outubro tem 12 dias úteis**, com data de 14/10. Em 27/10
  restavam 4. Não era falta de atualizar: o valor certo era descartado a cada deploy.
- **`capacidade_grupos.json` tem código de referência de produto no lugar de minutos.** A soma
  dá 7.671.414 min/dia contra 55.433 medidos no ERP. Valores como 136122, 303603, 501753 e
  701748 são referências (701708, 123606 e 123019 aparecem no plano de fevereiro). O painel
  pode ter estado certo depois que o Fagner salvou, e voltado para esse arquivo no deploy.

## O que já foi feito (não commitado)

`src/routes/capacidade.js`: `grupos` e `dias` passaram a gravar no banco, nas tabelas
`app_capacidade_grupos` e `app_capacidade_dias`. Mesmo padrão do mapeamento de referências —
tabela criada sozinha, transação, e falha de gravação devolve 500 em vez de fingir que salvou.

**Decisão deliberada: o banco NÃO é semeado a partir do arquivo.** No mapeamento de referências
semear fazia sentido; aqui tornaria o lixo permanente em vez de descartável. Enquanto ninguém
salvar, continua valendo o arquivo, exatamente como hoje. O primeiro "salvar" da tela vira a
verdade e passa a persistir.

Testado local: `/grupos`, `/dias`, `/config`, `/dias-resumo`, `/gap-mensal` e `/indice-mensal`
todas em 200, com os mesmos valores de antes. Nada foi escrito no banco.

## O que falta

1. **Subir e deployar** — a mudança é no backend, só tem efeito no Render.
2. **O Fagner salvar as capacidades corretas por grupo.** A referência é o medido no ERP
   (`/api/capacidade/real`), que soma 55.433 min/dia. Cada grupo fica entre ~2.400 e ~4.200
   min/dia, não na casa das centenas de milhares.
3. **Confirmar os dias úteis de outubro** com a operação e salvar.

## Pergunta em aberto

Como códigos de referência foram parar na coluna de capacidade? Se foi a própria tela que
gravou assim, persistir no banco congela o erro em vez de corrigi-lo. Pedir ao Fagner para
conferir os números na tela antes e depois de salvar: se digitar 3.197 e voltar 136.122, o
problema é na tela e precisa ser investigado antes de confiar no que for salvo.

## Pendências vizinhas, do mesmo dia

- `data/capacidade_grupo_refs.json` não cobre 17 referências permanentes, quase todas da linha
  IDEAL (as maiores: 123606 e 123019). Valem 96.464 min do plano de fevereiro. A tela de
  Sugestão de Plano passou a herdar o grupo por tipo de produto como paliativo, mas o cadastro
  de verdade continua faltando.
- `/api/capacidade/config` leva ~23s. A tela de Sugestão não aplica teto de capacidade nenhum
  enquanto ela não chega — já existe tarja vermelha avisando para não emitir nesse intervalo,
  mas a lentidão em si continua.
