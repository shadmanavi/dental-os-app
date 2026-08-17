# =====================================================================
#  Dental OS - Session Sync  v1.2
#
#  One command, run at the handoff moment. It proves that disk, live
#  and GitHub all agree, then packs the result for the next chat.
#
#  Sequence:
#    1  Preflight
#    2  Read secrets
#    3  Snapshot the functions folder as it sits on disk
#    4  Download every live Edge Function from Supabase
#    5  Snapshot the live copies
#    6  Restore the disk copies
#    7  Compare, and classify every difference
#    8  Deploy the functions you edited
#    9  Fetch migration files from the history table, guarded
#   10  Commit and push
#   11  Pack
#   12  Prune old packs
#
#  Stop rule:
#    A difference Git can explain - you edited that file this session -
#    is a deploy. A difference Git cannot explain is drift, and the run
#    stops dead. Nothing is deployed, committed or packed.
#
#  Changelog:
#    v1    First cut.
#    v1.2  Two changes, both from the session where three migration
#          files were silently blanked and committed.
#
#          Step 9 runs 'migration fetch', which rewrites every local
#          migration file from the statements column of the history
#          table. A row applied from a chat session rather than the
#          CLI has that column empty, so the fetch wrote empty files
#          over good ones and step 10 committed them. The script did
#          exactly what it was told; nothing warned anyone.
#
#          Step 9 now snapshots the migrations folder first, runs the
#          fetch, and compares. A file that vanished, or lost more
#          than half its content, or came back effectively empty,
#          stops the run and every file is restored from the
#          snapshot. Growth and ordinary edits pass without comment.
#
#          The pack now also carries this script and its launcher.
#          They sit in the project root, outside all four packed
#          subtrees, so no pack has ever contained them - which meant
#          every chat reasoned about this routine without being able
#          to read it. Pack format is v6.
#
#    v1.1  The final banner printed 'supabase\migrations' where the
#          separator line belonged, and dropped the separator.
#
#          PowerShell variable names are case-insensitive, so the
#          pack loop's $sub and the global $Sub separator were one
#          variable. The loop left it holding the last subtree name.
#          Cosmetic in its effect, but the same class of fault this
#          whole script exists to catch: two things that looked
#          separate quietly turning out to be the same thing.
#
#          The loop variable is now $subTree, and the separator is
#          now $Rule, so neither can collide with anything.
# =====================================================================

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------- config
$Root        = 'C:\Users\shadm\dental-os-app\dental-os-app'
$ProjectRef  = 'mjctkqoggqrgciufqcvd'
$SecretsFile = Join-Path $Root '_session-sync.secrets.txt'
$SyncDir     = Join-Path $Root '_sync'
$WorkDir     = Join-Path $SyncDir 'work'
$DiskSnap    = Join-Path $WorkDir 'disk'
$LiveSnap    = Join-Path $WorkDir 'live'
$MigSnap     = Join-Path $WorkDir 'migrations-before'
$PacksDir    = Join-Path $SyncDir 'packs'
$LatestDir   = Join-Path $SyncDir 'latest'
$FuncDir     = Join-Path $Root 'supabase\functions'
$KeepPacks   = 10

$PackMasks   = @('*.ts','*.tsx','*.js','*.jsx','*.css','*.sql','*.toml','*.json','*.jsonc')
$RootConfigs = @('package.json','tsconfig.json','middleware.ts','next.config.js',
                 'next.config.mjs','next.config.ts','tailwind.config.js',
                 'tailwind.config.ts','postcss.config.js','postcss.config.mjs')

# The sync routine itself. These live in the project root, outside every
# packed subtree, so before v1.2 no pack contained them.
$RootScripts = @('_session-sync.bat','_session-sync.ps1')

$Bar = '============================================================'
$Rule = '------------------------------------------------------------'

# ------------------------------------------------------------ reporting
function Write-Step {
    param([int]$Num, [string]$Text)
    Write-Host ''
    Write-Host ('  [{0}] {1}' -f $Num, $Text) -ForegroundColor Cyan
}

