#requires -Version 7.0
param([switch]$SelfTest)

$ErrorActionPreference = 'Stop'
$allowedServers = @{
    'hexin-ifind-ds-stock-mcp' = 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-stock-mcp'
    'hexin-ifind-ds-news-mcp' = 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-news-mcp'
}

function Assert-UniqueJsonKeys($element) {
    if ($element.ValueKind -eq 'Object') {
        $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($property in $element.EnumerateObject()) {
            if (-not $names.Add($property.Name)) { throw 'Invalid configuration.' }
            Assert-UniqueJsonKeys $property.Value
        }
    } elseif ($element.ValueKind -eq 'Array') {
        foreach ($item in $element.EnumerateArray()) { Assert-UniqueJsonKeys $item }
    }
}

function Read-ExpectedConfig([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text) -or $text.Length -gt 65536) { throw 'Invalid configuration.' }
    $document = [Text.Json.JsonDocument]::Parse($text)
    try { Assert-UniqueJsonKeys $document.RootElement } finally { $document.Dispose() }
    $config = ConvertFrom-Json -InputObject $text -AsHashtable
    if ($config -isnot [Collections.IDictionary] -or $config.Count -ne 1 -or -not $config.Contains('mcpServers')) { throw 'Invalid configuration.' }
    $servers = $config['mcpServers']
    if ($servers -isnot [Collections.IDictionary] -or $servers.Count -ne 2) { throw 'Invalid configuration.' }
    $clean = @{}
    foreach ($name in $allowedServers.Keys) {
        $server = $servers[$name]
        if ($server -isnot [Collections.IDictionary] -or $server.Count -ne 3) { throw 'Invalid configuration.' }
        if ($server['type'] -cne 'streamablehttp' -or $server['url'] -cne $allowedServers[$name]) { throw 'Invalid configuration.' }
        $headers = $server['headers']
        if ($headers -isnot [Collections.IDictionary] -or $headers.Count -ne 1 -or -not $headers.Contains('Authorization')) { throw 'Invalid configuration.' }
        $token = $headers['Authorization']
        if ($token -isnot [string] -or $token.Trim().Length -lt 30 -or $token -match '[\r\n]') { throw 'Invalid configuration.' }
        $clean[$name] = @{ type = 'streamablehttp'; url = $allowedServers[$name]; headers = @{ Authorization = $token } }
    }
    return (@{ mcpServers = $clean } | ConvertTo-Json -Depth 6 -Compress)
}

