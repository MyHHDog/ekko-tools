param([string]$Method = 'GET', [string]$Path = '/api/studio/plugins', [string]$Body = '')
$ErrorActionPreference = 'Stop'
try {
  $params = @{ Uri = "http://127.0.0.1:8748$Path"; Method = $Method; UseBasicParsing = $true }
  if ($Body) { $params.ContentType = 'application/json'; $params.Body = $Body }
  (Invoke-WebRequest @params).Content
} catch {
  $_.Exception.Message
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $reader.ReadToEnd()
  }
  exit 1
}
