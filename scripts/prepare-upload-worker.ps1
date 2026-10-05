param([string]$Destination = 'supabase/.temp/upload-worker-source')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDestination = [IO.Path]::GetFullPath((Join-Path $taskRoot $Destination))
$taskAllowedRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'supabase/.temp')) + [IO.Path]::DirectorySeparatorChar
if (-not $taskDestination.StartsWith($taskAllowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Build context must stay inside the ignored workspace temp directory.' }
if (Test-Path -LiteralPath $taskDestination) { throw 'Build context already exists. Choose a new ignored destination; do not merge or recursively delete it.' }
New-Item -ItemType Directory -Path (Join-Path $taskDestination 'workers/upload') -Force | Out-Null
foreach ($taskFile in @('package.json','package-lock.json')) {
  Copy-Item -LiteralPath (Join-Path $taskRoot $taskFile) -Destination (Join-Path $taskDestination $taskFile)
}
foreach ($taskFile in @('server.mjs','isolate.mjs','child.mjs','parser.mjs')) {
  Copy-Item -LiteralPath (Join-Path $taskRoot "workers/upload/$taskFile") -Destination (Join-Path $taskDestination "workers/upload/$taskFile")
}
Copy-Item -LiteralPath (Join-Path $taskRoot 'workers/upload/Dockerfile') -Destination (Join-Path $taskDestination 'Dockerfile')
$taskIgnore = "**`n!Dockerfile`n!package.json`n!package-lock.json`n!workers/`n!workers/upload/`n!workers/upload/*.mjs`n!.gcloudignore`n"
[IO.File]::WriteAllText((Join-Path $taskDestination '.gcloudignore'), $taskIgnore, [Text.UTF8Encoding]::new($false))
$taskFiles = Get-ChildItem -LiteralPath $taskDestination -File -Recurse
if ($taskFiles.Count -ne 8 -or $taskFiles.Where({ $_.Name -match '(^\.env|credential|token|secret)' }).Count -gt 0) { throw 'Build context allowlist failed.' }
Write-Output 'PASS: exact 8-file source allowlist prepared; no .env, ADC, source documents, fixtures or keys included.'
