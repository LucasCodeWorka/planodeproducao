# FCCFP023 - Conciliacao Bancaria com Extrato Eletronico

Origem: resumo de procedimento validado anteriormente no ambiente TOTVS.

## Para que serve

Concilia extrato bancario com movimentos do ERP.

## Fluxo seguro de consulta

1. abrir `FCCFP023`;
2. preencher `Cta.`;
3. dar `Tab` para o sistema completar banco, agencia e conta;
4. preencher periodo com datas sem barras, por exemplo `18092026`;
5. executar a consulta pela lupa;
6. ler as grades depois de garantir que esta no topo.

## Armadilhas

- Datas devem ser digitadas so com numeros. Barra pode virar `q` no servidor.
- Banner vermelho de erro bloqueia a tela ate ser fechado.
- A grade Movimento pode abrir no fim da lista.
- Scroll do mouse nao funciona bem nas grades; usar setas ou PageDown.
- Valores exigem captura ampliada para leitura confiavel.

## Acoes que alteram dados

O botao `Conciliar` altera dados e nao abre dialogo de confirmacao. Nunca
clicar sem autorizacao explicita do usuario.
