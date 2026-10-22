# Crops of the bundled UI demos; no accounts or remote media are used.
# Run after scripts/prepare_store_assets.py to refresh the website fragments.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskCrops = @(
    @{ Source = 'screenshot-music-1280x800.png'; Output = 'feed-demo.png'; X = 570; Y = 85; W = 500; H = 614 },
    @{ Source = 'screenshot-music-1280x800.png'; Output = 'audio-demo.png'; X = 570; Y = 85; W = 500; H = 92 },
    @{ Source = 'screenshot-music-1280x800.png'; Output = 'download-demo.png'; X = 570; Y = 577; W = 500; H = 122 },
    @{ Source = 'screenshot-profile-1280x800.png'; Output = 'profile-demo.png'; X = 310; Y = 40; W = 660; H = 720 }
)
foreach ($taskCrop in $taskCrops) {
    $taskSource = [System.Drawing.Bitmap]::new((Join-Path $taskRoot ('store/assets/' + $taskCrop.Source)))
    try {
        $taskRect = [System.Drawing.Rectangle]::new($taskCrop.X, $taskCrop.Y, $taskCrop.W, $taskCrop.H)
        $taskImage = $taskSource.Clone($taskRect, $taskSource.PixelFormat)
        try { $taskImage.Save((Join-Path $taskRoot ('site/assets/' + $taskCrop.Output)), [System.Drawing.Imaging.ImageFormat]::Png) }
        finally { $taskImage.Dispose() }
    }
    finally { $taskSource.Dispose() }
}
