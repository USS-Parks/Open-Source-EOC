#ifndef AppVersion
#error AppVersion must be passed by Build-Installer.ps1, which checks it against the stage.
#endif
#ifndef StagedAppRoot
#error StagedAppRoot must name the generated installer-stage app directory.
#endif

[Setup]
AppId={{C956C294-7F1A-4E98-86D8-4C8A8E2CB3A2}
AppName=Open Source EOC
AppVersion={#AppVersion}
AppPublisher=Open Source EOC Contributors
; Per user by default, in the user's own programs folder. Installing for all users,
; in Program Files, offers the network host.
DefaultDirName={autopf}\Open Source EOC
DefaultGroupName=Open Source EOC
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\out\installer
OutputBaseFilename=Open-Source-EOC-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\app\deploy\windows\Open Source EOC.cmd
InfoBeforeFile=installer-notice.txt

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "demodesktopicon"; Description: "Create a desktop shortcut for the North Coast Storm &demo"; GroupDescription: "Additional shortcuts:"
Name: "host"; Description: "&Host for the network: other computers and phones reach Open Source EOC on this computer over HTTPS"; GroupDescription: "Network host:"; Flags: unchecked; Check: IsAdminInstallMode
Name: "host\production"; Description: "With a new operational database and its first administrator"; Flags: exclusive
Name: "host\demo"; Description: "With the North Coast Storm demonstration"; Flags: exclusive unchecked

[Files]
Source: "{#StagedAppRoot}\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Open Source EOC"; Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Launch -Profile production"; WorkingDir: "{app}\app"
Name: "{group}\Open Source EOC Demo"; Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Launch -Profile demo"; WorkingDir: "{app}\app"
Name: "{group}\Open Source EOC on a network host"; Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Connect"; WorkingDir: "{app}\app"
Name: "{group}\Check the Open Source EOC host"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\app\deploy\windows\Test-OpenEOCHost.ps1"""; WorkingDir: "{app}\app"; Tasks: host
Name: "{group}\Uninstall Open Source EOC"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Open Source EOC"; Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Launch -Profile production"; WorkingDir: "{app}\app"; Tasks: desktopicon
Name: "{autodesktop}\Open Source EOC Demo"; Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Launch -Profile demo"; WorkingDir: "{app}\app"; Tasks: demodesktopicon

[Run]
; The host setup asks for the first administrator in its window, so it is not hidden.
Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action HostInstall -Profile host -Pause"; WorkingDir: "{app}\app"; StatusMsg: "Setting up the host for the network..."; Tasks: host\production; Flags: waituntilterminated
Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action HostInstall -Profile host-demo -Pause"; WorkingDir: "{app}\app"; StatusMsg: "Setting up the host for the network with the demonstration..."; Tasks: host\demo; Flags: waituntilterminated
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -NoExit -ExecutionPolicy Bypass -File ""{app}\app\deploy\windows\Test-OpenEOCHost.ps1"""; WorkingDir: "{app}\app"; Description: "Check the host now"; Tasks: host; Flags: postinstall nowait skipifsilent
Filename: "https://localhost/"; Description: "Open Open Source EOC on this host"; Tasks: host; Flags: postinstall shellexec nowait skipifsilent runasoriginaluser
Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Launch -Profile demo"; WorkingDir: "{app}\app"; Description: "Open the North Coast Storm demo"; Tasks: not host; Flags: postinstall nowait skipifsilent runhidden runasoriginaluser

[UninstallRun]
Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action HostRemove"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "OpenSourceEOCHostRemove"
Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Stop -Profile production"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "OpenSourceEOCStopProduction"
Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Stop -Profile demo"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "OpenSourceEOCStopDemo"

[Code]
function InitializeSetup(): Boolean;
begin
  if not IsWin64 then begin
    MsgBox('Open Source EOC requires 64-bit Windows.', mbError, MB_OK);
    Result := False;
  end else begin
    Result := True;
  end;
end;

{ An upgrade of a host stops its services before their programs are replaced;
  the host setup that runs after the files starts them again. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if IsAdminInstallMode then
    Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoLogo -NoProfile -NonInteractive -Command "Get-Service -Name ''OpenSourceEOC-*'' -ErrorAction SilentlyContinue | Stop-Service -Force"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
