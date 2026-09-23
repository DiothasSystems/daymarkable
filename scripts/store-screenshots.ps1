<#
.SYNOPSIS
  Capture the Play listing's phone screenshots from a connected Android device.

.DESCRIPTION
  Play wants 2-8 phone screenshots. Taking them by hand produces a set that drifts - a different
  status bar in each, a half-scrolled list, a notification that arrived mid-shot - so this walks
  the tabs itself and captures the same frames every time.

  Two things it does that a hand-taken set does not:

    * Android's demo mode for the status bar (full battery, a fixed clock, no notification icons).
      That is not cosmetic tidying; a real status bar puts the founder's unread counts and carrier
      in a public listing.
    * A fixed settle delay after each navigation, because these lists animate in and a capture
      taken mid-transition is what produces the faded half-frame nobody notices until it is live.

  It does NOT choose what account is signed in. Point the build at a seeded demo account first -
  see apps/mobile/store/README.md. A listing must never show real notes.

  NOTE: plain ASCII on purpose. PowerShell 5.1 reads .ps1 as ANSI unless the file carries a BOM,
  so a stray em dash becomes mojibake and the script fails to parse.

.PARAMETER Out
  Where the captures land. Defaults to apps/mobile/store/screenshots.

.PARAMETER Clock
  The time the status bar shows, HHMM.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\store-screenshots.ps1
#>
[CmdletBinding()]
param(
  [string]$Out,
  [string]$Clock = "0930"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Out) { $Out = Join-Path $repo "apps\mobile\store\screenshots" }
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$adb = Join-Path $sdk "platform-tools\adb.exe"
$pkg = "com.diothassystems.daymarkable"

if (-not (Test-Path $adb)) { throw "No adb at $adb. Set ANDROID_HOME." }
if ((& $adb devices | Select-String "\sdevice$").Count -ne 1) {
  throw "Expected exactly one connected device. Check 'adb devices'."
}

# A locked phone screenshots its lock screen, and adb cannot unlock it - that is the point of a
# lock screen. Say so rather than writing four pictures of the wallpaper.
if ((& $adb shell dumpsys window) -match "mDreamingLockscreen=true") {
  throw "The device is locked. Unlock it (and set the screen timeout long enough to finish), then re-run."
}

function Demo([string]$command, [string[]]$extras) {
  $call = @("shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", $command) + $extras
  & $adb @call | Out-Null
}

Write-Host "== status bar into demo mode" -ForegroundColor Cyan
& $adb shell settings put global sysui_demo_allowed 1 | Out-Null
Demo "enter" @()
Demo "clock" @("-e", "hhmm", $Clock)
Demo "battery" @("-e", "level", "100", "-e", "plugged", "false")
Demo "network" @("-e", "wifi", "show", "-e", "level", "4")
Demo "network" @("-e", "mobile", "hide")
Demo "notifications" @("-e", "visible", "false")

$size = (& $adb shell wm size) -join "" -replace ".*?(\d+)x(\d+).*", '$1 $2'
$w, $h = $size.Split(" ") | ForEach-Object { [int]$_ }
Write-Host "== $w x $h" -ForegroundColor Cyan

# Four tabs, so their centres are at one-eighth steps across the bar. The bar itself sits above
# the gesture area: 49dp of tab bar over a 24dp inset, which at this device's density puts the
# icons a little over 130px from the bottom.
$tabY = $h - [int]($h * 0.061)
function TapTab([int]$index) {
  & $adb shell input tap ([int]($w * (2 * $index + 1) / 8)) $tabY | Out-Null
  Start-Sleep -Milliseconds 1200
}

function Shot([string]$name) {
  # Capture on the device and pull the file. PowerShell decodes a native command's stdout as
  # text, so piping `adb exec-out screencap` into a file here would mangle the PNG.
  & $adb shell screencap -p /sdcard/dm-shot.png | Out-Null
  & $adb pull /sdcard/dm-shot.png (Join-Path $Out "$name.png") | Out-Null
  & $adb shell rm /sdcard/dm-shot.png | Out-Null
  Write-Host "  $name.png" -ForegroundColor Green
}

New-Item -ItemType Directory -Force -Path $Out | Out-Null

Write-Host "== restarting the app" -ForegroundColor Cyan
& $adb shell am force-stop $pkg | Out-Null
& $adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 | Out-Null
# The splash holds the lockup for 3s by design (app/_layout.tsx), plus fonts and the first fetch.
Start-Sleep -Seconds 8

$tabs = @("actions", "calendar", "notes", "more")
for ($i = 0; $i -lt $tabs.Count; $i++) {
  TapTab $i
  Shot ("{0}-{1}" -f ($i + 1), $tabs[$i])
}

Write-Host "== leaving demo mode" -ForegroundColor Cyan
Demo "exit" @()
Write-Host "== $Out" -ForegroundColor Green
