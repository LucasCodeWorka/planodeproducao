'use client';

import { useEffect, useState } from 'react';
import { Factory, ChevronLeft, ChevronRight, LogOut, Settings, TrendingDown, FlaskConical, ClipboardList, CheckSquare, SlidersHorizontal, CalendarClock, Gauge, Boxes, Sparkles } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { clearToken } from '../lib/auth';

interface SidebarProps {
  onCollapse?: (collapsed: boolean) => void;
}

export default function Sidebar({ onCollapse }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [zoomScale, setZoomScale] = useState(1);
  const router   = useRouter();
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

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    onCollapse?.(next);
  }

  function sair() {
    clearToken();
    router.replace('/login');
  }

  const navItemBase = 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full text-left transition-colors';
  const navActive   = 'bg-brand-primary text-white';
  const navInactive = 'text-gray-300 hover:bg-gray-700';

  function adjustFont(delta: number) {
    setFontScale((prev) => Math.max(0.9, Math.min(1.3, Number((prev + delta).toFixed(2)))));
  }

  function adjustZoom(delta: number) {
    setZoomScale((prev) => Math.max(0.85, Math.min(1.15, Number((prev + delta).toFixed(2)))));
  }

  return (
    <aside
      className={`${collapsed ? 'w-20' : 'w-64'} bg-brand-dark fixed left-0 top-0 h-full z-30 flex flex-col transition-all duration-300`}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-700">
        {!collapsed && (
          <div className="font-secondary leading-tight">
            <div className="text-white font-bold tracking-wide text-base">LIEBE</div>
            <div className="text-gray-400 font-light text-xs tracking-wider">PRODUÇÃO</div>
          </div>
        )}
        <button
          onClick={toggle}
          className="text-gray-300 hover:text-white transition-colors ml-auto"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 overflow-y-auto">
        {!collapsed && (
          <div className="px-2 pb-2">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Principal</p>
          </div>
        )}
        <div className="space-y-1">
          <button
            onClick={() => router.push('/')}
            className={`${navItemBase} ${pathname === '/' ? navActive : navInactive}`}
          >
            <Factory size={20} className="shrink-0" />
            {!collapsed && <span>Plano de Produção</span>}
          </button>

          <button
            onClick={() => router.push('/projecoes')}
            className={`${navItemBase} ${pathname === '/projecoes' ? navActive : navInactive}`}
          >
            <TrendingDown size={20} className="shrink-0" />
            {!collapsed && <span>Projeções</span>}
          </button>

          <button
            onClick={() => router.push('/sugestao-plano')}
            className={`${navItemBase} ${pathname === '/sugestao-plano' ? navActive : navInactive}`}
          >
            <CalendarClock size={20} className="shrink-0" />
            {!collapsed && <span>Sugestão de Plano</span>}
          </button>

          <button
            onClick={() => router.push('/edicao-limitada')}
            className={`${navItemBase} ${pathname === '/edicao-limitada' ? navActive : navInactive}`}
          >
            <Sparkles size={20} className="shrink-0" />
            {!collapsed && <span>Edição Limitada</span>}
          </button>

          <button
            onClick={() => router.push('/sugestoes-aprovacoes')}
            className={`${navItemBase} ${pathname === '/sugestoes-aprovacoes' ? navActive : navInactive}`}
          >
            <CheckSquare size={20} className="shrink-0" />
            {!collapsed && <span>Sugestões/Aprovação</span>}
          </button>

          <button
            onClick={() => router.push('/capacidade')}
            className={`${navItemBase} ${pathname === '/capacidade' ? navActive : navInactive}`}
          >
            <Gauge size={20} className="shrink-0" />
            {!collapsed && <span>Capacidade</span>}
          </button>

          <button
            onClick={() => router.push('/configuracoes')}
            className={`${navItemBase} ${pathname === '/configuracoes' ? navActive : navInactive}`}
          >
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
            <button
              onClick={() => router.push('/analise-consumo-mp')}
              className={`${navItemBase} ${pathname === '/analise-consumo-mp' ? navActive : navInactive}`}
            >
              <Boxes size={20} className="shrink-0" />
              {!collapsed && <span>Análise Consumo MP</span>}
            </button>

            <button
              onClick={() => router.push('/laboratorio')}
              className={`${navItemBase} ${pathname === '/laboratorio' ? navActive : navInactive}`}
            >
              <FlaskConical size={20} className="shrink-0" />
              {!collapsed && <span>Laboratório</span>}
            </button>

            <button
              onClick={() => router.push('/diagnosticos')}
              className={`${navItemBase} ${pathname === '/diagnosticos' ? navActive : navInactive}`}
            >
              <ClipboardList size={20} className="shrink-0" />
              {!collapsed && <span>Diagnósticos</span>}
            </button>
          </div>
        </div>
      </nav>

      {/* Admin */}
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
                  <button
                    onClick={() => adjustFont(-0.05)}
                    className="h-8 w-8 rounded border border-gray-700 text-gray-200 hover:bg-gray-800"
                  >
                    -
                  </button>
                  <button
                    onClick={() => setFontScale(1)}
                    className="flex-1 h-8 rounded border border-gray-700 text-[11px] text-gray-300 hover:bg-gray-800"
                  >
                    Padrão
                  </button>
                  <button
                    onClick={() => adjustFont(0.05)}
                    className="h-8 w-8 rounded border border-gray-700 text-gray-200 hover:bg-gray-800"
                  >
                    +
                  </button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-xs text-gray-300 mb-1">
                  <span>Zoom</span>
                  <span>{Math.round(zoomScale * 100)}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => adjustZoom(-0.05)}
                    className="h-8 w-8 rounded border border-gray-700 text-gray-200 hover:bg-gray-800"
                  >
                    -
                  </button>
                  <button
                    onClick={() => setZoomScale(1)}
                    className="flex-1 h-8 rounded border border-gray-700 text-[11px] text-gray-300 hover:bg-gray-800"
                  >
                    Padrão
                  </button>
                  <button
                    onClick={() => adjustZoom(0.05)}
                    className="h-8 w-8 rounded border border-gray-700 text-gray-200 hover:bg-gray-800"
                  >
                    +
                  </button>
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

      {/* Sair */}
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
