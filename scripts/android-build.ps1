<#
.SYNOPSIS
  Build the Android app locally: prebuild, patch around Windows MAX_PATH, assemble, install.

.DESCRIPTION
  `expo prebuild` regenerates apps/mobile/android/ from app.json and discards anything already in
  there, so the path workaround cannot live in a committed file. It is re-applied here on every
  run, which is the whole reason this script exists rather than a line in the README.

  What the workaround does, and why it needs both halves:

    * Every native module's buildDir moves to C:\dmb\b\<name>. Codegen writes C++ sources under
      that directory, and CMake mangles a source's FULL path into its object filename, so a
      generated source at a long path produces an object path far longer still.
    * Every module's CMake staging directory (.cxx) moves to C:\dmb\c\<name>, which shortens the
      other half of that same object path.

  Neither alone is enough; the failure simply moves to the next module. Together they bring the
  longest object path under Windows' 260-character limit.

  Moving buildDir has a casualty: the CMake side never hears about it. React Native's generated
  Android-autolinking.cmake add_subdirectory()s <module>/android/build/generated/source/codegen/jni
  for every autolinked module, and Reanimated and Worklets hardcode ${CMAKE_SOURCE_DIR}/build in
  their own CMakeLists. Gradle writes the codegen to C:\dmb\b\<name>\generated; CMake looks under
  node_modules and finds nothing:

      fatal error: 'react/renderer/components/rnreanimated/Props.h' file not found
      add_subdirectory given source ".../datetimepicker/android/build/generated/source/codegen/jni/"
      which is not an existing directory

  So every subproject gets a junction from the path CMake insists on to the path the output is
  actually at. That is done in the gradle patch, which is the one place that knows both a module's
  own directory and the name its relocated build dir was given.

  A junction survives prebuild (which does not touch node_modules) but not a package reinstall, so
  it is re-made every run like the patch itself.

  NOTE: this file is deliberately plain ASCII. PowerShell 5.1 reads .ps1 as ANSI unless the file
  carries a BOM, so a stray em dash becomes mojibake and the script fails to parse.

  The durable fixes, if local Android builds become routine here, are to enable LongPathsEnabled
  and reboot, or to keep the repo somewhere shorter than OneDrive\Documents. See
  docs/MOBILE_PLAN.md section 13a.

.PARAMETER ApiUrl
  Baked into the build as EXPO_PUBLIC_API_URL. Defaults to production.

.PARAMETER Abi
  Which ABI to build. One is much faster than four, and arm64-v8a covers every modern phone.

.PARAMETER Install
  Install onto the connected device with adb when the build succeeds.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\android-build.ps1 -Install
