# Fresh isolated native test vault: recycle .test-vault/.test-profile, prepare the
# synthetic vault with the current dist (or -MainJs), launch Obsidian with loopback
# debugging, accept trust, close normally and relaunch so dialogs work.
param([string]$MainJs = '')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$root = (Get-Location).Path
# Obsidian's standard install location, unless planner.local.json names another.
$exe = "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe"
if (Test-Path "$root\planner.local.json") { $local = Get-Content "$root\planner.local.json" -Raw | ConvertFrom-Json; if ($local.obsidianExe) { $exe = $local.obsidianExe } }
$launch = "--user-data-dir=$root\.test-profile", '--remote-debugging-port=9237'
function Stop-Test {
  $p = @(Get-CimInstance Win32_Process -Filter "Name = 'Obsidian.exe'" | Where-Object { $_.CommandLine -like "*--user-data-dir=$root\.test-profile*" })
  foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 2
}
try { node tools/native-close.mjs | Out-Null; Start-Sleep 4 } catch { }
Stop-Test
Add-Type -AssemblyName Microsoft.VisualBasic
foreach ($d in "$root\.test-vault", "$root\.test-profile") {
  if (Test-Path -LiteralPath $d) {
    $item = Get-Item -LiteralPath $d -Force
    if ($item.LinkType) { throw "Refusing link: $d" }
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($d, 'OnlyErrorDialogs', 'SendToRecycleBin')
  }
}
node tools/prepare-test-vault.mjs | Out-Null
if ($MainJs) { Copy-Item -LiteralPath $MainJs -Destination '.test-vault\.obsidian\plugins\thejaz-planner\main.js' -Force }
Start-Process -FilePath $exe -ArgumentList $launch -WindowStyle Hidden; Start-Sleep 10
node tools/native-trust.mjs | Out-Null; Start-Sleep 3
node tools/native-close.mjs | Out-Null; Start-Sleep 5
Stop-Test
Start-Process -FilePath $exe -ArgumentList $launch -WindowStyle Hidden; Start-Sleep 10
node tools/native-trust.mjs
"main.js " + (Get-FileHash '.test-vault\.obsidian\plugins\thejaz-planner\main.js').Hash.Substring(0, 16)
