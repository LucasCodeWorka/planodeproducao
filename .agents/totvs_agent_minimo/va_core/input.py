"""Mouse e teclado para a janela do Virtual Age (GO-Global / Uniface Anywhere).

Validado empiricamente nesta instalacao (ver testes em tests/):
  - clique  : PostMessage WM_*BUTTON*      -> funciona em SEGUNDO PLANO
  - teclado : VK + SHIFT explicito + WM_CHAR -> funciona em SEGUNDO PLANO
              e preserva maiusculas/minusculas (WM_CHAR sozinho nao preserva)
  - captura : PrintWindow                  -> funciona em SEGUNDO PLANO

Consequencia: o agente opera o ERP sem roubar o mouse/teclado do usuario.
As funcoes fg_* existem como plano B caso alguma tela ignore mensagens.
"""
import ctypes
import time
from ctypes import wintypes

import win32api
import win32con
import win32gui

user32 = ctypes.windll.user32
user32.SetProcessDPIAware()

MAPVK_VK_TO_VSC = 0

VK = {
    "enter": 0x0D, "return": 0x0D, "tab": 0x09, "esc": 0x1B, "escape": 0x1B,
    "space": 0x20, "backspace": 0x08, "delete": 0x2E, "insert": 0x2D,
    "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22,
    "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27,
    "ctrl": 0x11, "control": 0x11, "alt": 0x12, "shift": 0x10,
    **{f"f{i}": 0x6F + i for i in range(1, 13)},
}
_EXTENDED = {0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x26, 0x28, 0x25, 0x27}


# --------------------------------------------------------------- utilitarios

def _client_offset(hwnd):
    """Deslocamento entre coords de janela (as do screenshot) e coords de
    cliente (as que as mensagens do Windows esperam)."""
    l, t, _, _ = win32gui.GetWindowRect(hwnd)
    cl, ct = win32gui.ClientToScreen(hwnd, (0, 0))
    return cl - l, ct - t


def _lparam_pos(hwnd, x, y):
    dx, dy = _client_offset(hwnd)
    cx, cy = int(x) - dx, int(y) - dy
    return (cy << 16) | (cx & 0xFFFF)


def _lparam_key(vk, up=False, repeat=1):
    scan = win32api.MapVirtualKey(vk, MAPVK_VK_TO_VSC)
    lp = repeat | (scan << 16)
    if vk in _EXTENDED:
        lp |= 1 << 24
    if up:
        lp |= (1 << 30) | (1 << 31)
    return lp


# ------------------------------------------------------------------ mouse bg

def click(hwnd, x, y, button="left", double=False, settle=0.12):
    """Clique em segundo plano. x,y sao coords da JANELA (as do screenshot)."""
    lp = _lparam_pos(hwnd, x, y)
    if button == "right":
        down, up, mk = win32con.WM_RBUTTONDOWN, win32con.WM_RBUTTONUP, win32con.MK_RBUTTON
    else:
        down, up, mk = win32con.WM_LBUTTONDOWN, win32con.WM_LBUTTONUP, win32con.MK_LBUTTON
    win32gui.PostMessage(hwnd, win32con.WM_MOUSEMOVE, 0, lp)
    time.sleep(0.03)
    for i in range(2 if double else 1):
        win32gui.PostMessage(hwnd, down, mk, lp)
        time.sleep(0.04)
        win32gui.PostMessage(hwnd, up, 0, lp)
        time.sleep(0.05 if double and i == 0 else settle)


def double_click(hwnd, x, y):
    click(hwnd, x, y, double=True)


def right_click(hwnd, x, y):
    click(hwnd, x, y, button="right")


def scroll(hwnd, x, y, amount):
    """amount > 0 sobe, < 0 desce (em cliques de roda)."""
    l, t, _, _ = win32gui.GetWindowRect(hwnd)
    lp = ((int(t + y)) << 16) | (int(l + x) & 0xFFFF)   # WM_MOUSEWHEEL usa coords de TELA
    wp = (int(amount) * 120) << 16
    win32gui.PostMessage(hwnd, win32con.WM_MOUSEWHEEL, wp, lp)
    time.sleep(0.15)


# --------------------------------------------------------------- teclado bg

