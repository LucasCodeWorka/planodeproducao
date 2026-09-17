'use client';

import { useEffect, useState } from 'react';
import { Factory, ChevronLeft, ChevronRight, ChevronDown, LogOut, Settings, TrendingDown, CheckSquare, SlidersHorizontal, CalendarClock, Gauge, Boxes, PackagePlus, BarChart3, WalletCards, GitCompareArrows, AlertTriangle, MinusCircle, CalendarRange, LineChart } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { clearToken } from '../lib/auth';

interface SidebarProps {
  onCollapse?: (collapsed: boolean) => void;
}

const GRUPOS_NAV = [
  {
    id: 'projecoes',
    titulo: 'Projeções',
    Icon: TrendingDown,
    itens: [
      { href: '/projecoes', label: 'Projeções', Icon: TrendingDown },
      { href: '/projecao-permanentes', label: 'Proj. Permanentes', Icon: CalendarRange },
      { href: '/projecao-macro', label: 'Visão Macro', Icon: LineChart },
    ],
  },
  {
    id: 'planejamento',
    titulo: 'Planejamento',
    Icon: CalendarClock,
    itens: [
      { href: '/sugestao-plano', label: 'Sugestão de Plano', Icon: CalendarClock },
      { href: '/recuperar-negativos', label: 'Recuperar Negativos', Icon: AlertTriangle },
      { href: '/reducao-plano', label: 'Redução de Plano', Icon: MinusCircle },
      { href: '/sugestoes-aprovacoes', label: 'Sugestões/Aprovação', Icon: CheckSquare },
    ],
  },
  {
    id: 'capacidade',
    titulo: 'Capacidade',
    Icon: Gauge,
    itens: [
      { href: '/capacidade', label: 'Capacidade', Icon: Gauge },
      { href: '/capacidade-matriz', label: 'Matriz Capacidade', Icon: Gauge },
    ],
  },
  {
    id: 'analises',
    titulo: 'Análises',
    Icon: BarChart3,
    itens: [
      { href: '/curva-abc', label: 'Curva ABC', Icon: BarChart3 },
      { href: '/extrato-plano', label: 'Extrato Plano', Icon: GitCompareArrows },
    ],
  },
];

