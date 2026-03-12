'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { OP_MIN_REGRAS_FIXAS } from '../lib/opMinRules';
import { REPROJECAO_REGRAS_FIXAS } from '../lib/reprojecaoFechada';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type CorteRow = { idproduto: string; corte_min: number };
type SugestaoPlanoCfg = {
  cobertura_top30: number;
  cobertura_demais: number;
  cobertura_kissme: number;
  usar_corte_minimo: boolean;
};

function parseNumberFlexible(raw: string): number {
  const s = String(raw || '').trim().replace(/^"|"$/g, '');
  if (!s) return NaN;
  // Excel/pt-BR: 1.234,56
  if (s.includes(',') && s.includes('.')) {
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }
  // pt-BR simples: 120,00
  if (s.includes(',') && !s.includes('.')) {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function parseIdProduto(raw: string): string {
  const s = String(raw || '').trim().replace(/^"|"$/g, '');
  if (!s) return '';
  // Suporta notação científica exportada pelo Excel
  if (/e[+-]?\d+/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  const onlyDigits = s.replace(/[^\d]/g, '');
  return onlyDigits || s;
}

function parseCsv(text: string): CorteRow[] {
  const cleanText = String(text || '').replace(/^\uFEFF/, '');
  const lines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const out: CorteRow[] = [];
  const header = lines[0].toLowerCase().replace(/\s+/g, '');
  const hasHeader = header.includes('idproduto') && header.includes('corte_min');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const delim = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : ',');
  const headerCols = hasHeader
    ? lines[0].split(delim).map((c) => c.toLowerCase().replace(/\s+/g, '').replace(/^"|"$/g, ''))
    : [];
  const idxId = hasHeader ? headerCols.findIndex((c) => c === 'idproduto') : -1;
  const idxCorte = hasHeader ? headerCols.findIndex((c) => c === 'corte_min') : -1;

  dataLines.forEach((line) => {
    const cols = line.split(delim).map((v) => String(v || '').trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) return;
    const idRaw = hasHeader && idxId >= 0 ? cols[idxId] : cols[0];
    const corteRaw = hasHeader && idxCorte >= 0 ? cols[idxCorte] : cols[1];
    if (!idRaw || !corteRaw) return;
    const corteNum = parseNumberFlexible(corteRaw);
    const corte = Math.round(corteNum);
    if (!Number.isFinite(corte) || corte <= 0) return;
    const idproduto = parseIdProduto(idRaw);
    if (!idproduto) return;
    out.push({ idproduto, corte_min: corte });
  });

  const unique = new Map<string, CorteRow>();
  out.forEach((r) => {
    if (!r.idproduto) return;
    unique.set(r.idproduto, r);
  });
  return Array.from(unique.values());
}

export default function ConfiguracoesPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<CorteRow[]>([]);
  const [preview, setPreview] = useState<CorteRow[]>([]);
  const [cfg, setCfg] = useState<SugestaoPlanoCfg>({
    cobertura_top30: 1.2,
    cobertura_demais: 0.8,
    cobertura_kissme: 1.5,
    usar_corte_minimo: true,
  });

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const [rCortes, rCfg] = await Promise.all([
        fetch(`${API_URL}/api/configuracoes/corte-minimos`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/configuracoes/sugestao-plano`, { headers: authHeaders() }),
      ]);
      const pCortes = await rCortes.json();
      const pCfg = await rCfg.json();
      if (!rCortes.ok || !pCortes.success) throw new Error(pCortes.error || 'Erro ao carregar cortes mínimos');
      if (!rCfg.ok || !pCfg.success) throw new Error(pCfg.error || 'Erro ao carregar configuração de sugestão');
      setRows(Array.isArray(pCortes.data) ? pCortes.data : []);
      if (pCfg?.data) setCfg({
        cobertura_top30: Number(pCfg.data.cobertura_top30 || 1.2),
        cobertura_demais: Number(pCfg.data.cobertura_demais || 0.8),
        cobertura_kissme: Number(pCfg.data.cobertura_kissme || 1.5),
        usar_corte_minimo: pCfg.data.usar_corte_minimo !== false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }

  async function onUploadFile(file: File) {
    setError(null);
    setOkMsg(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (!parsed.length) {
      setError('Arquivo sem linhas válidas. Use formato: idproduto,corte_min');
      return;
    }
    setPreview(parsed);
    setOkMsg(`Prévia carregada: ${parsed.length.toLocaleString('pt-BR')} registros válidos.`);
  }

  async function salvarPreview() {
    if (!preview.length) return;
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/configuracoes/corte-minimos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ data: preview }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar cortes mínimos');
      setPreview([]);
      setOkMsg(`Cortes mínimos salvos: ${Number(data.total || 0).toLocaleString('pt-BR')} registros.`);
      await carregar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function salvarConfiguracaoSugestao() {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const payload = {
        cobertura_top30: Number(cfg.cobertura_top30 || 0),
        cobertura_demais: Number(cfg.cobertura_demais || 0),
        cobertura_kissme: Number(cfg.cobertura_kissme || 0),
        usar_corte_minimo: Boolean(cfg.usar_corte_minimo),
        usar_op_minima_ref: true,
      };
      const res = await fetch(`${API_URL}/api/configuracoes/sugestao-plano`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar configuração');
      setOkMsg('Configuração de sugestão de plano salva.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';
  const totalAtual = useMemo(() => rows.length, [rows]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <h1 className="text-white font-bold font-secondary tracking-wide text-base">CONFIGURAÇÕES</h1>
          <p className="text-white/70 text-xs">Upload de corte mínimo por produto (idproduto = cd_produto)</p>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {loading && <div className="bg-white rounded-lg border p-4 text-sm text-gray-500">Carregando...</div>}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
          {okMsg && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">{okMsg}</div>}

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs font-semibold text-brand-dark mb-2">Regras da sugestão futura de plano</div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <label className="text-xs text-gray-600">
                Cobertura Top30
                <input type="number" step="0.1" value={cfg.cobertura_top30} onChange={(e) => setCfg((p) => ({ ...p, cobertura_top30: Number(e.target.value || 0) }))} className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5" />
              </label>
              <label className="text-xs text-gray-600">
                Cobertura Demais
                <input type="number" step="0.1" value={cfg.cobertura_demais} onChange={(e) => setCfg((p) => ({ ...p, cobertura_demais: Number(e.target.value || 0) }))} className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5" />
              </label>
              <label className="text-xs text-gray-600">
                Cobertura KISS ME
                <input type="number" step="0.1" value={cfg.cobertura_kissme} onChange={(e) => setCfg((p) => ({ ...p, cobertura_kissme: Number(e.target.value || 0) }))} className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5" />
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={cfg.usar_corte_minimo} onChange={(e) => setCfg((p) => ({ ...p, usar_corte_minimo: e.target.checked }))} />
                Usar corte mínimo e múltiplos
              </label>
            </div>
            <div className="mt-2 text-[11px] text-gray-500">
              Regra fixa aplicada no sistema: OP mínima por referência habilitada para a sugestão de maio e planos futuros.
            </div>
            <div className="mt-3">
              <button onClick={salvarConfiguracaoSugestao} disabled={saving} className="px-3 py-2 text-xs font-semibold bg-brand-primary text-white rounded hover:bg-brand-secondary disabled:opacity-60">
                {saving ? 'Salvando...' : 'Salvar configuração da sugestão'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs text-gray-600 mb-2">Formato do arquivo: `idproduto,corte_min` (CSV com vírgula ou ponto-e-vírgula)</div>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadFile(f);
              }}
              className="text-xs"
            />
            {preview.length > 0 && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={salvarPreview}
                  disabled={saving}
                  className="px-3 py-2 text-xs font-semibold bg-brand-primary text-white rounded hover:bg-brand-secondary disabled:opacity-60"
                >
                  {saving ? 'Salvando...' : 'Salvar cortes mínimos'}
                </button>
                <div className="text-xs text-gray-600">
                  Prévia: <strong>{preview.length.toLocaleString('pt-BR')}</strong> linhas
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-brand-dark">
              Cortes mínimos atuais ({totalAtual.toLocaleString('pt-BR')})
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-100 z-10">
                  <tr>
                    <th className="text-left px-3 py-2">idproduto</th>
                    <th className="text-right px-3 py-2">corte_min</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={`${r.idproduto}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                      <td className="px-3 py-2">{r.idproduto}</td>
                      <td className="px-3 py-2 text-right font-semibold">{Math.round(r.corte_min).toLocaleString('pt-BR')}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-3 py-8 text-center text-gray-500">
                        Nenhum corte mínimo cadastrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-brand-dark">
              Regras fixas de OP mínima ({OP_MIN_REGRAS_FIXAS.length.toLocaleString('pt-BR')})
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-100 z-10">
                  <tr>
                    <th className="text-left px-3 py-2">continuidade</th>
                    <th className="text-left px-3 py-2">linha</th>
                    <th className="text-left px-3 py-2">grupo</th>
                    <th className="text-right px-3 py-2">op_min_ref</th>
                    <th className="text-right px-3 py-2">cobertura_max</th>
                  </tr>
                </thead>
                <tbody>
                  {OP_MIN_REGRAS_FIXAS.map((r, idx) => (
                    <tr key={`${r.continuidade}-${r.linha}-${r.grupo}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                      <td className="px-3 py-2">{r.continuidade}</td>
                      <td className="px-3 py-2">{r.linha}</td>
                      <td className="px-3 py-2">{r.grupo}</td>
                      <td className="px-3 py-2 text-right font-semibold">{Math.round(r.op_min_ref).toLocaleString('pt-BR')}</td>
                      <td className="px-3 py-2 text-right">{Number(r.cobertura_max || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x</td>
                    </tr>
                  ))}
                  {OP_MIN_REGRAS_FIXAS.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                        Nenhuma regra de OP mínima cadastrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <div className="text-xs font-semibold text-brand-dark">
                Regras fixas de reprojeção por último mês fechado ({REPROJECAO_REGRAS_FIXAS.length.toLocaleString('pt-BR')})
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                Base operacional: sempre usar o último mês fechado. Hoje, a análise usa fevereiro para recalcular março, abril e maio.
              </div>
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-100 z-10">
                  <tr>
                    <th className="text-left px-3 py-2">% atendido</th>
                    <th className="text-left px-3 py-2">ação</th>
                    <th className="text-left px-3 py-2">descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {REPROJECAO_REGRAS_FIXAS.map((r, idx) => (
                    <tr key={`${r.faixa}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                      <td className="px-3 py-2 font-semibold">{r.faixa}</td>
                      <td className="px-3 py-2">{r.acao}</td>
                      <td className="px-3 py-2 text-gray-600">{r.descricao}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