function Write-Note {
    param([string]$Text)
    Write-Host ('      ' + $Text)
}

function Stop-Run {
    param(
        [int]$StepNum,
        [string]$StepName,
        [string]$Reason,
        [string[]]$Detail = @()
    )
    Write-Host ''
    Write-Host $Bar -ForegroundColor Red
    Write-Host ('  STOPPED AT STEP {0}' -f $StepNum) -ForegroundColor Red
    Write-Host $Bar -ForegroundColor Red
    Write-Host ('  Step   : ' + $StepName)
    Write-Host ('  Time   : ' + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
    Write-Host ('  Reason : ' + $Reason)
    if ($Detail.Count -gt 0) {
        Write-Host $Rule
        foreach ($line in $Detail) {
            foreach ($piece in ($line -split "`r?`n")) {
                $s = $piece
                while ($s.Length -gt 56) {
                    Write-Host ('  ' + $s.Substring(0, 56))
                    $s = '    ' + $s.Substring(56)
                }
                Write-Host ('  ' + $s)
            }
        }
    }
    Write-Host $Rule
    Write-Host '  Nothing after this step was run.'
    Write-Host '  Screenshot this window and paste it into the chat.'
    Write-Host $Bar -ForegroundColor Red
    Write-Host ''
    exit 1
}

# Native commands write progress to stderr even when they succeed, which
# throws under ErrorActionPreference Stop. Every external call goes
# through here so the exit code decides success, not the stream.
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & $Exe @Arguments 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    return [pscustomobject]@{ Output = ($out | Out-String); Code = $code }
}

function Invoke-Checked {
    param([string]$Exe, [string[]]$Arguments, [int]$StepNum, [string]$StepName)
    $r = Invoke-Native -Exe $Exe -Arguments $Arguments
    if ($r.Code -ne 0) {
        $tail = ($r.Output -split "`r?`n") | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 18
        $shown = @(('Command : ' + $Exe + ' ' + ($Arguments -join ' ')), ('Exit    : ' + $r.Code), '') + $tail
        Stop-Run -StepNum $StepNum -StepName $StepName -Reason 'A command returned an error.' -Detail $shown
    }
    return $r.Output
}

