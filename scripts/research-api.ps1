param(
  [ValidateSet('Preview', 'Publish', 'Get')][string]$Mode = 'Preview',
  [string]$File,
  [string]$BatchId,
  [string]$BaseUrl = 'https://youanalyst.com',
  [string]$Audience = 'https://youanalyst.com',
  [string]$Publisher = 'research-publisher@ifindata-80905.iam.gserviceaccount.com'
)
$ErrorActionPreference = 'Stop'
if (([Uri]$BaseUrl).Scheme -ne 'https' -or ([Uri]$BaseUrl).GetLeftPart([System.UriPartial]::Authority) -ne $Audience) { throw 'Use HTTPS and a matching configured audience.' }
$gcloudCommand = Get-Command gcloud -ErrorAction SilentlyContinue
$gcloudPath = if ($gcloudCommand) { $gcloudCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd' }
if (-not (Test-Path -LiteralPath $gcloudPath)) { throw 'Install Google Cloud CLI and run gcloud auth login first.' }
function Invoke-ResearchApi([string]$ApiPath, [string]$Method, [string]$Body = '') {
  # A new one-hour, audience-bound identity token for each call; never saved or printed.
  $researchToken = (& $gcloudPath auth print-identity-token "--impersonate-service-account=$Publisher" "--audiences=$Audience" --include-email | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $researchToken) { throw 'Could not obtain publishing identity. Check gcloud login and impersonation permission.' }
  $requestHeaders = @{ Authorization = "Bearer $researchToken" }
  try {
    $requestArgs = @{ Uri = "$($BaseUrl.TrimEnd('/'))/api/admin/research/$ApiPath"; Method = $Method; Headers = $requestHeaders; MaximumRedirection = 0 }
    if ($Body) { $requestArgs['Body'] = [System.Text.Encoding]::UTF8.GetBytes($Body); $requestArgs['ContentType'] = 'application/json' }
    Invoke-RestMethod @requestArgs
  } catch {
    $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    throw "Research API failed (HTTP $statusCode). 401: refresh login; 403: publishing identity not allowed; 409: inspect batch content or refresh an expired/stale preview; 413: split batch."
  } finally { $researchToken = $null; $requestHeaders.Clear() }
}
if ($Mode -eq 'Get') {
  if ($BatchId -notmatch '^[a-z0-9-]{1,80}$') { throw 'Provide a valid -BatchId.' }
  Invoke-ResearchApi "batches/$BatchId" 'GET' | ConvertTo-Json -Depth 50
} else {
  if (-not $File) { throw 'Provide -File with the research JSON batch.' }
  $json = Get-Content -LiteralPath $File -Raw
  $preview = Invoke-ResearchApi 'preview' 'POST' $json
  if ($Mode -eq 'Preview' -or $preview.status -eq 'PUBLISHED') { $preview | ConvertTo-Json -Depth 50 }
  else {
    $publishBody = @{ batchId = $preview.id; previewToken = $preview.previewToken } | ConvertTo-Json
    Invoke-ResearchApi 'publish' 'POST' $publishBody | ConvertTo-Json -Depth 50
  }
}
