#requires -Version 7.0
param(
    [ValidateSet('stock', 'news', 'both')][string]$Service = 'both',
    [string]$ToolName = '',
    [string]$ArgumentsPath = ''
)
$ErrorActionPreference = 'Stop'
$reportRoot = Join-Path $PSScriptRoot '..\private'
[IO.Directory]::CreateDirectory($reportRoot) | Out-Null
$timestamp = [DateTimeOffset]::UtcNow.ToString('o')
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$allowedEndpoints = @{
    stock = 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-stock-mcp'
    news = 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-news-mcp'
}
$script:requestCount = 0

function Send-McpMessage($client, [string]$url, [string]$token, [string]$session, [string]$protocol, $message) {
    $script:requestCount++
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, $url)
    $request.Headers.TryAddWithoutValidation('Authorization', $token) | Out-Null
    $request.Headers.TryAddWithoutValidation('Accept', 'application/json, text/event-stream') | Out-Null
    if ($session) { $request.Headers.TryAddWithoutValidation('Mcp-Session-Id', $session) | Out-Null }
    if ($protocol) { $request.Headers.TryAddWithoutValidation('MCP-Protocol-Version', $protocol) | Out-Null }
    $request.Content = [Net.Http.StringContent]::new(($message | ConvertTo-Json -Depth 20 -Compress), [Text.Encoding]::UTF8, 'application/json')
    $timeout = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(25))
    $response = $null
    try {
        $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $timeout.Token).GetAwaiter().GetResult()
        $httpStatus = [int]$response.StatusCode
        if (-not $response.IsSuccessStatusCode) { throw ('HTTP_' + $httpStatus) }
        $sessionValues = $null
        $newSession = if ($response.Headers.TryGetValues('Mcp-Session-Id', [ref]$sessionValues)) { [string]($sessionValues | Select-Object -First 1) } else { $session }
        if (-not $message.Contains('id')) { return @{http=$httpStatus;session=$newSession;message=$null} }
        if ($response.Content.Headers.ContentType.MediaType -eq 'text/event-stream') {
            $stream = $response.Content.ReadAsStreamAsync($timeout.Token).GetAwaiter().GetResult()
            $reader = [IO.StreamReader]::new($stream)
            try {
                $dataLines = [Collections.Generic.List[string]]::new()
                $received = 0
                while (-not $timeout.IsCancellationRequested) {
                    $line = $reader.ReadLineAsync($timeout.Token).AsTask().GetAwaiter().GetResult()
                    if ($null -eq $line) { break }
                    $received += $line.Length
                    if ($received -gt 2097152) { throw 'RESPONSE_TOO_LARGE' }
                    if ($line.StartsWith('data:')) { $dataLines.Add($line.Substring(5).TrimStart()) }
                    if ($line -eq '' -and $dataLines.Count -gt 0) {
                        $payload = ($dataLines -join "`n").Replace($token, '[REDACTED]') | ConvertFrom-Json -AsHashtable
                        $dataLines.Clear()
                        if ($payload['id'] -eq $message['id']) { return @{http=$httpStatus;session=$newSession;message=$payload} }
                    }
                }
                throw 'NO_RPC_RESPONSE'
            } finally { $reader.Dispose() }
        } else {
            $raw = $response.Content.ReadAsStringAsync($timeout.Token).GetAwaiter().GetResult()
            if ($raw.Length -gt 2097152) { throw 'RESPONSE_TOO_LARGE' }
            $payload = $raw.Replace($token, '[REDACTED]') | ConvertFrom-Json -AsHashtable
            return @{http=$httpStatus;session=$newSession;message=$payload}
        }
    } finally {
        if ($response) { $response.Dispose() }
        $request.Dispose()
        $timeout.Dispose()
    }
}

try {
    $secretPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'InvestmentAnswerQA\ifind-mcp.dpapi'
    $secure = ConvertTo-SecureString ([IO.File]::ReadAllText($secretPath))
    try { $config = [Net.NetworkCredential]::new('', $secure).Password | ConvertFrom-Json -AsHashtable } finally { $secure.Dispose() }
} catch {
    Write-Output '{"ok":false,"stage":"read_configuration","detail":"Encrypted configuration could not be read."}'
    exit 1
}

