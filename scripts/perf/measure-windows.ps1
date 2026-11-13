# Local, read-only performance sampling for the Electron process tree on Windows.
# Run the app normally first, then pass the PID of its main electron.exe process.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$RootProcessId,

  [ValidateSet('idle', 'history', 'muc', 'startup', 'other')]
  [string]$Scenario = 'idle',

  [ValidateRange(10, 3600)]
  [int]$DurationSeconds = 60,

  [ValidateRange(1, 10)]
  [int]$IntervalSeconds = 2,

  [string]$OutputPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue)) {
  throw "The root process $RootProcessId is not running."
}

function Get-ProcessTreeIds {
  param([int]$Root, [object[]]$Processes)
  # Reuse a single CIM snapshot for both the process tree and CPU diagnostics.
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($Root)
  do {
    $changed = $false
    foreach ($process in $Processes) {
      if ($ids.Contains([int]$process.ParentProcessId) -and
          $ids.Add([int]$process.ProcessId)) {
        $changed = $true
      }
    }
  } while ($changed)
  return @($ids | ForEach-Object { [int]$_ })
}

function Get-Percentile95 {
  param([double[]]$Values)
  $sorted = @($Values | Sort-Object)
  if ($sorted.Count -eq 0) { return 0 }
  $index = [Math]::Max(0, [int][Math]::Ceiling($sorted.Count * 0.95) - 1)
  return [double]$sorted[$index]
}

$started = Get-Date
$deadline = $started.AddSeconds($DurationSeconds)
$lastSample = $started
$previousCpu = @{}
$previousCimCpuTicks = @{}
$samples = [System.Collections.Generic.List[object]]::new()

# Seed two independent counters. Win32_Process UserModeTime and KernelModeTime
# are cumulative 100-nanosecond units, unlike Get-Process.CPU (seconds).
$initialSnapshot = @(Get-CimInstance -ClassName Win32_Process)
$initialIds = @(Get-ProcessTreeIds -Root $RootProcessId -Processes $initialSnapshot)
foreach ($process in @(Get-Process -Id $initialIds -ErrorAction SilentlyContinue)) {
  if ($null -ne $process.CPU) {
    $previousCpu[[string]$process.Id] = [double]$process.CPU
  }
}
$initialIdsByString = @{}
foreach ($processId in $initialIds) { $initialIdsByString[[string]$processId] = $true }
foreach ($item in $initialSnapshot) {
  $id = [string]$item.ProcessId
  if ($initialIdsByString.ContainsKey($id) -and
      $null -ne $item.KernelModeTime -and $null -ne $item.UserModeTime) {
    $previousCimCpuTicks[$id] = [double]$item.KernelModeTime + [double]$item.UserModeTime
  }
}

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds $IntervalSeconds
  $now = Get-Date
  $snapshot = @(Get-CimInstance -ClassName Win32_Process)
  $ids = @(Get-ProcessTreeIds -Root $RootProcessId -Processes $snapshot)
  $processes = @(Get-Process -Id $ids -ErrorAction SilentlyContinue)
  if (-not @($processes | Where-Object { $_.Id -eq $RootProcessId }).Count) { break }

  $currentCpu = @{}
  $cpuSeconds = 0.0
  $cpuAvailableProcessCount = 0
  $workingSetBytes = 0.0
  $privateBytes = 0.0
  foreach ($process in $processes) {
    $id = [string]$process.Id
    if ($null -ne $process.CPU) {
      $cpuAvailableProcessCount += 1
      $totalCpu = [double]$process.CPU
      if ($previousCpu.ContainsKey($id)) {
        $cpuSeconds += [Math]::Max(0, $totalCpu - [double]$previousCpu[$id])
      }
      $currentCpu[$id] = $totalCpu
    }
    $workingSetBytes += [double]$process.WorkingSet64
    $privateBytes += [double]$process.PrivateMemorySize64
  }
  $previousCpu = $currentCpu

  $idsByString = @{}
  foreach ($processId in $ids) { $idsByString[[string]$processId] = $true }
  $currentCimCpuTicks = @{}
  $cimCpuSeconds = 0.0
  $cimCpuAvailableProcessCount = 0
  foreach ($item in $snapshot) {
    $id = [string]$item.ProcessId
    if (-not $idsByString.ContainsKey($id) -or
        $null -eq $item.KernelModeTime -or $null -eq $item.UserModeTime) { continue }
    $cimCpuAvailableProcessCount += 1
    $ticks = [double]$item.KernelModeTime + [double]$item.UserModeTime
    if ($previousCimCpuTicks.ContainsKey($id)) {
      $cimCpuSeconds += [Math]::Max(0, ($ticks - [double]$previousCimCpuTicks[$id]) / 10000000)
    }
    $currentCimCpuTicks[$id] = $ticks
  }
  $previousCimCpuTicks = $currentCimCpuTicks
  $getProcessCpuSeconds = $cpuSeconds
  $cpuSource = 'unavailable'
  # Prefer Get-Process when positive; fall back to independent CIM time
  # rather than treating a zero from Get-Process as evidence of zero work.
  if ($getProcessCpuSeconds -gt 0) {
    $cpuSource = 'get-process'
  } elseif ($cimCpuSeconds -gt 0) {
    $cpuSeconds = $cimCpuSeconds
    $cpuSource = 'cim-fallback'
  } elseif ($cpuAvailableProcessCount -gt 0 -or $cimCpuAvailableProcessCount -gt 0) {
    $cpuSource = 'zero-delta'
  }
  $elapsedSeconds = [Math]::Max(0.001, ($now - $lastSample).TotalSeconds)
  $lastSample = $now
  $cpuDeltaMs = $null
  $cpuHostPercent = $null
  if ($cpuSource -ne 'unavailable') {
    $cpuDeltaMs = [Math]::Round($cpuSeconds * 1000, 4)
    $cpuHostPercent = [Math]::Round(
      100 * $cpuSeconds / $elapsedSeconds / [Environment]::ProcessorCount, 4
    )
  }

  $samples.Add([pscustomobject]@{
    timestamp_utc = $now.ToUniversalTime().ToString('o')
    scenario = $Scenario
    root_pid = $RootProcessId
    process_count = $processes.Count
    working_set_mb = [Math]::Round($workingSetBytes / 1MB, 2)
    private_bytes_mb = [Math]::Round($privateBytes / 1MB, 2)
    cpu_sampled_processes = $cpuAvailableProcessCount
    cim_cpu_sampled_processes = $cimCpuAvailableProcessCount
    cpu_get_process_delta_ms = [Math]::Round($getProcessCpuSeconds * 1000, 4)
    cpu_cim_delta_ms = [Math]::Round($cimCpuSeconds * 1000, 4)
    cpu_source = $cpuSource
    cpu_delta_ms = $cpuDeltaMs
    cpu_host_percent = $cpuHostPercent
  })
}

