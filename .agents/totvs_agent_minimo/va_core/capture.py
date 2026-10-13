"""Captura de tela da janela do Virtual Age (bitmap remoto GO-Global)."""
import ctypes
from ctypes import wintypes

import win32con
import win32gui
import win32ui
from PIL import Image

user32 = ctypes.windll.user32
user32.SetProcessDPIAware()

PW_RENDERFULLCONTENT = 0x00000002


def find_window(title="TOTVS Moda", cls="DisplayClientWindowClass"):
    """Acha a janela principal da sessao: maior janela visivel com esse titulo."""
    hits = []

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        if win32gui.GetWindowText(hwnd) != title:
            return True
        if cls and win32gui.GetClassName(hwnd) != cls:
            return True
        l, t, r, b = win32gui.GetWindowRect(hwnd)
        hits.append((( r - l) * (b - t), hwnd))
        return True

    win32gui.EnumWindows(cb, None)
    if not hits:
        return None
    return max(hits)[1]


def rect(hwnd):
    l, t, r, b = win32gui.GetWindowRect(hwnd)
    return {"left": l, "top": t, "right": r, "bottom": b, "w": r - l, "h": b - t}


def _grab(hwnd, flags):
    l, t, r, b = win32gui.GetWindowRect(hwnd)
    w, h = r - l, b - t
    hwnd_dc = win32gui.GetWindowDC(hwnd)
    src = win32ui.CreateDCFromHandle(hwnd_dc)
    dst = src.CreateCompatibleDC()
    bmp = win32ui.CreateBitmap()
    bmp.CreateCompatibleBitmap(src, w, h)
    dst.SelectObject(bmp)
    ok = user32.PrintWindow(hwnd, dst.GetSafeHdc(), flags)
    info = bmp.GetInfo()
    bits = bmp.GetBitmapBits(True)
    img = Image.frombuffer("RGB", (info["bmWidth"], info["bmHeight"]),
                           bits, "raw", "BGRX", 0, 1)
    win32gui.DeleteObject(bmp.GetHandle())
    dst.DeleteDC()
    src.DeleteDC()
    win32gui.ReleaseDC(hwnd, hwnd_dc)
    return ok, img


def _is_blank(img, tol=6):
    ex = img.convert("L").getextrema()
    return (ex[1] - ex[0]) < tol


def capture(hwnd, allow_foreground=True):
    """Devolve (PIL.Image, metodo). Tenta sem roubar o foco; se vier preto,
    traz a janela para frente e recorta da tela."""
    for flags, name in ((PW_RENDERFULLCONTENT, "printwindow-full"), (0, "printwindow")):
        try:
            ok, img = _grab(hwnd, flags)
            if ok and not _is_blank(img):
                return img, name
        except Exception:
            pass
    if not allow_foreground:
        return None, "falhou"
    # fallback: foreground + recorte do desktop
    from PIL import ImageGrab
    try:
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
    except Exception:
        pass
    import time
    time.sleep(0.35)
    r = rect(hwnd)
    img = ImageGrab.grab(bbox=(r["left"], r["top"], r["right"], r["bottom"]),
                         all_screens=True)
    return img, "desktop-crop"


if __name__ == "__main__":
    import sys, io, time
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    h = find_window()
    print("hwnd:", h)
    if not h:
        raise SystemExit("janela 'TOTVS Moda' nao encontrada")
    print("rect:", rect(h))
    for fg in (False, True):
        t0 = time.time()
        img, how = capture(h, allow_foreground=fg)
        dt = (time.time() - t0) * 1000
        if img is None:
            print(f"allow_foreground={fg}: FALHOU ({how})")
            continue
        path = f"totvs_agent_minimo/shots/probe_{how}.png"
        img.save(path)
        print(f"allow_foreground={fg}: metodo={how} {img.size} "
              f"{dt:.0f}ms preto={_is_blank(img)} -> {path}")
