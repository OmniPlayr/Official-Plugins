param(
    [string]$Before,
    [string]$After = "HEAD",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Set-Location $repositoryRoot

if (-not $DryRun -and [string]::IsNullOrWhiteSpace($env:OMNIPLAYR_ACCESS_TOKEN)) {
    throw "OMNIPLAYR_ACCESS_TOKEN is not configured. Add it to the plugin-registry GitHub environment."
}

$publishAll = $env:PUBLISH_ALL -eq "true" -or [string]::IsNullOrWhiteSpace($Before) -or $Before -match "^0+$"
$trackedManifestPaths = @(git ls-files "**/package.json" | Where-Object { $_ -notmatch "(^|/)node_modules/" })
if ($LASTEXITCODE -ne 0) { throw "Could not list tracked plugin manifests." }
$pluginNames = @($trackedManifestPaths | ForEach-Object { ($_ -split "/")[0] } | Where-Object { $_ -match "^[^@]+@[^@]+$" } | Sort-Object -Unique)

if ($publishAll) {
    $changedFiles = @()
    $changedPluginNames = $pluginNames
} else {
    $changedFiles = @(git diff --name-only $Before $After)
    if ($LASTEXITCODE -ne 0) { throw "Could not determine changed files between $Before and $After." }
    $changedPluginNames = @($changedFiles | ForEach-Object { ($_ -split "/")[0] } | Where-Object { $_ -match "^[^@]+@[^@]+$" } | Sort-Object -Unique)
}

$packages = foreach ($pluginName in $changedPluginNames) {
    $pluginDirectory = Join-Path $repositoryRoot $pluginName
    if (-not (Test-Path $pluginDirectory -PathType Container)) { continue }

    $manifests = @($trackedManifestPaths | Where-Object { $_ -eq "$pluginName/package.json" -or $_.StartsWith("$pluginName/") } | ForEach-Object {
        Get-Item -LiteralPath (Join-Path $repositoryRoot $_)
    })

    foreach ($manifestFile in $manifests) {
        $relativeManifest = $manifestFile.FullName.Substring($repositoryRoot.Length).TrimStart("\", "/").Replace("\", "/")
        $component = $manifestFile.DirectoryName.Substring($pluginDirectory.Length).TrimStart("\", "/").Replace("\", "/")
        if ([string]::IsNullOrWhiteSpace($component)) { $component = "." }
        $componentChanged = $publishAll -or $component -eq "." -or @($changedFiles | Where-Object {
            $_ -eq $pluginName -or $_.StartsWith("$pluginName/$component/") -or
            ($_.StartsWith("$pluginName/") -and ($_ -split "/").Count -lt 3)
        }).Count -gt 0

        if (-not $componentChanged) { continue }

        $manifest = Get-Content -Raw $manifestFile.FullName | ConvertFrom-Json
        if ($manifest.id -and $manifest.id -ne $pluginName) { throw "$relativeManifest must set id to '$pluginName'." }
        if ($manifest.author -ne ($pluginName -split "@")[1]) { throw "$relativeManifest has an author that does not match its id." }
        if ($manifest.type -notin @("backend", "frontend")) { throw "$relativeManifest must set type to backend or frontend." }

        if (-not $publishAll) {
            git cat-file -e "${Before}:$relativeManifest" 2>$null
            if ($LASTEXITCODE -eq 0) {
                $previousManifest = (git show "${Before}:$relativeManifest" | Out-String) | ConvertFrom-Json
                if ($previousManifest.version -eq $manifest.version) {
                    throw "$relativeManifest changed without a version bump (still $($manifest.version))."
                }
            }
        }

        [PSCustomObject]@{
            Id = $pluginName
            Type = $manifest.type
            Version = $manifest.version
            Source = $manifestFile.DirectoryName
            Manifest = $relativeManifest
        }
    }
}

if (@($packages).Count -eq 0) {
    Write-Host "No changed plugin packages to publish."
    exit 0
}

$duplicate = $packages | Group-Object Id, Type | Where-Object Count -gt 1
if ($duplicate) { throw "More than one package declares the same plugin id and type: $($duplicate.Name -join ', ')" }

foreach ($package in $packages) {
    Write-Host "Publishing $($package.Id) $($package.Type) v$($package.Version) from $($package.Manifest)"
    if ($DryRun) { continue }

    $stagingParent = Join-Path ([IO.Path]::GetTempPath()) ("omniplayr-publish-" + [guid]::NewGuid())
    $stagingDirectory = Join-Path $stagingParent $package.Id
    New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null

    try {
        Get-ChildItem -LiteralPath $package.Source -Force | Copy-Item -Destination $stagingDirectory -Recurse -Force
        $stagedManifestPath = Join-Path $stagingDirectory "package.json"
        $stagedManifest = Get-Content -Raw $stagedManifestPath | ConvertFrom-Json
        if (-not $stagedManifest.id) {
            $stagedManifest | Add-Member -NotePropertyName id -NotePropertyValue $package.Id
            $stagedManifest | ConvertTo-Json -Depth 20 | Set-Content -Path $stagedManifestPath -Encoding utf8
        }
        Push-Location $stagingDirectory
        try {
            & omniplayr publish
            if ($LASTEXITCODE -ne 0) { throw "Publishing $($package.Id) ($($package.Type)) failed." }
        } finally {
            Pop-Location
        }
    } finally {
        Remove-Item -LiteralPath $stagingParent -Recurse -Force -ErrorAction SilentlyContinue
    }
}