if ($samples.Count -eq 0) {
  throw 'No samples were collected: the Electron process ended or was not accessible.'
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $stamp = $started.ToString('yyyyMMdd-HHmmss')
  $OutputPath = Join-Path $env:TEMP "atomic-chat-$Scenario-$stamp.csv"
}
$parentDirectory = Split-Path -Parent $OutputPath
if ($parentDirectory -and -not (Test-Path -LiteralPath $parentDirectory)) {
  [void](New-Item -ItemType Directory -Path $parentDirectory -Force)
}
$samples | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding UTF8

$cpu = @($samples | Where-Object { $null -ne $_.cpu_host_percent } |
  ForEach-Object { [double]$_.cpu_host_percent })
$memory = @($samples | ForEach-Object { [double]$_.working_set_mb })
$meanMemory = ($samples | Measure-Object -Property working_set_mb -Average).Average
Write-Host "Scenario: $Scenario | samples: $($samples.Count) | process tree root: $RootProcessId"
if ($cpu.Count -eq 0) {
  Write-Warning 'CPU counters were unavailable. Do not interpret CPU as zero.'
} else {
  $meanCpu = ($cpu | Measure-Object -Average).Average
  Write-Host ("CPU host avg / p95: {0:N4}% / {1:N4}%" -f $meanCpu, (Get-Percentile95 -Values $cpu))
  if (@($samples | Where-Object { $_.cpu_delta_ms -gt 0 }).Count -eq 0) {
    Write-Warning 'Both Get-Process and CIM CPU deltas were zero for every sample. Verify the target PID and repeat during active rendering.'
  }
}
Write-Host ("Summed working set avg / p95: {0:N2} / {1:N2} MB" -f $meanMemory, (Get-Percentile95 -Values $memory))
Write-Host ("CPU sources (samples): " + (($samples | Group-Object -Property cpu_source | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ', '))
Write-Host "CSV: $OutputPath"