function Save-EncryptedConfig([string]$text, [string]$directory) {
    $normalized = Read-ExpectedConfig $text
    $secure = ConvertTo-SecureString -String $normalized -AsPlainText -Force
    try { $encrypted = ConvertFrom-SecureString -SecureString $secure } finally { $secure.Dispose() }
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $target = Join-Path $directory 'ifind-mcp.dpapi'
    $temporary = Join-Path $directory ('ifind-mcp-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllText($temporary, $encrypted, [Text.UTF8Encoding]::new($false))
        if ([IO.File]::Exists($target)) {
            $backup = $target + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
            [IO.File]::Replace($temporary, $target, $backup)
        } else {
            [IO.File]::Move($temporary, $target)
        }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

if ($SelfTest) {
    $sampleServers = @{}
    foreach ($name in $allowedServers.Keys) {
        $sampleServers[$name] = @{type='streamablehttp';url=$allowedServers[$name];headers=@{Authorization=('synthetic-test-token-' + ('x' * 32))}}
    }
    $sample = @{mcpServers=$sampleServers} | ConvertTo-Json -Depth 6
    $directory = Join-Path ([IO.Path]::GetTempPath()) ('ifind-setup-test-' + [guid]::NewGuid().ToString('N'))
    try {
        Save-EncryptedConfig $sample $directory
        $target = Join-Path $directory 'ifind-mcp.dpapi'
        $cipher = [IO.File]::ReadAllText($target)
        if ($cipher.Contains('synthetic-test-token')) { throw 'Encryption test failed.' }
        $secure = ConvertTo-SecureString $cipher
        try { $plain = [Net.NetworkCredential]::new('', $secure).Password } finally { $secure.Dispose() }
        $null = Read-ExpectedConfig $plain
        Save-EncryptedConfig $sample $directory
        if (@([IO.Directory]::GetFiles($directory, '*.bak-*')).Count -ne 1) { throw 'Backup test failed.' }
        $badInputs = @(
            $sample.Replace('api-mcp.51ifind.com', 'example.invalid'),
            $sample.Replace('streamablehttp', 'sse'),
            $sample.Replace('synthetic-test-token-', 'synthetic-test-token-\n'),
            '{"mcpServers":{},"mcpServers":{}}',
            '{"mcpServers":{}}',
            'not json'
        )
        foreach ($inputText in $badInputs) {
            $rejected = $false
            try { $null = Read-ExpectedConfig $inputText } catch { $rejected = $true }
            if (-not $rejected) { throw 'Validation test failed.' }
        }
        Write-Output 'PASS: DPAPI save/read, encrypted backup, endpoint/type/header/JSON validation; no network calls.'
    } finally {
        if ([IO.Directory]::Exists($directory)) {
            foreach ($file in [IO.Directory]::GetFiles($directory)) { [IO.File]::Delete($file) }
            [IO.Directory]::Delete($directory)
        }
    }
    exit
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form = [Windows.Forms.Form]::new()
$form.Text = 'iFinD 本机安全配置'
$form.ClientSize = [Drawing.Size]::new(620, 240)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.ShowInTaskbar = $true
$form.Font = [Drawing.Font]::new('Microsoft YaHei UI', 10)
$label = [Windows.Forms.Label]::new()
$label.Location = [Drawing.Point]::new(24, 22)
$label.Size = [Drawing.Size]::new(572, 78)
$label.Text = @('1. 在 iFinD 网页的“生成 MCP 配置”窗口点击“复制”。', '2. 点击下方按钮，保存 A 股数据和新闻公告配置。', '密钥不会显示，仅加密保存到当前 Windows 用户的本机目录。') -join [Environment]::NewLine
$form.Controls.Add($label)
$status = [Windows.Forms.Label]::new()
$status.Location = [Drawing.Point]::new(24, 112)
$status.Size = [Drawing.Size]::new(572, 48)
$status.Text = '尚未保存。此步骤不联网、不消耗试用额度。'
$form.Controls.Add($status)
$save = [Windows.Forms.Button]::new()
$save.Text = '粘贴并加密保存'
$save.Location = [Drawing.Point]::new(24, 174)
$save.Size = [Drawing.Size]::new(200, 40)
$save.Add_Click({
    $save.Enabled = $false
    try {
        # Read the clipboard only in response to the user's button click.
        $inputText = [Windows.Forms.Clipboard]::GetText()
        Save-EncryptedConfig $inputText (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'InvestmentAnswerQA')
        $status.ForeColor = [Drawing.Color]::DarkGreen
        $status.Text = '已加密保存 A 股数据和新闻公告配置。尚未进行联网验证。可以关闭窗口，返回聊天。'
    } catch {
        # Do not expose parser errors, clipboard contents, or credentials.
        $status.ForeColor = [Drawing.Color]::DarkRed
        $status.Text = '保存失败。请确认复制的是仅含 A 股数据、新闻公告的完整 HTTP 配置，再重试。'
        $save.Enabled = $true
    } finally {
        $inputText = $null
    }
})
$form.Controls.Add($save)
$form.Add_Shown({
    $form.TopMost = $true
    $form.Activate()
    $form.TopMost = $false
    $windowStatus = @{ pid = $PID; visible = $form.Visible; title = $form.Text; handle = $form.Handle.ToInt64() }
    $windowStatusPath = Join-Path ([IO.Path]::GetTempPath()) ('ifind-setup-window-' + $PID + '.json')
    [IO.File]::WriteAllText($windowStatusPath, ($windowStatus | ConvertTo-Json -Compress))
})
[void]$form.ShowDialog()
$form.Dispose()
