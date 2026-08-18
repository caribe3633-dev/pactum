# ═══════════════════════════════════════════════════════════
#  PACTUM UPDATE KIT — سكربت التطبيق الآلي (نسخة 3)
#
#  طريقة الاستخدام:
#  1) فك pactum-update-kit.zip
#  2) انسخ الملفين (pactum-clean.zip + APPLY.ps1) جوه فولدر المشروع
#  3) كليك يمين على APPLY.ps1  ←  "Run with PowerShell"
#
#  بيعمل: نسخة احتياطية ← تطبيق التحديث ← رفع على GitHub
#  (بعد التطبيق شغّل: npm install ثم npm run dev)
# ═══════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'
$proj = $PSScriptRoot
$zip  = Join-Path $proj 'pactum-clean.zip'

if (-not (Test-Path $zip)) {
  Write-Host "ERROR: pactum-clean.zip not found next to this script!" -ForegroundColor Red
  Read-Host "Press Enter to close"; exit 1
}

# ── 1) نسخة احتياطية كاملة قبل أي حاجة ──
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "D:\Projects\pactum-backup-$stamp"
New-Item -ItemType Directory -Force $backup | Out-Null
$items = @('src','brand','public','tests','index.html','package.json','package-lock.json','tsconfig.json','vite.config.ts','vitest.config.ts','components.json','README.md','.gitignore')
foreach ($i in $items) {
  if (Test-Path (Join-Path $proj $i)) { Copy-Item -Recurse -Force (Join-Path $proj $i) $backup }
}
Write-Host "[1/4] Backup done -> $backup" -ForegroundColor Green

# ── 2) فك الحزمة في فولدر مؤقت ──
$tmp = Join-Path $env:TEMP "pactum-clean-$stamp"
Expand-Archive -Force -Path $zip -DestinationPath $tmp
Write-Host "[2/4] Extracted update" -ForegroundColor Green

# ── 3) المرآة: تطبيق الملفات (مع حفظ .git و node_modules و dist) ──
robocopy $tmp $proj /MIR /XD .git node_modules dist /XF pactum-clean.zip APPLY.ps1 pactum-update-kit.zip /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
  Write-Host "ERROR: robocopy failed (code $LASTEXITCODE)" -ForegroundColor Red
  Read-Host "Press Enter to close"; exit 1
}
$global:LASTEXITCODE = 0
Write-Host "[3/4] Project updated" -ForegroundColor Green

# ── فحص أمان: أهم الملفات موجودة بعد التطبيق؟ ──
$mustExist = @('src\App.tsx','src\main.tsx','src\components\modules\BaselineModule.tsx','tests\golden\evm.golden.test.ts','vitest.config.ts','package.json','README.md')
$missing = @()
foreach ($f in $mustExist) { if (-not (Test-Path (Join-Path $proj $f))) { $missing += $f } }
if ($missing.Count -gt 0) {
  Write-Host "WARNING: these files are missing after apply: $($missing -join ', ')" -ForegroundColor Yellow
  Write-Host "Your backup is at: $backup" -ForegroundColor Yellow
  Read-Host "Press Enter to close"; exit 1
}

# ── 4) رفع التعديلات على GitHub ──
Set-Location $proj
git add -A
git commit -m "Update: Baseline page (remove source versions panel, EV Baseline linked to approved EVM Planned) + golden-master tests + vendor chunk splitting"
git push
Write-Host "[4/4] Pushed to GitHub" -ForegroundColor Green

Write-Host ""
Write-Host "═ DONE! ══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " التحديث اتطبق واترفع على GitHub"
Write-Host ""
Write-Host " خطوة مهمة بعد كده (مرة واحدة):" -ForegroundColor Yellow
Write-Host "   npm install        <- عشان المكتبات الجديدة (vitest)"
Write-Host "   npm run dev        <- شغل التطبيق"
Write-Host "   npm test           <- 29 اختبار ذهبي (اختياري للتجربة)"
Write-Host ""
Write-Host " بيانات الدخول: admin / 123456789" -ForegroundColor Yellow
Read-Host "Press Enter to close"
