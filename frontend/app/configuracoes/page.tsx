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
  cobertura_min_a: number;
  cobertura_max_a: number;
  cobertura_min_b: number;
  cobertura_max_b: number;
  cobertura_min_c: number;
  cobertura_max_c: number;
  cobertura_min_d: number;
  cobertura_max_d: number;
  cobertura_max_ideal: number;
  usar_corte_minimo: boolean;
};

type EstoqueLojasCfg = {
  cobertura_minima_lojas: number;
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
    cobertura_min_a: 0.5,
    cobertura_max_a: 1.0,
    cobertura_min_b: 1.0,
    cobertura_max_b: 2.0,
    cobertura_min_c: 1.0,
    cobertura_max_c: 2.5,
    cobertura_min_d: 1.0,
    cobertura_max_d: 3.0,
    cobertura_max_ideal: 6.0,
    usar_corte_minimo: true,
  });
  const [cfgLojas, setCfgLojas] = useState<EstoqueLojasCfg>({
    cobertura_minima_lojas: 1.0,
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
      const [rCortes, rCfg, rLojas] = await Promise.all([
        fetch(`${API_URL}/api/configuracoes/corte-minimos`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/configuracoes/sugestao-plano`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/configuracoes/estoque-lojas`, { headers: authHeaders() }),
      ]);
      const pCortes = await rCortes.json();
      const pCfg = await rCfg.json();
      const pLojas = await rLojas.json();
      if (!rCortes.ok || !pCortes.success) throw new Error(pCortes.error || 'Erro ao carregar cortes mínimos');
      if (!rCfg.ok || !pCfg.success) throw new Error(pCfg.error || 'Erro ao carregar configuração de sugestão');
      setRows(Array.isArray(pCortes.data) ? pCortes.data : []);
      if (pCfg?.data) setCfg({
        cobertura_min_a: Number(pCfg.data.cobertura_min_a ?? 0.5),
        cobertura_max_a: Number(pCfg.data.cobertura_max_a ?? 1.0),
        cobertura_min_b: Number(pCfg.data.cobertura_min_b ?? 1.0),
        cobertura_max_b: Number(pCfg.data.cobertura_max_b ?? 2.0),
        cobertura_min_c: Number(pCfg.data.cobertura_min_c ?? 1.0),
        cobertura_max_c: Number(pCfg.data.cobertura_max_c ?? 2.5),
        cobertura_min_d: Number(pCfg.data.cobertura_min_d ?? 1.0),
        cobertura_max_d: Number(pCfg.data.cobertura_max_d ?? 3.0),
        cobertura_max_ideal: Number(pCfg.data.cobertura_max_ideal ?? 6.0),
        usar_corte_minimo: pCfg.data.usar_corte_minimo !== false,
      });
      if (pLojas?.data) setCfgLojas({
        cobertura_minima_lojas: Number(pLojas.data.cobertura_minima_lojas || 1.0),
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
        cobertura_min_a: Number(cfg.cobertura_min_a || 0),
        cobertura_max_a: Number(cfg.cobertura_max_a || 0),
        cobertura_min_b: Number(cfg.cobertura_min_b || 0),
        cobertura_max_b: Number(cfg.cobertura_max_b || 0),
        cobertura_min_c: Number(cfg.cobertura_min_c || 0),
        cobertura_max_c: Number(cfg.cobertura_max_c || 0),
        cobertura_min_d: Number(cfg.cobertura_min_d || 0),
        cobertura_max_d: Number(cfg.cobertura_max_d || 0),
        cobertura_max_ideal: Number(cfg.cobertura_max_ideal || 0),
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

  async function salvarConfiguracaoLojas() {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const payload = {
        cobertura_minima_lojas: Number(cfgLojas.cobertura_minima_lojas ?? 1.0),
      };
      const res = await fetch(`${API_URL}/api/configuracoes/estoque-lojas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar configuração');
      setOkMsg('Configuração de estoque lojas salva.');
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
            <div className="text-xs font-semibold text-brand-dark mb-2">Regras de Cobertura por Curva ABC</div>
            <div className="text-[11px] text-gray-500 mb-3">
              Configure a cobertura mínima (alvo) e máxima (limite para UL/QT) por curva ABC.
            </div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">Curva</th>
                  <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">Cobertura Mínima (Alvo)</th>
                  <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">Cobertura Máxima (Limite UL/QT)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-gray-200 px-3 py-2 font-semibold text-emerald-600">A</td>
                  <td className="border border-gray-200 px-2 py-1">
                    <input type="number" step="0.1" min="0" value={cfg.cobertura_min_a} onChange={(e) => setCfg((p) => ({ ...p, cobertura_min_a: Number(e.target.value || 0) }))} className="w-full border border-gray-300 rounded px-2 py-1" />
                  </td>
                  <td className="border border-gray-200 px-2 py-1">
                    <input type="number" step="0.1" min="0" value={cfg.cobertura_max_a} onChange={(e) => setCfg((p) => ({ ...p, cobertura_max_a: Number(e.target.value || 0) }))} className="w-full border border-gray-300 rounded px-2 py-1" />
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-200 px-3 py-2 font-semibold text-blue-600">B</td>
                  <td className="border border-gray-200 px-2 py-1">
                    <input type="number" step="0.1" min="0" value={cfg.cobertura_min_b} onChange={(e) => setCfg((p) => ({ ...p, cobertura_min_b: Number(e.target.value || 0) }))} className="w-full border border-gray-300 rounded px-2 py-1" />
                  </td>
                  <td className="border border-gray-200 px-2 py-1">
                    <input type="number" step="0.1" min="0" value={cfg.cobertura_max_b} onChange={(e) => setCfg((p) => ({ ...p, cobertura_max_b: Number(e.target.value || 0) }))} className="w-full border border-gray-300 rounded px-2 py-1" />
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-200 px-3 py-2 font-semibold text-amber-600">C</td>
                  <td className="border border-gray-200 px-2 py-1">
                    <input type="number" step="0.1" min="0" value={cfg.cobertura_min_c} onChange={(e) => setCfg((p) => ({ ...p, cobertura_min_c: Number(e.target.value || 0) }))} className="w-full border border-gray-300 rounded px-2 py-1" />
                  </td>
                  <td className="border border-gray-200 px-2 py-1">
                    <input type="number" step="0.1" min="0" value={cfg.cobertura_max_c} onChange={(e) => setCfg((p) => ({ ...p, cobertura_max_c: Number(e.target.value || 0) }))} className="w-full border border-gray-300 rounded px-2 py-1" />
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-200 px-3 py-2 font-semibold text-red-600">D</td>
                  <td className="border border-gray-200 px-2 py-1">
                    <input type="number" step="0.1" min="0" value={cfg.cobertura_min_d} onChange={(e) => setCfg((p) => ({ ...p, cobertura_min_d: Number(e.target.value || 0) }))} className="w-full border border-gray-300 rounded px-2 py-1" />
                  </td>
                  <td className="border border-gray-200 px-2 py-1">
                    <input type="number" step="0.1" min="0" value={cfg.cobertura_max_d} onChange={(e) => setCfg((p) => ({ ...p, cobertura_max_d: Number(e.target.value || 0) }))} className="w-full border border-gray-300 rounded px-2 py-1" />
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="text-xs font-semibold text-purple-800 mb-2">Regra Especial - Linha IDEAL</div>
              <div className="text-[11px] text-purple-600 mb-2">
                Produtos da linha IDEAL usam cobertura máxima diferenciada (pode cortar 50% do mínimo).
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-600">
                  Cobertura Máxima IDEAL
                  <input type="number" step="0.1" min="0" value={cfg.cobertura_max_ideal} onChange={(e) => setCfg((p) => ({ ...p, cobertura_max_ideal: Number(e.target.value || 0) }))} className="mt-1 w-24 border border-gray-300 rounded px-2 py-1" />
                </label>
                <span className="text-[11px] text-gray-500 pt-4">Padrão: 6.0x</span>
              </div>
            </div>

            <div className="mt-3">
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
            <div className="text-xs font-semibold text-brand-dark mb-2">
              Estoque das Lojas (Pós-Incêndio)
            </div>
            <div className="text-[11px] text-gray-500 mb-3">
              Define a cobertura mínima que cada loja deve manter. O excedente acima dessa cobertura fica disponível para uso na fábrica.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <label className="text-xs text-gray-600">
                Cobertura mínima lojas (meses)
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={cfgLojas.cobertura_minima_lojas}
                  onChange={(e) => setCfgLojas((p) => ({ ...p, cobertura_minima_lojas: Number(e.target.value ?? 1.0) }))}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5"
                />
              </label>
              <div className="text-[11px] text-gray-500">
                Ex: 1.0 = lojas mantêm 1 mês de estoque mínimo. Excedente acima disso pode ser transferido.
              </div>
              <button
                onClick={salvarConfiguracaoLojas}
                disabled={saving}
                className="px-3 py-2 text-xs font-semibold bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-60"
              >
                {saving ? 'Salvando...' : 'Salvar config. lojas'}
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
