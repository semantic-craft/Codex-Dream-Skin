#ifndef AppVersion
  #error AppVersion must be supplied by build-release.ps1
#endif
#ifndef StageRoot
  #error StageRoot must be supplied by build-release.ps1
#endif
#ifndef OutputDir
  #error OutputDir must be supplied by build-release.ps1
#endif

#define AppName "Codex Dream Skin"
#define AppPublisher "Codex Dream Skin contributors"
#define AppUrl "https://dreamskin.cc"
#define PowerShellPath "{sysnative}\WindowsPowerShell\v1.0\powershell.exe"

[Setup]
AppId={{DCCDAF1A-9ACD-4AAB-B55B-DF17EB2CDA2E}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}
AppUpdatesURL=https://github.com/Fei-Away/Codex-Dream-Skin/releases
DefaultDirName={localappdata}\Programs\CodexDreamSkin
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
OutputDir={#OutputDir}
OutputBaseFilename=CodexDreamSkin-Setup-v{#AppVersion}
SetupIconFile={#StageRoot}\payload\assets\codex-dream-skin.ico
UninstallDisplayIcon={app}\payload\assets\codex-dream-skin.ico
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} installer
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
CloseApplications=no
RestartApplications=no
RestartIfNeededByRun=no
ChangesAssociations=no
ChangesEnvironment=no
UsePreviousTasks=yes
SetupLogging=yes
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "startup"; Description: "Start Codex Dream Skin when I sign in"; GroupDescription: "Additional options:"; Flags: unchecked

[Files]
Source: "{#StageRoot}\setup-bootstrap.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageRoot}\payload\*"; DestDir: "{app}\payload"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Codex Dream Skin"; Filename: "{#PowerShellPath}"; Parameters: "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File ""{app}\setup-bootstrap.ps1"" -LaunchTray"; WorkingDir: "{app}"; IconFilename: "{app}\payload\assets\codex-dream-skin.ico"
Name: "{userstartup}\Codex Dream Skin"; Filename: "{#PowerShellPath}"; Parameters: "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File ""{app}\setup-bootstrap.ps1"" -LaunchTray"; WorkingDir: "{app}"; IconFilename: "{app}\payload\assets\codex-dream-skin.ico"; Tasks: startup

[Run]
Filename: "{#PowerShellPath}"; Parameters: "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File ""{app}\setup-bootstrap.ps1"" -LaunchTray"; WorkingDir: "{app}"; Description: "Launch Codex Dream Skin"; Flags: nowait postinstall skipifsilent

[Code]
function PowerShellArguments(const ActionArguments: String; const Silent: Boolean): String;
begin
  Result := '-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File ' +
    AddQuotes(ExpandConstant('{app}\setup-bootstrap.ps1')) + ' ' + ActionArguments;
  if Silent then
    Result := Result + ' -Silent';
end;

function RunBootstrap(
  const ActionArguments: String;
  const Silent: Boolean;
  var ExitCode: Integer
): Boolean;
begin
  Result := Exec(
    ExpandConstant('{#PowerShellPath}'),
    PowerShellArguments(ActionArguments, Silent),
    ExpandConstant('{app}'),
    SW_HIDE,
    ewWaitUntilTerminated,
    ExitCode
  );
end;

function InstallInitializationFailureMessage(const ExitCode: Integer): String;
begin
  Result := Format(
    'Codex Dream Skin could not be initialized (exit code %d). Setup will roll back the installed files.',
    [ExitCode]
  );
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ExitCode: Integer;
begin
  if CurStep <> ssPostInstall then
    exit;

  if not RunBootstrap('', WizardSilent, ExitCode) then
    RaiseException('Codex Dream Skin initialization could not be started.');
  if ExitCode <> 0 then
    RaiseException(InstallInitializationFailureMessage(ExitCode));
end;

function InitializeUninstall(): Boolean;
var
  ExitCode: Integer;
begin
  Result := False;
  if not RunBootstrap('-Uninstall', UninstallSilent, ExitCode) then
  begin
    if not UninstallSilent then
      MsgBox(
        'Codex Dream Skin restoration could not be started. No installed files were removed.',
        mbError,
        MB_OK
      );
    exit;
  end;

  if ExitCode <> 0 then
  begin
    if not UninstallSilent then
      MsgBox(
        Format('Codex Dream Skin could not restore Codex (exit code %d). No installed files were removed.', [ExitCode]),
        mbError,
        MB_OK
      );
    exit;
  end;

  Result := True;
end;