export default function Sidebar({ onCollapse }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [gruposAbertos, setGruposAbertos] = useState<Record<string, boolean>>({});
  const [fontScale, setFontScale] = useState(1);
  const [zoomScale, setZoomScale] = useState(1);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedFont = Number(window.localStorage.getItem('ui_font_scale') || 1);
    const savedZoom = Number(window.localStorage.getItem('ui_zoom_scale') || 1);
    const nextFont = Number.isFinite(savedFont) ? Math.max(0.9, Math.min(1.3, savedFont)) : 1;
    const nextZoom = Number.isFinite(savedZoom) ? Math.max(0.85, Math.min(1.15, savedZoom)) : 1;
    setFontScale(nextFont);
    setZoomScale(nextZoom);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.fontSize = `${16 * fontScale}px`;
    window.localStorage.setItem('ui_font_scale', String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.zoom = String(zoomScale);
    window.localStorage.setItem('ui_zoom_scale', String(zoomScale));
  }, [zoomScale]);

  // o Sidebar remonta a cada navegação, então o que está aberto vive no localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const salvo = JSON.parse(window.localStorage.getItem('ui_nav_grupos') || '{}');
      if (salvo && typeof salvo === 'object') setGruposAbertos(salvo as Record<string, boolean>);
    } catch { /* storage indisponível: começa tudo fechado */ }
  }, []);

  function alternarGrupo(id: string) {
    setGruposAbertos((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { window.localStorage.setItem('ui_nav_grupos', JSON.stringify(next)); } catch { /* sem storage */ }
      return next;
    });
  }

  // clicar no ícone de um grupo com a barra recolhida: abre a barra já naquele grupo
  function abrirGrupoNaBarra(id: string) {
    setCollapsed(false);
    onCollapse?.(false);
    setGruposAbertos((prev) => {
      const next = { ...prev, [id]: true };
      try { window.localStorage.setItem('ui_nav_grupos', JSON.stringify(next)); } catch { /* sem storage */ }
      return next;
    });
  }

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    onCollapse?.(next);
  }

  function sair() {
    clearToken();
    router.replace('/login');
  }

  const navItemBase = 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full text-left transition-all duration-150 ease-out';
  const navActive = 'bg-brand-primary text-white shadow-sm';
  const navInactive = 'text-gray-300 hover:bg-white/10 hover:text-white';

  function adjustFont(delta: number) {
    setFontScale((prev) => Math.max(0.9, Math.min(1.3, Number((prev + delta).toFixed(2)))));
  }

  function adjustZoom(delta: number) {
    setZoomScale((prev) => Math.max(0.85, Math.min(1.15, Number((prev + delta).toFixed(2)))));
  }

  return (
    <aside className={`${collapsed ? 'w-20' : 'w-64'} bg-brand-dark fixed left-0 top-0 h-full z-30 flex flex-col transition-all duration-300`}>
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-700">
        {!collapsed && (
          <div className="font-secondary leading-tight">
            <div className="text-white font-bold tracking-wide text-base">LIEBE</div>
            <div className="text-gray-400 font-light text-xs tracking-wider">PRODUÇÃO</div>
          </div>
        )}
        <button onClick={toggle} className="text-gray-300 hover:text-white transition-colors ml-auto">
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 py-4 px-2 overflow-y-auto">
        {!collapsed && (
          <div className="px-2 pb-2">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Principal</p>
          </div>
        )}
        <div className="space-y-1">
          <button onClick={() => router.push('/')} className={`${navItemBase} ${pathname === '/' ? navActive : navInactive}`}>
            <Factory size={20} className="shrink-0" />
            {!collapsed && <span>Plano de Produção</span>}
          </button>

          {GRUPOS_NAV.map((grupo) => {
            const IconeGrupo = grupo.Icon;
            const temAtivo = grupo.itens.some((item) => item.href === pathname);

            // Recolhida: um ícone por grupo, igual às entradas soltas — clicar abre a barra nele.
            if (collapsed) {
              return (
                <button
                  key={grupo.id}
                  onClick={() => abrirGrupoNaBarra(grupo.id)}
                  title={grupo.titulo}
                  className={`${navItemBase} ${temAtivo ? navActive : navInactive}`}
                >
                  <IconeGrupo size={20} className="shrink-0" />
                </button>
              );
            }

            // Aberta: sem escolha salva, abre o grupo da página atual.
            const aberto = gruposAbertos[grupo.id] ?? temAtivo;

            return (
              <div key={grupo.id}>
                <button
                  onClick={() => alternarGrupo(grupo.id)}
                  className={`${navItemBase} justify-between ${temAtivo ? 'text-white bg-gray-700/40' : navInactive}`}
                >
                  <span className="flex items-center gap-3">
                    <IconeGrupo size={20} className="shrink-0" />
                    <span>{grupo.titulo}</span>
                  </span>
                  <ChevronDown size={16} className={`shrink-0 transition-transform duration-300 ease-out ${aberto ? '' : '-rotate-90'}`} />
                </button>

                {/* grid-rows 0fr→1fr anima a altura sem precisar medir o conteúdo, e nos dois sentidos */}
                <div
                  className={`grid transition-all duration-300 ease-out ${
                    aberto ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="ml-4 mt-1 space-y-1 border-l border-gray-700 pl-2">
                      {grupo.itens.map(({ href, label, Icon }) => (
                        <button
                          key={href}
                          onClick={() => router.push(href)}
                          tabIndex={aberto ? 0 : -1}
                          className={`${navItemBase} ${pathname === href ? navActive : navInactive}`}
                        >
                          <Icon size={20} className="shrink-0" />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <button onClick={() => router.push('/configuracoes')} className={`${navItemBase} ${pathname === '/configuracoes' ? navActive : navInactive}`}>
            <SlidersHorizontal size={20} className="shrink-0" />
            {!collapsed && <span>Configurações</span>}
          </button>
        </div>

        <div className="mt-5 pt-4 border-t border-gray-800">
          {!collapsed && (
            <div className="px-2 pb-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Secundário</p>
            </div>
          )}
          <div className="space-y-1">
            <button onClick={() => router.push('/analise-consumo-mp')} className={`${navItemBase} ${pathname === '/analise-consumo-mp' ? navActive : navInactive}`}>
              <Boxes size={20} className="shrink-0" />
              {!collapsed && <span>Análise Consumo MP</span>}
            </button>

            <button onClick={() => router.push('/excesso-mp')} className={`${navItemBase} ${pathname === '/excesso-mp' ? navActive : navInactive}`}>
              <PackagePlus size={20} className="shrink-0" />
              {!collapsed && <span>Excesso MP</span>}
            </button>

            <button onClick={() => router.push('/orcamento-mp')} className={`${navItemBase} ${pathname === '/orcamento-mp' ? navActive : navInactive}`}>
              <WalletCards size={20} className="shrink-0" />
              {!collapsed && <span>Orcamento MP</span>}
            </button>
          </div>
        </div>
      </nav>

      {!collapsed && (
        <div className="px-4 pb-2">
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Configurações</p>
        </div>
      )}
      <nav className="px-2 pb-2 space-y-1">
        {!collapsed && (
          <div className="rounded-lg border border-gray-700 bg-gray-900/40 px-3 py-3 mb-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500 mb-2">Acessibilidade</div>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs text-gray-300 mb-1">
                  <span>Fonte</span>
                  <span>{Math.round(fontScale * 100)}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => adjustFont(-0.05)} className="h-8 w-8 rounded border border-gray-700 text-gray-200 hover:bg-gray-800">-</button>
                  <button onClick={() => setFontScale(1)} className="flex-1 h-8 rounded border border-gray-700 text-[11px] text-gray-300 hover:bg-gray-800">Padrão</button>
                  <button onClick={() => adjustFont(0.05)} className="h-8 w-8 rounded border border-gray-700 text-gray-200 hover:bg-gray-800">+</button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-xs text-gray-300 mb-1">
                  <span>Zoom</span>
                  <span>{Math.round(zoomScale * 100)}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => adjustZoom(-0.05)} className="h-8 w-8 rounded border border-gray-700 text-gray-200 hover:bg-gray-800">-</button>
                  <button onClick={() => setZoomScale(1)} className="flex-1 h-8 rounded border border-gray-700 text-[11px] text-gray-300 hover:bg-gray-800">Padrão</button>
                  <button onClick={() => adjustZoom(0.05)} className="h-8 w-8 rounded border border-gray-700 text-gray-200 hover:bg-gray-800">+</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={() => router.push('/login')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-700 w-full text-left text-sm font-medium transition-colors"
        >
          <Settings size={20} className="shrink-0" />
          {!collapsed && <span>Admin / Cache</span>}
        </button>
      </nav>

      <div className="border-t border-gray-700 p-2">
        <button
          onClick={sair}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-brand-secondary hover:text-white w-full text-left text-sm font-medium transition-colors"
        >
          <LogOut size={20} className="shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
}