#>
[CmdletBinding()]
param(
  [string]$ApiUrl = "https://app.daymarkable.com",
  [string]$Abi = "arm64-v8a",
  [switch]$Install
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$mobile = Join-Path $repo "apps\mobile"
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$jdk = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { "C:\Program Files\Android\Android Studio\jbr" }

if (-not (Test-Path $sdk)) { throw "No Android SDK at $sdk. Set ANDROID_HOME." }
if (-not (Test-Path $jdk)) { throw "No JDK at $jdk. Set JAVA_HOME; Android Studio ships one in jbr." }

Write-Host "== prebuild" -ForegroundColor Cyan
Push-Location $mobile
try {
  $env:ANDROID_HOME = $sdk
  & npx expo prebuild --platform android --clean
  if ($LASTEXITCODE -ne 0) { throw "prebuild failed" }
} finally { Pop-Location }

Write-Host "== patching android/build.gradle for MAX_PATH" -ForegroundColor Cyan
$gradleFile = Join-Path $mobile "android\build.gradle"
$patch = @'
// Re-applied by scripts/android-build.ps1 after every prebuild. See that script for why.
def shortRoot = new File("C:/dmb")
subprojects { sub ->
  def relocated = new File(shortRoot, "b/" + sub.name)
  sub.buildDir = relocated

  // Point the module's own build/ at the relocated one.
  //
  // React Native's generated Android-autolinking.cmake add_subdirectory()s
  // <module>/android/build/generated/source/codegen/jni for every autolinked module, and
  // Reanimated and Worklets hardcode ${CMAKE_SOURCE_DIR}/build in their CMakeLists. None of them
  // ask Gradle where the build directory went, so moving it leaves them looking at a path nothing
  // writes to any more. A junction is what makes both answers the same directory.
  //
  // This is done here rather than in the PowerShell because here is the one place that knows both
  // halves: the module's own directory and the name its relocated build dir was given.
  def legacy = new File(sub.projectDir, "build")
  if (!legacy.exists()) {
    relocated.mkdirs()
    def make = ["cmd", "/c", "mklink", "/J", legacy.absolutePath, relocated.absolutePath].execute()
    make.waitFor()
    if (make.exitValue() != 0) {
      throw new GradleException("could not link ${legacy} to ${relocated}: ${make.err.text}")
    }
  }

  def relocateCxx = {
    try {
      sub.android.externalNativeBuild.cmake.buildStagingDirectory = new File(shortRoot, "c/" + sub.name)
    } catch (ignored) {
      // No native build in this module; nothing to relocate.
    }
  }
  sub.plugins.withId("com.android.library") { relocateCxx() }
  sub.plugins.withId("com.android.application") { relocateCxx() }
}

'@
$content = Get-Content $gradleFile -Raw
$anchor = 'apply plugin: "expo-root-project"'
if ($content -notmatch [regex]::Escape($anchor)) { throw "android/build.gradle has no expo-root-project line to anchor to" }
# WriteAllText with a BOM-less encoder: PowerShell 5.1's `-Encoding utf8` emits a BOM, and
# Gradle refuses the file with "Unexpected character" on line 1.
[System.IO.File]::WriteAllText($gradleFile, $content.Replace($anchor, $patch + $anchor), (New-Object System.Text.UTF8Encoding $false))

# The gradle patch junctions <module>/android/build to the relocated build dir, but only when
# nothing is there. A REAL directory left by an older build would satisfy that test and then
# shadow the junction with codegen headers nothing regenerates any more - which is the
# stale-but-load-bearing state that made this failure so confusing the first time it appeared.
Write-Host "== clearing unrelocated build dirs under node_modules" -ForegroundColor Cyan
$stale = Get-ChildItem (Join-Path $repo "node_modules") -Directory -Filter build -Recurse -Depth 3 -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -like "*\android\build" -and $_.LinkType -ne "Junction" }
foreach ($s in $stale) {
  Remove-Item -Recurse -Force $s.FullName
  Write-Host "  $($s.FullName)"
}

Write-Host "== assembleRelease ($Abi, API $ApiUrl)" -ForegroundColor Cyan
Push-Location (Join-Path $mobile "android")
try {
  $env:JAVA_HOME = $jdk
  $env:EXPO_PUBLIC_API_URL = $ApiUrl
  & .\gradlew.bat assembleRelease --no-daemon "-PreactNativeArchitectures=$Abi"
  if ($LASTEXITCODE -ne 0) { throw "gradle build failed" }
} finally { Pop-Location }

# The patch moves every module's buildDir, the app module included, so the apk lands under
# the short root rather than in android/app/build. Look in both, newest first.
$apk = @("C:\dmb\b\app\outputs\apk\release", (Join-Path $mobile "android\app\build\outputs\apk\release")) |
  Where-Object { Test-Path $_ } |
  ForEach-Object { Get-ChildItem $_ -Filter "*.apk" -Recurse -ErrorAction SilentlyContinue } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $apk) { throw "build reported success but produced no apk" }
Write-Host "== built $($apk.FullName) ($([math]::Round($apk.Length / 1MB, 1)) MB)" -ForegroundColor Green

if ($Install) {
  $adb = Join-Path $sdk "platform-tools\adb.exe"
  Write-Host "== installing on the connected device" -ForegroundColor Cyan
  & $adb install -r $apk.FullName
  if ($LASTEXITCODE -ne 0) { throw "adb install failed" }
  Write-Host "== installed" -ForegroundColor Green
}
