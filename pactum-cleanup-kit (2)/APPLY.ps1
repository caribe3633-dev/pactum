# ═══════════════════════════════════════════════════════════
#  PACTUM CLEANUP KIT — سكربت التطبيق الآلي (نسخة 2 — مصححة)
#
#  طريقة الاستخدام:
#  1) نزّل الملف ده وحطه جوه فولدر المشروع (مكان النسخة القديمة)
#     لازم يكون جنب pactum-clean.zip
#  2) كليك يمين على APPLY.ps1  ←  "Run with PowerShell"
#
#  بيعمل: نسخة احتياطية ← تطبيق التنظيف ← رفع على GitHub
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
$items = @('src','brand','public','index.html','package.json','tsconfig.json','vite.config.ts','components.json')
foreach ($i in $items) {
  if (Test-Path (Join-Path $proj $i)) { Copy-Item -Recurse -Force (Join-Path $proj $i) $backup }
}
Write-Host "[1/4] Backup done -> $backup" -ForegroundColor Green

# ── 2) فك الحزمة النضيفة في فولدر مؤقت ──
$tmp = Join-Path $env:TEMP "pactum-clean-$stamp"
Expand-Archive -Force -Path $zip -DestinationPath $tmp
Write-Host "[2/4] Extracted clean build" -ForegroundColor Green

# ── 3) المرآة: تطبيق الملفات + حذف الميتة تلقائيًا (مع حفظ .git و node_modules و dist) ──
# ملاحظة: التصحيح هنا — /NJH بدل /NJ الغلط اللي كان بيرمي code 16
robocopy $tmp $proj /MIR /XD .git node_modules dist /XF pactum-clean.zip APPLY.ps1 pactum-cleanup-kit.zip /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
  Write-Host "ERROR: robocopy failed (code $LASTEXITCODE)" -ForegroundColor Red
  Read-Host "Press Enter to close"; exit 1
}
$global:LASTEXITCODE = 0
Write-Host "[3/4] Project updated (dead files removed automatically)" -ForegroundColor Green

# ── فحص أمان: أهم الملفات موجودة بعد التطبيق؟ ──
$mustExist = @('src\App.tsx','src\main.tsx','package.json','vite.config.ts','README.md')
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
git commit -m "Cleanup: standalone npm install, remove Replit/monorepo leftovers + dead files, fix 175 type errors, add README"
git push
Write-Host "[4/4] Pushed to GitHub" -ForegroundColor Green

Write-Host ""
Write-Host "═ DONE! ══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " الملفات اتجددت والملفات الميتة اتمسحت"
Write-Host " والتغييرات اترفعت على GitHub"
Write-Host ""
Write-Host " للتشغيل المستقل (اختياري):" -ForegroundColor Yellow
Write-Host "   npm install"
Write-Host "   npm run dev      ->  http://localhost:4173"
Write-Host ""
Write-Host " بيانات الدخول: admin / 123456789" -ForegroundColor Yellow
Read-Host "Press Enter to close"
