import * as path from 'node:path';
import { getConfigDir, DEFAULT_MCP_PORT } from '../config.js';

export interface SessionShellIntegration {
  env: Record<string, string>;
  shellArgs: string[];
}

/**
 * Inject CoTerm's built-in commands (list/status/read/run/...) into the
 * session's shell as native functions, so they work everywhere the session
 * shell is used — no attach-side interception needed.
 *
 * For pwsh we generate a profile script that defines the commands and launch
 * the shell with it. For cmd we use doskey macros. For bash/zsh (wsl/ssh)
 * we source a small rc file.
 */
export function buildSessionShellIntegration(
  sessionId: string,
  shell: string,
  shellArgs: string[],
  port: number = DEFAULT_MCP_PORT,
): SessionShellIntegration {
  const host = '127.0.0.1';
  const base = `http://${host}:${port}/cli`;
  const env = {
    COTERM_SESSION: sessionId,
    COTERM_DAEMON: base,
    COTERM_PORT: String(port),
  };

  const name = shell.replace(/\\/g, '/').split('/').pop()?.replace(/\.exe$/i, '') ?? shell;
  const dir = getConfigDir();

  if (name === 'pwsh' || name === 'powershell') {
    const scriptPath = path.join(dir, `session-${sessionId}.ps1`);
    const script = generatePwshScript(base, sessionId);
    writeFile(scriptPath, script);
    // Keep user profile but ensure our script loads after it.
    return {
      env,
      shellArgs: ['-NoLogo', '-NoExit', '-Command', `. '${scriptPath.replace(/'/g, "''")}'`],
    };
  }

  if (name === 'cmd') {
    // cmd.exe has no shell functions; expose the env vars only (users can
    // use `coterm run ...` / the CLI for built-ins).
    return { env, shellArgs };
  }

  // bash / zsh / sh (wsl, ssh, docker, local on POSIX)
  const rcPath = path.join(dir, `session-${sessionId}.sh`);
  writeFile(rcPath, generateBashScript(base, sessionId));
  const existing = shellArgs.filter((a) => !a.startsWith('--rcfile') && a !== '-i');
  return {
    env,
    shellArgs: [...existing, '-i', '--rcfile', rcPath],
  };
}

function generatePwshScript(base: string, sessionId: string): string {
  return `
# CoTerm session integration (generated)
$script:CoTermBase = '${base}'
$script:CoTermSession = '${sessionId}'
function Invoke-CoTerm {
  param([string]$Tool, [hashtable]$Params = @{})
  $body = @{ tool = $Tool; args = $Params } | ConvertTo-Json -Depth 6 -Compress
  try {
    $r = Invoke-RestMethod -Uri $script:CoTermBase -Method Post -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 30
    if ($r.isError) { Write-Output "[error] $($r.text)"; return }
    $r.text
  } catch {
    Write-Output "[coterm error] $($_.Exception.Message)"
  }
}
function list  { Invoke-CoTerm -Tool 'terminal_list' -Params @{} }
function status { Invoke-CoTerm -Tool 'terminal_status' -Params @{sessionId=$script:CoTermSession} }
function read   { Invoke-CoTerm -Tool 'terminal_read' -Params @{sessionId=$script:CoTermSession; lines=$(if ($args.Count) { [int]$args[0] } else { 50 })} }
function history{ Invoke-CoTerm -Tool 'terminal_history' -Params @{sessionId=$script:CoTermSession; limit=$(if ($args.Count) { [int]$args[0] } else { 50 })} }
function run    { Invoke-CoTerm -Tool 'terminal_run' -Params @{sessionId=$script:CoTermSession; command=($args -join ' '); timeout=30000} }
function interrupt { Invoke-CoTerm -Tool 'terminal_interrupt' -Params @{sessionId=$script:CoTermSession} }
`;
}

function generateBashScript(base: string, sessionId: string): string {
  return [
    '# CoTerm session integration (generated)',
    `export COTERM_SESSION=${sessionId}`,
    '_coterm_call() {',
    '  # usage: _coterm_call <tool> <json-args>',
    `  curl -s -X POST '${base}' -H 'Content-Type: application/json' -d "{\\"tool\\":\\"$1\\",\\"args\\":$2}" 2>/dev/null`,
    '  echo',
    '}',
    '_coterm_escape() { printf "%s" "$*" | sed \'s/\\\\/\\\\\\\\/g; s/"/\\\\"/g\' ; }',
    `list()      { _coterm_call terminal_list '{}'; }`,
    `status()    { _coterm_call terminal_status '{"sessionId":"${sessionId}"}'; }`,
    `read()      { _coterm_call terminal_read "{\\"sessionId\\":\\"${sessionId}\\",\\"lines\\":${'${1:-50}'}}"; }`,
    `history()   { _coterm_call terminal_history "{\\"sessionId\\":\\"${sessionId}\\",\\"limit\\":${'${1:-50}'}}"; }`,
    `run()       { _coterm_call terminal_run "{\\"sessionId\\":\\"${sessionId}\\",\\"command\\":\\"$(_coterm_escape "$*")\\",\\"timeout\\":30000}"; }`,
    `interrupt() { _coterm_call terminal_interrupt '{"sessionId":"${sessionId}"}'; }`,
  ].join('\n');
}

function writeFile(filePath: string, content: string): void {
  const fs = require('node:fs') as typeof import('node:fs');
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content.replace(/^\n/, ''), 'utf8');
  } catch {
    // best-effort: integration is optional
  }
}
