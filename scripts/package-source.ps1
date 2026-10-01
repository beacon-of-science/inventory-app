param([string]$Destination)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Destination) { $Destination = Join-Path (Split-Path $projectRoot -Parent) 'inventory-app-source.zip' }
$Destination = [IO.Path]::GetFullPath($Destination)
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Only source and reproducible build configuration belong in this archive.
$excludedDirectories = @('node_modules', '.git', '.gradle', '.gradle-home', '.build-tmp', 'build', 'dist', '.idea')
$excludedFiles = @('local.properties', 'keystore.properties', '.DS_Store')
$queue = [Collections.Generic.Queue[string]]::new()
$queue.Enqueue($projectRoot)
$files = [Collections.Generic.List[string]]::new()
while ($queue.Count -gt 0) {
    $directory = $queue.Dequeue()
    foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
        if ($item.PSIsContainer) {
            $relativeDirectory = $item.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
            if ($excludedDirectories -notcontains $item.Name -and $relativeDirectory -ne 'android/app/src/main/assets/public') {
                $queue.Enqueue($item.FullName)
            }
        } elseif ($excludedFiles -notcontains $item.Name -and $item.Extension -notin @('.apk', '.jks', '.keystore', '.hprof', '.log') -and $item.FullName -ne $Destination) {
            $files.Add($item.FullName)
        }
    }
}
if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination }
$archive = [IO.Compression.ZipFile]::Open($Destination, 'Create')
try {
    foreach ($file in $files) {
        $relativePath = $file.Substring($projectRoot.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, "inventory-app/$relativePath", 'Optimal') | Out-Null
    }
} finally { $archive.Dispose() }
Write-Output "Source archive: $Destination ($($files.Count) files)"
