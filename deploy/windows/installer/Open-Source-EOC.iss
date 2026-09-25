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
DefaultDirName={localappdata}\Programs\Open Source EOC
DefaultGroupName=Open Source EOC
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
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

[Files]
Source: "{#StagedAppRoot}\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Open Source EOC"; Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Launch -Profile production"; WorkingDir: "{app}\app"
Name: "{group}\Open Source EOC Demo"; Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Launch -Profile demo"; WorkingDir: "{app}\app"
Name: "{group}\Uninstall Open Source EOC"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Open Source EOC"; Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Launch -Profile production"; WorkingDir: "{app}\app"; Tasks: desktopicon
Name: "{autodesktop}\Open Source EOC Demo"; Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Launch -Profile demo"; WorkingDir: "{app}\app"; Tasks: demodesktopicon

[Run]
Filename: "{app}\app\deploy\windows\Open Source EOC.cmd"; Parameters: "-Action Launch -Profile demo"; WorkingDir: "{app}\app"; Description: "Open the North Coast Storm demo"; Flags: postinstall nowait skipifsilent runhidden

[UninstallRun]
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
