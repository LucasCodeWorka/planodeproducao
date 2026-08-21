Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
batPath = projectRoot & "\scripts\run_sync_mp_cadastro.bat"
shell.Run """" & batPath & """", 0, False
