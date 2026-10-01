; Extra steps for the Windows installer (see bundle.windows.nsis in
; tauri.conf.json). The installer runs elevated (perMachine), so this is the
; one moment the app can do the two admin-only setup jobs without any extra
; prompts: open the firewall to the local network, and install the gamepad
; driver. Everything here is best-effort -- a failure leaves the app working
; and its own window offers the same fixes with one click.

!macro NSIS_HOOK_POSTINSTALL
  ; Replace any rules Windows made for this exe. Pressing Cancel on Windows'
  ; own first-run prompt creates *block* rules, which beat any allow rule.
  ; Remote addresses are limited to private ranges, which keeps the internet
  ; out. Not "localsubnet": that only matches the PC's own subnet, and many
  ; homes put the phone on a different one (mesh, extenders, two routers).
  nsExec::Exec 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\${MAINBINARYNAME}.exe"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Phone Controller Host"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Phone Controller Host" dir=in action=allow program="$INSTDIR\${MAINBINARYNAME}.exe" enable=yes profile=any remoteip=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,169.254.0.0/16,fc00::/7,fe80::/10'
  ; The same by port (the app's two ports and their fallbacks, ports.rs),
  ; in case Windows doesn't tie a connection to the exe's path.
  nsExec::Exec 'netsh advfirewall firewall add rule name="Phone Controller Host" dir=in action=allow protocol=TCP localport=8787-8799 enable=yes profile=any remoteip=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,169.254.0.0/16,fc00::/7,fe80::/10'

  ; Install ViGEmBus only if it isn't already there (sc exits non-zero for
  ; a service that doesn't exist).
  nsExec::ExecToStack 'sc query ViGEmBus'
  Pop $0
  Pop $1
  ${If} $0 != 0
  ${AndIf} ${FileExists} "$INSTDIR\drivers\ViGEmBus_Setup.exe"
    DetailPrint "Installing the ViGEmBus gamepad driver..."
    ExecWait '"$INSTDIR\drivers\ViGEmBus_Setup.exe"'
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Phone Controller Host"'
  ; The launch-at-login entry the app adds for the user (desktop.rs).
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PhoneControllerHost"
!macroend
