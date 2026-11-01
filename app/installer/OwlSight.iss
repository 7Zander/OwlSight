; OwlSight Windows installer. GPL-3.0-or-later.
#ifndef AppVersion
 #error AppVersion is required
#endif
#ifndef BuildNumber
 #error BuildNumber is required
#endif
#ifndef ProgramDirectory
 #error ProgramDirectory is required
#endif
#ifndef OutputDirectory
 #error OutputDirectory is required
#endif
#ifndef IconFile
 #error IconFile is required
#endif
[Setup]
AppId={{C06E116D-8A7F-4B40-AE9C-63E34CC35698}
AppName=OwlSight
AppVersion={#AppVersion}
AppVerName=OwlSight {#AppVersion}
AppPublisher=OwlSight
AppPublisherURL=https://github.com/7Zander/OwlSight
AppSupportURL=https://github.com/7Zander/OwlSight/issues
AppUpdatesURL=https://github.com/7Zander/OwlSight/releases/latest
DefaultDirName={userpf}\OwlSight
UsePreviousAppDir=yes
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
AppMutex=Local\OwlSight.Running
SetupMutex=Local\OwlSight.Setup
CloseApplications=yes
RestartApplications=no
ChangesAssociations=yes
UninstallDisplayIcon={app}\OwlSight.exe
OutputDir={#OutputDirectory}
OutputBaseFilename=OwlSight-{#AppVersion}-Setup-x64
SetupIconFile={#IconFile}
VersionInfoVersion={#AppVersion}.{#BuildNumber}
LicenseFile={#ProgramDirectory}\LICENSE
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
chinesesimp.DesktopIcon=创建桌面快捷方式
english.DesktopIcon=Create a desktop shortcut
chinesesimp.DefaultExr=设置为 EXR 默认打开程序（安装后在 Windows 中确认）
english.DefaultExr=Use OwlSight for EXR files (confirm in Windows after installation)
chinesesimp.LaunchApp=启动 OwlSight
english.LaunchApp=Launch OwlSight

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; Flags: unchecked
Name: "exrdefault"; Description: "{cm:DefaultExr}"; Flags: unchecked; Check: not IsUpdating

[Files]
Source: "{#ProgramDirectory}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\OwlSight"; Filename: "{app}\OwlSight.exe"; WorkingDir: "{app}"; AppUserModelID: "7Zander.OwlSight"
Name: "{autodesktop}\OwlSight"; Filename: "{app}\OwlSight.exe"; WorkingDir: "{app}"; AppUserModelID: "7Zander.OwlSight"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\OwlSight.EXR"; ValueType: string; ValueData: "OpenEXR Image"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\OwlSight.EXR\DefaultIcon"; ValueType: string; ValueData: """{app}\OwlSight.exe"",0"
Root: HKCU; Subkey: "Software\Classes\OwlSight.EXR\shell\open\command"; ValueType: string; ValueData: """{app}\OwlSight.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\OwlSight.EXR\Application"; ValueType: string; ValueName: "ApplicationName"; ValueData: "OwlSight"
Root: HKCU; Subkey: "Software\Classes\OwlSight.EXR\Application"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: """{app}\OwlSight.exe"",0"
Root: HKCU; Subkey: "Software\Classes\.exr\OpenWithProgids"; ValueType: string; ValueName: "OwlSight.EXR"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\OwlSight\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "OwlSight"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\OwlSight\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "OwlSight EXR image and sequence viewer"
Root: HKCU; Subkey: "Software\OwlSight\Capabilities"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: """{app}\OwlSight.exe"",0"
Root: HKCU; Subkey: "Software\OwlSight\Capabilities\FileAssociations"; ValueType: string; ValueName: ".exr"; ValueData: "OwlSight.EXR"
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "OwlSight"; ValueData: "Software\OwlSight\Capabilities"; Flags: uninsdeletevalue

[Run]
Filename: "ms-settings:defaultapps?registeredAppUser=OwlSight"; Flags: shellexec nowait skipifsilent; Check: OpenDefaultsRequested
Filename: "{app}\OwlSight.exe"; Description: "{cm:LaunchApp}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
function IsUpdating: Boolean;
begin
  Result := ExpandConstant('{param:UPDATE|0}') = '1';
end;

function OpenDefaultsRequested: Boolean;
begin
  Result := (not IsUpdating) and WizardIsTaskSelected('exrdefault');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Cache, Target: String;
begin
  if CurStep = ssDone then begin
    Cache := ExpandConstant('{localappdata}\OwlSight\installers');
    Target := Cache + '\OwlSight-{#AppVersion}-build-{#BuildNumber}-Setup-x64.exe';
    if ForceDirectories(Cache) then
      if not FileCopy(ExpandConstant('{srcexe}'), Target, False) then
        Log('Could not retain the installer for manual rollback.');
  end;
end;
