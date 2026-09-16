# Renders a 20s MP4 from the cinematic demo using Playwright + FFmpeg.
# Prerequisites: pnpm exec playwright install chromium; FFmpeg on PATH (winget Gyan.FFmpeg).
param(
  [string]$BaseUrl = "http://localhost:3000/demo/video?record=1",
  [string]$Output = "..\public\demo\ailms-trailer-1080p.mp4"
)

$ErrorActionPreference = "Stop"
$framesDir = Join-Path $env:TEMP "ailms-trailer-frames"
if (Test-Path $framesDir) { Remove-Item $framesDir -Recurse -Force }
New-Item -ItemType Directory -Path $framesDir | Out-Null

Write-Host "Capture 400 frames (20s @ 20fps) from $BaseUrl ..."
node --input-type=module -e @"
import { chromium } from 'playwright';
const url = process.argv[1];
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
for (let i = 0; i < 400; i++) {
  await page.screenshot({ path: \`\${out}/frame-\${String(i).padStart(4,'0')}.png\`, type: 'png' });
  await page.waitForTimeout(50);
}
await browser.close();
"@ $BaseUrl $framesDir

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
  $ffmpeg = "C:\Users\Waqar\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin\ffmpeg.exe"
}
& $ffmpeg -y -framerate 20 -i "$framesDir\frame-%04d.png" -c:v libx264 -pix_fmt yuv420p -movflags +faststart (Resolve-Path $Output)
Write-Host "Wrote $Output"