$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$handler.UseCookies = $false
$client = [Net.Http.HttpClient]::new($handler)
$results = @()
$services = if ($Service -eq 'both') { @('stock', 'news') } else { @($Service) }
try {
    foreach ($name in $services) {
        $stage = 'validate_configuration'
        $entry = [ordered]@{service=$name;ok=$false;startedAt=$timestamp;httpRequests=0}
        $before = $script:requestCount
        try {
            $server = $config['mcpServers'][('hexin-ifind-ds-' + $name + '-mcp')]
            if ($server['url'] -cne $allowedEndpoints[$name] -or $server['type'] -cne 'streamablehttp') { throw 'INVALID_CONFIGURATION' }
            $token = $server['headers']['Authorization']
            if ($token -isnot [string] -or $token.Length -lt 30 -or $token -match '[\r\n]') { throw 'INVALID_CONFIGURATION' }
            $stage = 'initialize'
            $initial = Send-McpMessage $client $server['url'] $token '' '' @{jsonrpc='2.0';id=1;method='initialize';params=@{protocolVersion='2025-06-18';capabilities=@{};clientInfo=@{name='investment-answer-qa';version='0.1.0'}}}
            if ($initial.message['error']) { throw 'RPC_INITIALIZATION_ERROR' }
            $protocol = [string]$initial.message['result']['protocolVersion']
            if ($protocol -notin @('2024-11-05','2025-03-26','2025-06-18')) { throw 'UNSUPPORTED_PROTOCOL' }
            $stage = 'initialized_notification'
            $null = Send-McpMessage $client $server['url'] $token $initial.session $protocol @{jsonrpc='2.0';method='notifications/initialized'}
            $stage = 'tools_list'
            $listed = Send-McpMessage $client $server['url'] $token $initial.session $protocol @{jsonrpc='2.0';id=2;method='tools/list';params=@{}}
            if ($listed.message['error']) { throw 'RPC_TOOLS_ERROR' }
            $tools = @($listed.message['result']['tools'])
            if ($tools.Count -eq 0) { throw 'NO_TOOLS' }
            $entry.protocol = $protocol
            $entry.tools = @($tools | ForEach-Object { $_['name'] })
            $schemaPath = Join-Path $reportRoot ('ifind-' + $name + '-tools.json')
            [IO.File]::WriteAllText($schemaPath, (@{retrievedAt=$timestamp;service=$name;tools=$tools} | ConvertTo-Json -Depth 50))
            if ($ToolName) {
                $stage = 'validate_tool'
                if ($Service -eq 'both' -or -not $ArgumentsPath -or $ToolName -notin $entry.tools) { throw 'INVALID_TOOL_SELECTION' }
                $arguments = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $ArgumentsPath).Path) | ConvertFrom-Json -AsHashtable
                $stage = 'tools_call'
                $called = Send-McpMessage $client $server['url'] $token $initial.session $protocol @{jsonrpc='2.0';id=3;method='tools/call';params=@{name=$ToolName;arguments=$arguments}}
                $dataPath = Join-Path $reportRoot ('ifind-' + $name + '-' + $stamp + '.json')
                [IO.File]::WriteAllText($dataPath, (@{retrievedAt=$timestamp;service=$name;tool=$ToolName;arguments=$arguments;response=$called.message} | ConvertTo-Json -Depth 70))
                $entry.dataFile = [IO.Path]::GetFileName($dataPath)
                if ($called.message['error'] -or $called.message['result']['isError']) { throw 'TOOL_REPORTED_ERROR' }
            }
            $entry.ok = $true
        } catch {
            $entry.stage = $stage
            $entry.error = 'Request or validation failed; no raw exception or credential was logged.'
            if ($_.Exception.Message -match '^HTTP_[0-9]{3}$') { $entry.error = $_.Exception.Message }
        }
        $entry.httpRequests = $script:requestCount - $before
        $results += $entry
    }
} finally { $client.Dispose(); $handler.Dispose(); $config = $null; $token = $null }
$summary = @{at=$timestamp;httpRequests=$script:requestCount;results=$results}
[IO.File]::WriteAllText((Join-Path $reportRoot ('ifind-check-' + $stamp + '.json')), ($summary | ConvertTo-Json -Depth 8))
$summary | ConvertTo-Json -Depth 8
if (@($results | Where-Object { -not $_.ok }).Count -gt 0) { exit 1 }
