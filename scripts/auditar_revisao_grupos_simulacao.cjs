require('dotenv').config();
const fs = require('fs');
const revisao = JSON.parse(fs.readFileSync('outputs/revisao_producao/revisao.json', 'utf8'));
(async () => {
  const token = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!token) throw new Error('A autenticação local do painel não está configurada.');
  const resp = await fetch('http://127.0.0.1:8000/api/capacidade/distribuicao-sugerida?meses=6&refresh=true', {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(240000)});
  const json = await resp.json();
  if (!resp.ok || !json.success) throw new Error(json.error || `HTTP ${resp.status}`);
  const porRef = new Map(json.referencias.map(r => [r.referencia, r]));
  const linhas = revisao.map(r => {
    const calc = porRef.get(r.referencia);
    return {referencia:r.referencia, revisao:r.revisao, observacao:r.observacao, revisado:r.grupos, opcoes:calc?.opcoes || null, alocacoes:calc?.grupos || null};
  });
  fs.writeFileSync('outputs/revisao_producao/comparacao_simulacao.json', JSON.stringify(linhas, null, 2));
  const secundarias = linhas.filter(x => x.observacao.toLowerCase().includes('falta o grupo secundário'));
  const corretas = linhas.filter(x => x.revisao.toLowerCase()==='corretas');
  console.log(JSON.stringify({ referenciasRevisadas:linhas.length, encontradas:linhas.filter(x=>x.opcoes).length, secundariasApontadas:secundarias.length, comAlternativa:secundarias.filter(x=>x.opcoes?.length>1).length, semAlternativa:secundarias.filter(x=>x.opcoes && x.opcoes.length<2).map(x=>x.referencia), corretasAAlterado:corretas.filter(x=>x.opcoes?.length && x.revisado[0]!==x.opcoes[0].grupo).map(x=>({referencia:x.referencia,revisado:x.revisado[0],historico:x.opcoes[0].grupo})) }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode=1; });