def _tap(hwnd, vk, hold_shift=False, hold_ctrl=False, hold_alt=False, ch=None):
    modifiers = [
        VK[name]
        for enabled, name in ((hold_ctrl, "ctrl"), (hold_alt, "alt"), (hold_shift, "shift"))
        if enabled
    ]
    for modifier in modifiers:
        win32gui.PostMessage(hwnd, win32con.WM_KEYDOWN, modifier, _lparam_key(modifier))
        time.sleep(0.02)
    win32gui.PostMessage(hwnd, win32con.WM_KEYDOWN, vk, _lparam_key(vk))
    if ch is not None:
        win32gui.PostMessage(hwnd, win32con.WM_CHAR, ord(ch), _lparam_key(vk))
    time.sleep(0.02)
    win32gui.PostMessage(hwnd, win32con.WM_KEYUP, vk, _lparam_key(vk, True))
    for modifier in reversed(modifiers):
        time.sleep(0.02)
        win32gui.PostMessage(hwnd, win32con.WM_KEYUP, modifier, _lparam_key(modifier, True))


def type_text(hwnd, text, delay=0.05):
    """Digita preservando maiusculas/minusculas e acentos."""
    for ch in text:
        st = win32api.VkKeyScan(ch)
        if st == -1:                      # caractere fora do layout: so WM_CHAR
            win32gui.PostMessage(hwnd, win32con.WM_CHAR, ord(ch), 0)
        else:
            modifiers = st >> 8
            _tap(hwnd, st & 0xFF,
                 hold_shift=bool(modifiers & 1),
                 hold_ctrl=bool(modifiers & 2),
                 hold_alt=bool(modifiers & 4), ch=ch)
        time.sleep(delay)


def key(hwnd, combo, delay=0.06):
    """combo: 'enter', 'tab', 'f5', 'ctrl+a', 'alt+s', 'shift+tab'."""
    parts = [p.strip().lower() for p in combo.split("+")]
    mods, main = parts[:-1], parts[-1]
    codes = []
    for m in mods:
        if m not in VK:
            raise ValueError(f"modificador desconhecido: {m}")
        codes.append(VK[m])
    if main in VK:
        vk_main, ch = VK[main], None
    elif len(main) == 1:
        st = win32api.VkKeyScan(main)
        vk_main, ch = st & 0xFF, (None if mods else main)
    else:
        raise ValueError(f"tecla desconhecida: {main}")

    for c in codes:
        win32gui.PostMessage(hwnd, win32con.WM_KEYDOWN, c, _lparam_key(c))
        time.sleep(0.02)
    win32gui.PostMessage(hwnd, win32con.WM_KEYDOWN, vk_main, _lparam_key(vk_main))
    if ch is not None:
        win32gui.PostMessage(hwnd, win32con.WM_CHAR, ord(ch), _lparam_key(vk_main))
    time.sleep(0.03)
    win32gui.PostMessage(hwnd, win32con.WM_KEYUP, vk_main, _lparam_key(vk_main, True))
    for c in reversed(codes):
        time.sleep(0.02)
        win32gui.PostMessage(hwnd, win32con.WM_KEYUP, c, _lparam_key(c, True))
    time.sleep(delay)


def clear_field(hwnd, x=None, y=None, n=60):
    """Limpa um campo de texto. Se x,y vierem, clica nele antes."""
    if x is not None:
        click(hwnd, x, y)
        time.sleep(0.15)
    key(hwnd, "end")
    for _ in range(n):
        _tap(hwnd, VK["backspace"])
        time.sleep(0.008)
    for _ in range(4):
        _tap(hwnd, VK["delete"])
        time.sleep(0.01)
    time.sleep(0.15)


def set_field(hwnd, x, y, text):
    """Clica, limpa e digita — o combo mais usado em formulario de ERP."""
    clear_field(hwnd, x, y)
    type_text(hwnd, text)


# ---------------------------------------------------- plano B: input real

def focus(hwnd):
    """Traz a janela para frente (contorna o bloqueio do Windows)."""
    if win32gui.IsIconic(hwnd):
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    fg = user32.GetForegroundWindow()
    if fg == hwnd:
        return True
    cur = ctypes.windll.kernel32.GetCurrentThreadId()
    other = user32.GetWindowThreadProcessId(fg, None)
    att = user32.AttachThreadInput(cur, other, True) if other else False
    try:
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
    finally:
        if att:
            user32.AttachThreadInput(cur, other, False)
    time.sleep(0.15)
    return user32.GetForegroundWindow() == hwnd
