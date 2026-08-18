# ═══════════════════════════════════════════════════════════
#  PACTUM UPDATE KIT — سكربت التطبيق الآلي (نسخة 4)
#
#  طريقة الاستخدام (زي كل مرة):
#  1) فك pactum-update-kit.zip
#  2) انسخ التلات ملفات (pactum-clean.zip + APPLY.ps1 + UPDATE_MESSAGE.txt)
#     جوه فولدر المشروع
#  3) كليك يمين على APPLY.ps1  ←  "Run with PowerShell"
#
#  الجديد في النسخة دي:
#  - بيقرأ رسالة الـ commit من UPDATE_MESSAGE.txt (عشان التاريخ يبقى واضح)
#  - لو المكتبات اتغيرت، بيشغل npm install لوحده قبل الرفع
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
Write-Host "[1/5] Backup done -> $backup" -ForegroundColor Green

# ── 2) فك الحزمة في فولدر مؤقت ──
$tmp = Join-Path $env:TEMP "pactum-clean-$stamp"
Expand-Archive -Force -Path $zip -DestinationPath $tmp
Write-Host "[2/5] Extracted update" -ForegroundColor Green

# ── 3) المرآة: تطبيق الملفات (مع حفظ .git و node_modules و dist) ──
robocopy $tmp $proj /MIR /XD .git node_modules dist /XF pactum-clean.zip APPLY.ps1 UPDATE_MESSAGE.txt pactum-update-kit.zip /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
  Write-Host "ERROR: robocopy failed (code $LASTEXITCODE)" -ForegroundColor Red
  Read-Host "Press Enter to close"; exit 1
}
$global:LASTEXITCODE = 0
Write-Host "[3/5] Project updated" -ForegroundColor Green

# ── فحص أمان: أهم الملفات موجودة بعد التطبيق؟ ──
$mustExist = @('src\App.tsx','src\main.tsx','src\components\modules\BaselineModule.tsx','tests\golden\evm.golden.test.ts','vitest.config.ts','package.json','README.md')
$missing = @()
foreach ($f in $mustExist) { if (-not (Test-Path (Join-Path $proj $f))) { $missing += $f } }
if ($missing.Count -gt 0) {
  Write-Host "WARNING: these files are missing after apply: $($missing -join ', ')" -ForegroundColor Yellow
  Write-Host "Your backup is at: $backup" -ForegroundColor Yellow
  Read-Host "Press Enter to close"; exit 1
}

# ── 4) المكتبات: npm install لوحده بس لو اتغيرت ──
Set-Location $proj
$depsChanged = git status --porcelain -- package.json package-lock.json
if ($depsChanged) {
  Write-Host "[4/5] Dependencies changed -> running npm install (may take a minute)..." -ForegroundColor Yellow
  try { npm install --no-audit --no-fund 2>&1 | Out-Null } catch { Write-Host "npm install warning: $_" -ForegroundColor Yellow }
} else {
  Write-Host "[4/5] Dependencies unchanged - skipping npm install" -ForegroundColor Green
}

# ── 5) رفع التعديلات على GitHub ──
$msg = "Pactum update (auto-applied)"
$msgFile = Join-Path $proj 'UPDATE_MESSAGE.txt'
if (Test-Path $msgFile) { $msg = (Get-Content $msgFile -Raw).Trim() }
git add -A
git commit -m $msg
git push
Write-Host "[5/5] Pushed to GitHub: $msg" -ForegroundColor Green

Write-Host ""
Write-Host "═ DONE! ══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " التحديث اتطبق واترفع على GitHub"
if ($depsChanged) { Write-Host " والمكتبات اتحدثت تلقائيًا" }
Write-Host ""
Write-Host " شغّل التطبيق ب: npm run dev  ->  http://localhost:4173" -ForegroundColor Yellow
Write-Host " بيانات الدخول: admin / 123456789"
Read-Host "Press Enter to close"
