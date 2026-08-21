#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Servico Windows para o sincronizador de MP cadastro.

Comandos:
    python scripts\mp_cadastro_windows_service.py install
    python scripts\mp_cadastro_windows_service.py start
    python scripts\mp_cadastro_windows_service.py stop
    python scripts\mp_cadastro_windows_service.py remove
"""

import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

import servicemanager
import win32api
import win32con
import win32event
import win32service
import win32serviceutil

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sync_mp_cadastro import connect_db, sync_once  # noqa: E402


SERVICE_NAME = "LiebeMPCadastroSync"
SERVICE_DISPLAY_NAME = "Liebe MP Cadastro Sync"
SERVICE_DESCRIPTION = "Sincroniza app_mp_cadastro com novas necessidades de MP e registra alteracoes em tabela auxiliar."
INTERVAL_SECONDS = int(os.getenv("MP_CADASTRO_SYNC_INTERVAL", "300"))


def log(message):
    log_dir = ROOT / "logs"
    log_dir.mkdir(exist_ok=True)
    path = log_dir / "sync_mp_cadastro_service.log"
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"[{datetime.now().isoformat(timespec='seconds')}] {message}\n")


class MpCadastroSyncService(win32serviceutil.ServiceFramework):
    _svc_name_ = SERVICE_NAME
    _svc_display_name_ = SERVICE_DISPLAY_NAME
    _svc_description_ = SERVICE_DESCRIPTION

    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)
        self.stop_event = win32event.CreateEvent(None, 0, 0, None)
        self.running = True

    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        self.running = False
        win32event.SetEvent(self.stop_event)
        log("Parando servico")

    def SvcDoRun(self):
        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STARTED,
            (self._svc_name_, ""),
        )
        os.chdir(ROOT)
        log("Servico iniciado")

        while self.running:
            try:
                with connect_db() as conn:
                    result = sync_once(conn, dry_run=False)
                log(f"OK atuais={result['current']} novos={result['new']} alteracoes={result['changed']}")
            except Exception:
                log("ERRO\n" + traceback.format_exc())

            rc = win32event.WaitForSingleObject(self.stop_event, INTERVAL_SECONDS * 1000)
            if rc == win32event.WAIT_OBJECT_0:
                break

        log("Servico parado")


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] in {"install-direct", "remove-direct", "start-direct", "stop-direct"}:
        command = sys.argv[1]
        if command == "install-direct":
            exe_name = str(Path(sys.exec_prefix) / "pythonservice.exe")
            class_string = win32serviceutil.GetServiceClassString(MpCadastroSyncService)
            win32serviceutil.InstallService(
                class_string,
                SERVICE_NAME,
                SERVICE_DISPLAY_NAME,
                startType=win32service.SERVICE_AUTO_START,
                exeName=exe_name,
                description=SERVICE_DESCRIPTION,
            )
            key = win32api.RegCreateKey(
                win32con.HKEY_LOCAL_MACHINE,
                f"System\\CurrentControlSet\\Services\\{SERVICE_NAME}\\Parameters",
            )
            try:
                win32api.RegSetValueEx(key, "Application", 0, win32con.REG_SZ, str(Path(__file__).resolve()))
                win32api.RegSetValueEx(key, "AppDirectory", 0, win32con.REG_SZ, str(ROOT))
            finally:
                win32api.RegCloseKey(key)
            print(f"Servico instalado: {SERVICE_DISPLAY_NAME}")
        elif command == "remove-direct":
            try:
                win32serviceutil.StopService(SERVICE_NAME)
                time.sleep(2)
            except Exception:
                pass
            win32serviceutil.RemoveService(SERVICE_NAME)
            print(f"Servico removido: {SERVICE_DISPLAY_NAME}")
        elif command == "start-direct":
            win32serviceutil.StartService(SERVICE_NAME)
            print(f"Servico iniciado: {SERVICE_DISPLAY_NAME}")
        elif command == "stop-direct":
            win32serviceutil.StopService(SERVICE_NAME)
            print(f"Servico parado: {SERVICE_DISPLAY_NAME}")
        sys.exit(0)

    if len(sys.argv) == 1:
        sys.argv.append("help")
    win32serviceutil.HandleCommandLine(MpCadastroSyncService)