# ------------------------------------------------------- fingerprinting
function Get-FolderFingerprint {
    param([string]$Dir)
    if (-not (Test-Path -LiteralPath $Dir)) { return $null }
    $sb = New-Object System.Text.StringBuilder
    $files = Get-ChildItem -LiteralPath $Dir -Recurse -File | Sort-Object FullName
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($Dir.Length).TrimStart('\')
        $txt = [System.IO.File]::ReadAllText($f.FullName)
        $txt = $txt -replace "`r`n", "`n"
        $txt = $txt.TrimEnd()
        [void]$sb.AppendLine($rel.ToLower())
        [void]$sb.AppendLine($txt)
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
}

function Copy-Tree {
    param([string]$From, [string]$To)
    if (Test-Path -LiteralPath $To) { Remove-Item -LiteralPath $To -Recurse -Force }
    New-Item -ItemType Directory -Path $To -Force | Out-Null
    if (Test-Path -LiteralPath $From) {
        $kids = Get-ChildItem -LiteralPath $From -Force
        if ($kids.Count -gt 0) {
            Copy-Item -Path (Join-Path $From '*') -Destination $To -Recurse -Force
        }
    }
}

function Get-FileCount {
    param([string]$Dir)
    if (-not (Test-Path -LiteralPath $Dir)) { return 0 }
    return @(Get-ChildItem -LiteralPath $Dir -Recurse -File).Count
}

# =====================================================================
Clear-Host
Write-Host $Bar
Write-Host '  DENTAL OS - SESSION SYNC  v1.2'
Write-Host ('  ' + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
Write-Host $Bar

# --------------------------------------------------------- 1. preflight
Write-Step 1 'Preflight'

if (-not (Test-Path -LiteralPath $Root)) {
    Stop-Run 1 'Preflight' 'The project folder was not found.' @(
        ('Looked for: ' + $Root),
        'Edit the Root line at the top of _session-sync.ps1')
}
if (-not (Test-Path -LiteralPath (Join-Path $Root 'package.json'))) {
    Stop-Run 1 'Preflight' 'package.json is not in the project folder.' @(('Looked in: ' + $Root))
}
if (-not (Test-Path -LiteralPath (Join-Path $Root '.git'))) {
    Stop-Run 1 'Preflight' 'The project folder is not a Git repository.' @(('Looked in: ' + $Root))
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-Run 1 'Preflight' 'Git is not available in this window.' @(
        'Close this window, open a new one, and run again.')
}
if (-not (Test-Path -LiteralPath $FuncDir)) {
    Stop-Run 1 'Preflight' 'The supabase functions folder was not found.' @(('Looked for: ' + $FuncDir))
}

if (Get-Command supabase -ErrorAction SilentlyContinue) {
    $SupaExe = 'supabase'
    $SupaPre = @()
} elseif (Get-Command npx -ErrorAction SilentlyContinue) {
    $SupaExe = 'npx'
    $SupaPre = @('--yes', 'supabase')
} else {
    Stop-Run 1 'Preflight' 'Neither the supabase CLI nor npx was found.' @(
        'Install Node.js, or install the Supabase CLI.')
}
Write-Note ('Supabase CLI via: ' + $SupaExe)

if (-not (Test-Path -LiteralPath $SecretsFile)) {
    Stop-Run 1 'Preflight' 'The secrets file is missing.' @(
        'Create this file:',
        ('  ' + $SecretsFile),
        '',
        'Put one line in it, with your Supabase database',
        'password after the equals sign:',
        '',
        '  SUPABASE_DB_PASSWORD=your-password-here',
        '',
        'Optionally add a second line:',
        '',
        '  SUPABASE_ACCESS_TOKEN=your-token-here')
}

$ignoreCheck = Invoke-Native -Exe 'git' -Arguments @('-C', $Root, 'check-ignore', '-q', '_session-sync.secrets.txt')
if ($ignoreCheck.Code -ne 0) {
    Stop-Run 1 'Preflight' 'The secrets file is NOT ignored by Git.' @(
        'Your database password would be pushed to GitHub.',
        'Add these two lines to .gitignore, then run again:',
        '',
        '  _session-sync.secrets.txt',
        '  _sync/')
}
Write-Note 'Secrets file present and Git-ignored.'

# ------------------------------------------------------ 2. read secrets
Write-Step 2 'Read secrets'

$dbPass = $null
$accessToken = $null
foreach ($line in (Get-Content -LiteralPath $SecretsFile)) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $key = $t.Substring(0, $i).Trim()
    $val = $t.Substring($i + 1).Trim()
    if ($key -eq 'SUPABASE_DB_PASSWORD')  { $dbPass = $val }
    if ($key -eq 'SUPABASE_ACCESS_TOKEN') { $accessToken = $val }
}
if ([string]::IsNullOrWhiteSpace($dbPass)) {
    Stop-Run 2 'Read secrets' 'SUPABASE_DB_PASSWORD was not found in the secrets file.' @(('File: ' + $SecretsFile))
}
$env:SUPABASE_DB_PASSWORD = $dbPass
if (-not [string]::IsNullOrWhiteSpace($accessToken)) { $env:SUPABASE_ACCESS_TOKEN = $accessToken }
Write-Note 'Database password loaded. It is never printed or packed.'

# --------------------------------------------------- 3. snapshot on-disk
Write-Step 3 'Snapshot the functions folder as it sits on disk'

New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
Copy-Tree -From $FuncDir -To $DiskSnap
$diskCount = Get-FileCount $DiskSnap
if ($diskCount -eq 0) {
    Stop-Run 3 'Snapshot disk' 'The snapshot came back empty. Refusing to continue.' @(('Source: ' + $FuncDir))
}
Write-Note ('{0} files snapshotted.' -f $diskCount)

# ------------------------------------------------ 4. download live copies
Write-Step 4 'Download every live Edge Function'

$dlArgs = $SupaPre + @('functions', 'download', '--project-ref', $ProjectRef, '--use-api', '--yes')
$dl = Invoke-Native -Exe $SupaExe -Arguments $dlArgs
if ($dl.Code -ne 0) {
    Copy-Tree -From $DiskSnap -To $FuncDir
    $tail = ($dl.Output -split "`r?`n") | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 18
    $shown = @('Your local files were restored. Nothing was lost.', '') + $tail
    Stop-Run 4 'Download live functions' 'The download failed.' $shown
}
Write-Note 'Download complete.'

# ------------------------------------------------------ 5. snapshot live
Write-Step 5 'Snapshot the live copies'

Copy-Tree -From $FuncDir -To $LiveSnap
$liveCount = Get-FileCount $LiveSnap
if ($liveCount -eq 0) {
    Copy-Tree -From $DiskSnap -To $FuncDir
    Stop-Run 5 'Snapshot live' 'The download produced no files. Refusing to continue.' @(
        'Your local files were restored. Nothing was lost.')
}
Write-Note ('{0} files captured from Supabase.' -f $liveCount)

# --------------------------------------------------- 6. restore on-disk
Write-Step 6 'Restore your disk copies'

Copy-Tree -From $DiskSnap -To $FuncDir
$backCount = Get-FileCount $FuncDir
if ($backCount -ne $diskCount) {
    Stop-Run 6 'Restore disk copies' 'The restore did not put back the same number of files.' @(
        ('Expected : ' + $diskCount),
        ('Found    : ' + $backCount),
        '',
        'Your original files are safe at:',
        '  _sync\work\disk')
}
Write-Note 'Working folder is back to exactly how you left it.'

# ------------------------------------------------------------ 7. compare
Write-Step 7 'Compare live against disk'

$diskNames = @()
if (Test-Path -LiteralPath $DiskSnap) {
    $diskNames = @(Get-ChildItem -LiteralPath $DiskSnap -Directory | ForEach-Object { $_.Name })
}
$liveNames = @()
if (Test-Path -LiteralPath $LiveSnap) {
    $liveNames = @(Get-ChildItem -LiteralPath $LiveSnap -Directory | ForEach-Object { $_.Name })
}
$allNames = @($diskNames + $liveNames) | Sort-Object -Unique

$toDeploy = @()
$drift    = @()
$agreed   = @()

foreach ($name in $allNames) {
    $dFp = Get-FolderFingerprint (Join-Path $DiskSnap $name)
    $lFp = Get-FolderFingerprint (Join-Path $LiveSnap $name)

    if ($null -ne $dFp -and $null -ne $lFp -and $dFp -eq $lFp) {
        $agreed += $name
        continue
    }

    $relPath = 'supabase/functions/' + $name
    $st = Invoke-Native -Exe 'git' -Arguments @('-C', $Root, 'status', '--porcelain', '--', $relPath)
    $editedLocally = -not [string]::IsNullOrWhiteSpace($st.Output)

    if ($null -eq $lFp)     { $why = 'on disk only, not live' }
    elseif ($null -eq $dFp) { $why = 'live only, missing on disk' }
    else                    { $why = 'live and disk differ' }

    if ($editedLocally) {
        $toDeploy += [pscustomobject]@{ Name = $name; Why = $why }
    } else {
        $drift += [pscustomobject]@{ Name = $name; Why = $why }
    }
}

Write-Host ''
Write-Host '      FUNCTION             RESULT'
Write-Host '      -------------------- -----------------------------'
foreach ($n in $agreed) {
    Write-Host ('      {0} agrees with live' -f $n.PadRight(20))
}
foreach ($d in $toDeploy) {
    Write-Host ('      {0} you edited it - will deploy' -f $d.Name.PadRight(20)) -ForegroundColor Yellow
}
foreach ($d in $drift) {
    Write-Host ('      {0} DRIFT - {1}' -f $d.Name.PadRight(20), $d.Why) -ForegroundColor Red
}

if ($drift.Count -gt 0) {
    $detail = @()
    foreach ($d in $drift) { $detail += ('{0}  {1}' -f $d.Name.PadRight(20), $d.Why) }
    $detail += ''
    $detail += 'These differ from Supabase but Git shows no local edit,'
    $detail += 'so nobody authored the difference on this machine.'
    $detail += ''
    $detail += 'The live copies are saved for comparison at:'
    $detail += '  _sync\work\live'
    $detail += 'Your own files were not touched.'
    Stop-Run 7 'Compare live against disk' ('{0} function(s) drifted.' -f $drift.Count) $detail
}

if ($toDeploy.Count -eq 0) { Write-Note 'Everything already agrees. Nothing to deploy.' }

# ------------------------------------------------------------- 8. deploy
Write-Step 8 'Deploy the functions you edited'

if ($toDeploy.Count -eq 0) {
    Write-Note 'Skipped - nothing to deploy.'
} else {
    foreach ($d in $toDeploy) {
        if (-not (Test-Path -LiteralPath (Join-Path $FuncDir $d.Name))) {
            Stop-Run 8 'Deploy functions' ($d.Name + ' is not on disk, so it cannot be deployed.') @(
                'It was deleted locally but still exists in Supabase.',
                'Deleting a live function is deliberate work, so this',
                'script will not do it for you.')
        }
        Write-Note ('Deploying ' + $d.Name + ' ...')
        $depArgs = $SupaPre + @('functions', 'deploy', $d.Name, '--project-ref', $ProjectRef, '--use-api', '--yes')
        Invoke-Checked -Exe $SupaExe -Arguments $depArgs -StepNum 8 -StepName ('Deploy ' + $d.Name) | Out-Null
        Write-Note ('  ' + $d.Name + ' deployed.')
    }
}

# -------------------------------------------------- 9. fetch migrations
Write-Step 9 'Fetch migration files from the history table, guarded'

$migPath = Join-Path $Root 'supabase\migrations'

# The fetch rewrites every local migration file from the statements
# column of the history table. A row inserted by hand has that column
# empty, and the fetch will happily write the emptiness over good SQL.
# So: photograph the folder, fetch, then compare.
Copy-Tree -From $migPath -To $MigSnap
$beforeCount = Get-FileCount $MigSnap
Write-Note ('{0} migration files photographed before the fetch.' -f $beforeCount)

$mgArgs = $SupaPre + @('migration', 'fetch', '--project-ref', $ProjectRef, '--yes')
Invoke-Checked -Exe $SupaExe -Arguments $mgArgs -StepNum 9 -StepName 'Fetch migrations' | Out-Null

$losses = @()
if ($beforeCount -gt 0) {
    foreach ($snap in (Get-ChildItem -LiteralPath $MigSnap -Filter '*.sql' -File | Sort-Object Name)) {
        $nowFile = Join-Path $migPath $snap.Name

        $beforeText = ([System.IO.File]::ReadAllText($snap.FullName)).Trim()
        $beforeLen  = $beforeText.Length

        if (-not (Test-Path -LiteralPath $nowFile)) {
            $losses += ('{0}  vanished' -f $snap.Name)
            continue
        }

        $afterText = ([System.IO.File]::ReadAllText($nowFile)).Trim()
        $afterLen  = $afterText.Length

        # A file that held real SQL and came back empty, came back as a
        # bare semicolon, or lost more than half of itself.
        if ($beforeLen -gt 20) {
            if ($afterLen -le 5) {
                $losses += ('{0}  {1} chars to {2}, effectively empty' -f $snap.Name, $beforeLen, $afterLen)
            } elseif ($afterLen -lt [int]($beforeLen / 2)) {
                $losses += ('{0}  {1} chars to {2}, lost over half' -f $snap.Name, $beforeLen, $afterLen)
            }
        }
    }
}

if ($losses.Count -gt 0) {
    Copy-Tree -From $MigSnap -To $migPath

    $detail = @('The fetch overwrote migration files with less than', 'they held before:', '')
    $detail += $losses
    $detail += ''
    $detail += 'Every migration file has been restored from the snapshot,'
    $detail += 'so nothing was lost and nothing was committed.'
    $detail += ''
    $detail += 'This means a row in supabase_migrations.schema_migrations'
    $detail += 'has an empty statements column, which happens when SQL'
    $detail += 'was applied from a chat session instead of the CLI. Fix'
    $detail += 'the row, do not fight the fetch:'
    $detail += ''
    $detail += '  update supabase_migrations.schema_migrations'
    $detail += '  set statements = array[ ...the file text... ]'
    $detail += '  where version = ...;'
    $detail += ''
    $detail += 'The snapshot is kept at:'
    $detail += '  _sync\work\migrations-before'
    Stop-Run -StepNum 9 -StepName 'Fetch migrations' -Reason ('{0} migration file(s) came back short.' -f $losses.Count) -Detail $detail
}

$migCount = 0
if (Test-Path -LiteralPath $migPath) {
    $migCount = @(Get-ChildItem -LiteralPath $migPath -Filter '*.sql' -File).Count
}
Write-Note ('{0} migration files now on disk. None came back short.' -f $migCount)

# ---------------------------------------------------- 10. commit + push
Write-Step 10 'Commit and push'

$statusOut = (Invoke-Native -Exe 'git' -Arguments @('-C', $Root, 'status', '--porcelain')).Output
$commitSha = ''

if ([string]::IsNullOrWhiteSpace($statusOut)) {
    Write-Note 'Nothing changed. No commit needed.'
    $commitSha = ((Invoke-Native -Exe 'git' -Arguments @('-C', $Root, 'rev-parse', '--short', 'HEAD')).Output).Trim()
} else {
    Write-Host ''
    Write-Host ((Invoke-Native -Exe 'git' -Arguments @('-C', $Root, 'status', '--short')).Output)
    $msg = Read-Host '      Describe this session in a few words'
    if ([string]::IsNullOrWhiteSpace($msg)) { $msg = 'Session update' }

    Invoke-Checked -Exe 'git' -Arguments @('-C', $Root, 'add', '-A') -StepNum 10 -StepName 'git add' | Out-Null
    Invoke-Checked -Exe 'git' -Arguments @('-C', $Root, 'commit', '-m', $msg) -StepNum 10 -StepName 'git commit' | Out-Null
    Invoke-Checked -Exe 'git' -Arguments @('-C', $Root, 'push') -StepNum 10 -StepName 'git push' | Out-Null

    $commitSha = ((Invoke-Native -Exe 'git' -Arguments @('-C', $Root, 'rev-parse', '--short', 'HEAD')).Output).Trim()
    Write-Note ('Committed and pushed as ' + $commitSha + '.')
    Write-Note 'Vercel will rebuild the frontend in a minute or two.'
}

# ---------------------------------------------------------- 11. pack
Write-Step 11 'Pack'

$stamp   = Get-Date -Format 'yyyy-MM-dd_HHmm'
$packDir = Join-Path $PacksDir $stamp
New-Item -ItemType Directory -Path $packDir -Force | Out-Null
$packFile = Join-Path $packDir 'dental-os-pack.txt'

$subTrees = @('app', 'lib', 'supabase\functions', 'supabase\migrations')

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('===== DENTAL OS SOURCE PACK v6 =====')
$lines.Add('===== ROOT: ' + $Root)
$lines.Add('===== PACKED: ' + $stamp)
$lines.Add('===== COMMIT: ' + $commitSha)
$lines.Add('===== Every Edge Function below was verified against the live')
$lines.Add('===== copy in Supabase immediately before this pack was written.')
$lines.Add('')

foreach ($treeName in $subTrees) {
    $treePath = Join-Path $Root $treeName
    $lines.Add('===== TREE: ' + $treeName + ' =====')
    if (Test-Path -LiteralPath $treePath) {
        foreach ($item in (Get-ChildItem -LiteralPath $treePath -Recurse | Sort-Object FullName)) {
            $lines.Add($item.FullName.Substring($Root.Length).TrimStart('\'))
        }
    }
    $lines.Add('')
}

$collected = New-Object System.Collections.Generic.List[string]
foreach ($subTree in $subTrees) {
    $p = Join-Path $Root $subTree
    if (Test-Path -LiteralPath $p) {
        foreach ($m in $PackMasks) {
            foreach ($f in (Get-ChildItem -LiteralPath $p -Recurse -File -Filter $m)) {
                $collected.Add($f.FullName)
            }
        }
    }
}
$cfgToml = Join-Path $Root 'supabase\config.toml'
if (Test-Path -LiteralPath $cfgToml) { $collected.Add($cfgToml) }
foreach ($c in $RootConfigs) {
    $cp = Join-Path $Root $c
    if (Test-Path -LiteralPath $cp) { $collected.Add($cp) }
}
foreach ($c in $RootScripts) {
    $cp = Join-Path $Root $c
    if (Test-Path -LiteralPath $cp) { $collected.Add($cp) }
}

$packedCount = 0
foreach ($f in ($collected | Sort-Object -Unique)) {
    $rel = $f.Substring($Root.Length).TrimStart('\')
    $lines.Add('')
    $lines.Add($Bar)
    $lines.Add('===== FILE: ' + $rel)
    $lines.Add($Bar)
    $lines.Add([System.IO.File]::ReadAllText($f))
    $packedCount++
}
[System.IO.File]::WriteAllLines($packFile, $lines)

$agreedText   = 'none'
$deployedText = 'none'
if ($agreed.Count -gt 0)   { $agreedText   = ($agreed -join ', ') }
if ($toDeploy.Count -gt 0) { $deployedText = (($toDeploy | ForEach-Object { $_.Name }) -join ', ') }

$summary = @(
    'DENTAL OS - SESSION SUMMARY',
    ('Packed        : ' + $stamp),
    ('Commit        : ' + $commitSha),
    ('Files packed  : ' + $packedCount),
    ('Migrations    : ' + $migCount + ' on disk'),
    '',
    'Edge Functions:',
    ('  agreed with live : ' + $agreedText),
    ('  deployed now     : ' + $deployedText),
    '',
    'Every Edge Function on disk was verified against the live',
    'copy in Supabase before this pack was written. Disk, live',
    'and GitHub all agree.'
)
[System.IO.File]::WriteAllLines((Join-Path $packDir 'session-summary.txt'), $summary)

if (Test-Path -LiteralPath $LatestDir) { Remove-Item -LiteralPath $LatestDir -Recurse -Force }
New-Item -ItemType Directory -Path $LatestDir -Force | Out-Null
Copy-Item -LiteralPath $packFile -Destination (Join-Path $LatestDir 'dental-os-pack.txt') -Force
Copy-Item -LiteralPath (Join-Path $packDir 'session-summary.txt') -Destination (Join-Path $LatestDir 'session-summary.txt') -Force

Write-Note ('{0} files packed.' -f $packedCount)

# --------------------------------------------------------- 12. prune
Write-Step 12 'Prune old packs'

$old = @(Get-ChildItem -LiteralPath $PacksDir -Directory | Sort-Object Name -Descending | Select-Object -Skip $KeepPacks)
foreach ($o in $old) { Remove-Item -LiteralPath $o.FullName -Recurse -Force }
Write-Note ('Keeping the newest {0}. Removed {1}.' -f $KeepPacks, $old.Count)

# ------------------------------------------------------------ finished
Write-Host ''
Write-Host $Bar -ForegroundColor Green
Write-Host '  ALL CLEAR' -ForegroundColor Green
Write-Host $Bar -ForegroundColor Green
Write-Host ('  Commit    : ' + $commitSha)
Write-Host ('  Deployed  : ' + $deployedText)
Write-Host ('  Packed    : ' + $packedCount + ' files')
Write-Host ('  Migrations: ' + $migCount)
Write-Host $Rule
Write-Host '  Upload this file to the next chat:'
Write-Host '  _sync\latest\dental-os-pack.txt'
Write-Host '  It now carries the sync scripts too, so that is the'
Write-Host '  only upload the next session needs.'
Write-Host $Bar -ForegroundColor Green
Write-Host ''
exit 0
