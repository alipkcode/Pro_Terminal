import { app } from 'electron'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { LAUNCHER_MOODS, LIMITS } from '@shared/defaults'
import type { ActionSpec, ShellFamily } from '@shared/types'
import { isObject, oneOf, str } from './store/util'

// ---------------------------------------------------------------------------------------------
// Folder actions: a script saved as a small Windows program (.exe) that runs it in the folder the
// file sits in. The program is compiled on this PC with the C# compiler that ships with Windows
// (.NET Framework 4), so it gets the shortcut's colored icon and needs nothing installed to run.
//
// Opened, the program hands itself to Pro Terminal (--action-file=<path>) when Pro Terminal is installed;
// Pro Terminal reads the action back out of the file and asks before running it. Without Pro Terminal,
// the program asks itself (a message box) and runs the script in a console window.
//
// Both ways run the same runner scripts, generated here: they list the folders first (this folder, or it
// and every subfolder, deepest first), then run the user's script in each one.
// ---------------------------------------------------------------------------------------------

const MARK = 'PTACTION1:'
const MARK_END = ':END'
const PRELUDE_PS = '# @@PT-PRELUDE@@'
const PRELUDE_CMD = 'rem @@PT-PRELUDE@@'
/** Run folders older than this are cleaned up. */
const KEEP_RUNS_MS = 2 * 24 * 3600_000

const familyOf = (shell: ActionSpec['shell']): ShellFamily => (shell === 'cmd' ? 'cmd' : 'powershell')

/** Replace each `__KEY__` in one pass, so inserted text (a user's script) is never scanned again. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/__([A-Z][A-Z_]*?)__/g, (m, k: string) => (k in values ? values[k] : m))
}

/** A PowerShell single-quoted string. PowerShell also treats the curly quotes as single quotes. */
const psQuote = (s: string): string => `'${s.replace(/['‘’‚‛]/g, '$&$&')}'`

/** Text for `echo` in a batch file: special characters escaped, one line. */
const cmdEcho = (s: string): string => s.replace(/[\r\n]+/g, ' ').replace(/[\^&|<>]/g, '^$&').replace(/%/g, '%%')

// ---------------------------------------------------------------------------------------------
// Runner scripts
// ---------------------------------------------------------------------------------------------

/** Lists $root (and, with $recursive, every subfolder) into $folders, deepest level first. */
const LIST_PS = String.raw`$folders = New-Object System.Collections.Generic.List[string]
if ($recursive) {
  # Hidden and system folders (.git, $RECYCLE.BIN...) and links to other folders are left out.
  $skip = [int]([IO.FileAttributes]'Hidden, System, ReparsePoint')
  $levels = New-Object System.Collections.Generic.List[object]
  $level = [string[]]@($root)
  $unreadable = 0
  while ($level.Length -gt 0) {
    $levels.Add($level)
    $next = New-Object System.Collections.Generic.List[string]
    foreach ($d in $level) {
      try {
        foreach ($c in [IO.Directory]::GetDirectories($d)) {
          if (([int][IO.File]::GetAttributes($c) -band $skip) -eq 0) { $next.Add($c) }
        }
      } catch { $unreadable++ }
    }
    $next.Sort([StringComparer]::OrdinalIgnoreCase)
    $level = $next.ToArray()
  }
  # Deepest folders first: renaming things inside a folder never changes the path of a folder still waiting.
  for ($i = $levels.Count - 1; $i -ge 0; $i--) { $folders.AddRange([string[]]$levels[$i]) }
  if ($unreadable) { Write-Host "  $unreadable folder(s) could not be read and are skipped." -ForegroundColor Yellow }
} else {
  $folders.Add($root)
}`

const RUN_PS = String.raw`${PRELUDE_PS}
& {
$ErrorActionPreference = 'Continue'
$name = __NAME__
$root = $PtRoot
$recursive = __RECURSIVE__
try { $Host.UI.RawUI.WindowTitle = $name } catch {}
Write-Host ''
Write-Host "  $name" -ForegroundColor Cyan
__DESCRIPTION__
Write-Host "  in $root" -ForegroundColor DarkGray
if ($recursive) { Write-Host '  Listing this folder and every subfolder...' -ForegroundColor DarkGray }
${LIST_PS}
$action = {
__SCRIPT__
}
$total = $folders.Count
$done = 0
$failed = 0
$started = Get-Date
$saved = @($env:PT_ACTION_FILE, $env:PT_ACTION_ROOT, $env:PT_ACTION_FOLDER)
$env:PT_ACTION_FILE = $PtSelf
$env:PT_ACTION_ROOT = $root
try {
  foreach ($f in $folders) {
    $done++
    $rel = if ($f -eq $root) { '.' } else { $f.Substring($root.TrimEnd('\').Length + 1) }
    Write-Host ''
    Write-Host "[$done/$total] $rel" -ForegroundColor Cyan
    try { Set-Location -LiteralPath $f -ErrorAction Stop } catch { Write-Host "  could not open this folder: $($_.Exception.Message)" -ForegroundColor Red; $failed++; continue }
    $env:PT_ACTION_FOLDER = $f
    try { & $action } catch { Write-Host "  $($_.Exception.Message)" -ForegroundColor Red; $failed++ }
  }
} finally {
  $env:PT_ACTION_FILE = $saved[0]
  $env:PT_ACTION_ROOT = $saved[1]
  $env:PT_ACTION_FOLDER = $saved[2]
  try { Set-Location -LiteralPath $root } catch {}
}
$secs = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
Write-Host ''
if ($failed) { Write-Host "  Finished with $failed problem(s) - $total folder(s) in $secs s" -ForegroundColor Yellow }
else { Write-Host "  Done - $total folder(s) in $secs s" -ForegroundColor Green }
}
`

/** CMD lists folders through PowerShell: cmd's own dir /s walks into hidden folders and folder links. */
const LIST_CMD_PS = String.raw`$root = $env:PT_ACTION_ROOT
$recursive = $true
${LIST_PS}
[IO.File]::WriteAllLines($env:PT_ACTION_LIST, $folders, (New-Object Text.UTF8Encoding $false))
`

const RUN_CMD = String.raw`@echo off
chcp 65001 >nul
setlocal
${PRELUDE_CMD}
title __TITLE__
echo(
echo(  __NAME__
__DESCRIPTION__
setlocal EnableDelayedExpansion
echo(  in !PT_ACTION_ROOT!
endlocal
set "PT_ACTION_I=0"
if "__RECURSIVE__"=="1" goto :pt_all
set "PT_ACTION_TOTAL=1"
set "PT_ACTION_FOLDER=%PT_ACTION_ROOT%"
call :pt_one
goto :pt_done

:pt_all
echo(  Listing this folder and every subfolder...
set "PT_ACTION_LIST=%~dp0folders.txt"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0list.ps1"
set "PT_ACTION_TOTAL=0"
for /f %%C in ('type "%PT_ACTION_LIST%" ^| find /c /v ""') do set "PT_ACTION_TOTAL=%%C"
for /f "usebackq delims=" %%D in ("%PT_ACTION_LIST%") do (
  set "PT_ACTION_FOLDER=%%D"
  call :pt_one
)
goto :pt_done

:pt_one
set /a PT_ACTION_I+=1
setlocal EnableDelayedExpansion
echo(
echo([!PT_ACTION_I!/%PT_ACTION_TOTAL%] !PT_ACTION_FOLDER!
endlocal
pushd "%PT_ACTION_FOLDER%" 2>nul || (
  echo   could not open this folder
  exit /b
)
call "%~dp0action.cmd"
popd
exit /b

:pt_done
cd /d "%PT_ACTION_ROOT%"
echo(
echo(  Done - %PT_ACTION_TOTAL% folder(s)
`

export interface RunnerFiles {
  entry: string
  files: Record<string, string>
}

/** The runner scripts for an action, with a prelude marker where the folder and file go. */
export function runnerFiles(a: ActionSpec): RunnerFiles {
  const desc = a.description.split(/\r?\n/).filter((l) => l.trim())
  if (familyOf(a.shell) === 'powershell') {
    const run = fill(RUN_PS, {
      NAME: psQuote(a.name),
      RECURSIVE: a.recursive ? '$true' : '$false',
      DESCRIPTION: desc.map((l) => `Write-Host ${psQuote(`  ${l}`)} -ForegroundColor DarkGray`).join('\n'),
      SCRIPT: a.script
    })
    return { entry: 'run.ps1', files: { 'run.ps1': run } }
  }
  const run = fill(RUN_CMD, {
    TITLE: a.name.replace(/[&|<>^%"\r\n]/g, ''),
    NAME: cmdEcho(a.name),
    RECURSIVE: a.recursive ? '1' : '0',
    DESCRIPTION: desc.map((l) => `echo(  ${cmdEcho(l)}`).join('\r\n')
  })
  const files: Record<string, string> = {
    'run.cmd': run.replace(/\r?\n/g, '\r\n'),
    'action.cmd': a.script.replace(/\r?\n/g, '\r\n') + '\r\n'
  }
  if (a.recursive) files['list.ps1'] = LIST_CMD_PS
  return { entry: 'run.cmd', files }
}

function prelude(shell: ActionSpec['shell'], root: string, self: string): string {
  return familyOf(shell) === 'cmd'
    ? `set "PT_ACTION_ROOT=${root.replace(/%/g, '%%')}"\r\nset "PT_ACTION_FILE=${self.replace(/%/g, '%%')}"`
    : `$PtRoot = ${psQuote(root)}\r\n$PtSelf = ${psQuote(self)}`
}

/** Write the runner files to a folder. PowerShell files get a BOM (Windows PowerShell reads ANSI otherwise); batch files must not. */
function writeRunner(dir: string, r: RunnerFiles, shell: ActionSpec['shell'], root: string, self: string): string {
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(r.files)) {
    const body = name === r.entry ? text.replace(familyOf(shell) === 'cmd' ? PRELUDE_CMD : PRELUDE_PS, () => prelude(shell, root, self)) : text
    writeFileSync(join(dir, name), (name.endsWith('.ps1') ? '\ufeff' : '') + body, 'utf8')
  }
  return join(dir, r.entry)
}

function cleanOldRuns(dir: string): void {
  if (!existsSync(dir)) return
  const now = Date.now()
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    try {
      if (now - statSync(p).mtimeMs > KEEP_RUNS_MS) rmSync(p, { recursive: true, force: true })
    } catch {
      /* in use or gone */
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The program (C#)
// ---------------------------------------------------------------------------------------------

const PROGRAM_CS = String.raw`using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle(@"__TITLE__")]
[assembly: AssemblyDescription(@"__DESCRIPTION__")]
[assembly: AssemblyProduct("Pro Terminal folder action")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class FolderAction
{
    const string Name = @"__NAME__";
    const string Description = @"__DESCRIPTION__";
    const string Shell = "__SHELL__";
    const bool Recursive = __RECURSIVE__;
    const string Script = @"__SCRIPT__";
    const string Entry = "__ENTRY__";
    static readonly string[] FileNames = { __FILE_NAMES__ };
    static readonly string[] FileTexts = { __FILE_TEXTS__ };
    // The Pro Terminal that made this file, and the arguments it needs first.
    const string MadeWith = @"__APP__";
    const string MadeWithArgs = @"__APP_ARGS__";

    [STAThread]
    static int Main()
    {
        string self = Assembly.GetExecutingAssembly().Location;
        string folder = Path.GetDirectoryName(self);
        string args;
        string app = FindProTerminal(out args);
        if (app != null)
        {
            try
            {
                // Pro Terminal reads the action from this file and asks before running it.
                var psi = new ProcessStartInfo(app, args + "--action-file=\"" + self + "\"");
                psi.UseShellExecute = false;
                psi.WorkingDirectory = folder;
                Process.Start(psi);
                return 0;
            }
            catch { }
        }
        Application.EnableVisualStyles();
        var answer = MessageBox.Show(Confirmation(folder), Name + " - folder action", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes) return 1;
        try
        {
            RunInConsole(folder, self);
            return 0;
        }
        catch (Exception e)
        {
            MessageBox.Show("The action could not start.\n\n" + e.Message, Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }
    }

    static string FindProTerminal(out string args)
    {
        args = "";
        if (MadeWith.Length > 0 && File.Exists(MadeWith))
        {
            args = MadeWithArgs;
            return MadeWith;
        }
        foreach (string dir in InstallFolders())
        {
            try
            {
                string exe = Path.Combine(dir, "Pro Terminal.exe");
                if (File.Exists(exe)) return exe;
            }
            catch { }
        }
        return null;
    }

    /** Where Pro Terminal may be installed: its uninstall entries, then the default folders. */
    static IEnumerable<string> InstallFolders()
    {
        var found = new List<string>();
        foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        foreach (RegistryView view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            try
            {
                using (var root = RegistryKey.OpenBaseKey(hive, view))
                using (var list = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
                {
                    if (list == null) continue;
                    foreach (string key in list.GetSubKeyNames())
                    {
                        using (var entry = list.OpenSubKey(key))
                        {
                            if (entry == null) continue;
                            string display = entry.GetValue("DisplayName") as string ?? "";
                            if (!display.StartsWith("Pro Terminal")) continue;
                            string location = (entry.GetValue("InstallLocation") as string ?? "").Trim().Trim('"');
                            if (location.Length > 0) found.Add(location);
                            foreach (string name in new[] { "DisplayIcon", "UninstallString" })
                            {
                                string file = FilePart(entry.GetValue(name) as string);
                                if (file.Length > 0) found.Add(Path.GetDirectoryName(file));
                            }
                        }
                    }
                }
            }
            catch { }
        }
        found.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\pro-terminal"));
        found.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Pro Terminal"));
        return found;
    }

    /** The file in a registry value like "C:\x\y.exe" /arg or C:\x\y.ico,0. */
    static string FilePart(string value)
    {
        string s = (value ?? "").Trim();
        if (s.StartsWith("\""))
        {
            int end = s.IndexOf('"', 1);
            return end > 1 ? s.Substring(1, end - 1) : "";
        }
        int comma = s.LastIndexOf(',');
        if (comma > 0) s = s.Substring(0, comma);
        try { return Path.IsPathRooted(s) ? s : ""; } catch { return ""; }
    }

    static string ShellLabel()
    {
        return Shell == "cmd" ? "Command Prompt" : Shell == "pwsh" ? "PowerShell 7" : "Windows PowerShell";
    }

    static string Confirmation(string folder)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Run this folder action here?");
        sb.AppendLine();
        sb.AppendLine(Name);
        if (Description.Length > 0) sb.AppendLine(Description.Length > 200 ? Description.Substring(0, 199) + "…" : Description);
        sb.AppendLine();
        sb.AppendLine("Folder:   " + folder);
        sb.AppendLine("Applies to:   " + (Recursive ? "this folder and every subfolder, deepest first (hidden and system folders are skipped)" : "this folder only"));
        sb.AppendLine("Shell:   " + ShellLabel());
        string root = Path.GetPathRoot(folder);
        if (Recursive && root != null && root.TrimEnd('\\').Equals(folder.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
        {
            sb.AppendLine();
            sb.AppendLine("Careful: this is the top of the drive, so it runs in every folder on it.");
        }
        sb.AppendLine();
        sb.AppendLine("Script:");
        // A message box wraps long lines and grows past the screen, hiding its buttons: keep it short.
        string[] lines = Script.Replace("\r\n", "\n").Split('\n');
        int shown = Math.Min(lines.Length, 8);
        for (int i = 0; i < shown; i++)
        {
            string line = lines[i].Replace("\t", "  ");
            sb.AppendLine("    " + (line.Length > 52 ? line.Substring(0, 51) + "…" : line));
        }
        if (lines.Length > shown) sb.AppendLine("    … " + (lines.Length - shown) + " more lines");
        sb.AppendLine();
        sb.Append("Pro Terminal isn't installed, so this runs in a console window.");
        return sb.ToString();
    }

    static string PsQuote(string s)
    {
        var sb = new StringBuilder("'");
        foreach (char c in s)
        {
            sb.Append(c);
            if (c == '\'' || c == '\u2018' || c == '\u2019' || c == '\u201A' || c == '\u201B') sb.Append(c);
        }
        return sb.Append('\'').ToString();
    }

    static string PowerShellPath()
    {
        string sys = Environment.GetFolderPath(Environment.SpecialFolder.System);
        string windowsPs = Path.Combine(sys, @"WindowsPowerShell\v1.0\powershell.exe");
        if (Shell != "pwsh") return windowsPs;
        var candidates = new List<string>();
        foreach (string pf in new[] { Environment.GetEnvironmentVariable("ProgramW6432"), Environment.GetEnvironmentVariable("ProgramFiles") })
        {
            if (!string.IsNullOrEmpty(pf)) candidates.Add(Path.Combine(pf, @"PowerShell\7\pwsh.exe"));
        }
        candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\WindowsApps\pwsh.exe"));
        foreach (string c in candidates) if (File.Exists(c)) return c;
        return windowsPs;
    }

    static void RunInConsole(string folder, string self)
    {
        string baseDir = Path.Combine(Path.GetTempPath(), "ProTerminal-actions");
        CleanOld(baseDir);
        string dir = Path.Combine(baseDir, DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6));
        Directory.CreateDirectory(dir);
        bool cmd = Shell == "cmd";
        string prelude = cmd
            ? "set \"PT_ACTION_ROOT=" + folder.Replace("%", "%%") + "\"\r\nset \"PT_ACTION_FILE=" + self.Replace("%", "%%") + "\""
            : "$PtRoot = " + PsQuote(folder) + "\r\n$PtSelf = " + PsQuote(self);
        for (int i = 0; i < FileNames.Length; i++)
        {
            string text = FileTexts[i];
            if (FileNames[i] == Entry) text = text.Replace(cmd ? "rem @@PT-PRELUDE@@" : "# @@PT-PRELUDE@@", prelude);
            // PowerShell needs the BOM to read UTF-8; a batch file must not have one.
            File.WriteAllText(Path.Combine(dir, FileNames[i]), text, new UTF8Encoding(FileNames[i].EndsWith(".ps1")));
        }
        string entry = Path.Combine(dir, Entry);
        ProcessStartInfo psi = cmd
            ? new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe", "/K \"\"" + entry + "\"\"")
            : new ProcessStartInfo(PowerShellPath(), "-NoLogo -NoExit -ExecutionPolicy Bypass -File \"" + entry + "\"");
        // Opens in the default terminal (Windows Terminal on Windows 11), or a console window.
        psi.UseShellExecute = false;
        psi.WorkingDirectory = folder;
        Process.Start(psi);
    }

    static void CleanOld(string dir)
    {
        try
        {
            if (!Directory.Exists(dir)) return;
            foreach (string d in Directory.GetDirectories(dir))
            {
                try { if (DateTime.Now - Directory.GetLastWriteTime(d) > TimeSpan.FromDays(2)) Directory.Delete(d, true); } catch { }
            }
        }
        catch { }
    }
}
`

/** A C# verbatim string body: quotes doubled, control characters other than tabs and line breaks removed. */
const csVerbatim = (s: string): string => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/"/g, '""')

function compilerPath(): string | null {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  for (const fw of ['Framework64', 'Framework']) {
    const p = join(root, 'Microsoft.NET', fw, 'v4.0.30319', 'csc.exe')
    if (existsSync(p)) return p
  }
  return null
}

function run(file: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${String(stdout || stderr || err.message).trim().split(/\r?\n/).slice(0, 6).join('\n')}`))
      else resolve(stdout)
    })
  })
}

/** The payload Pro Terminal reads back out of the file. */
function payload(a: ActionSpec): string {
  return MARK + Buffer.from(JSON.stringify({ v: 1, ...a }), 'utf8').toString('base64') + MARK_END
}

/** Compile an action into `out` with the given .ico. */
export async function buildActionProgram(a: ActionSpec, icon: Buffer, out: string): Promise<void> {
  const csc = compilerPath()
  if (!csc) throw new Error('The C# compiler that comes with Windows (.NET Framework 4) was not found on this PC.')
  const r = runnerFiles(a)
  const names = Object.keys(r.files)
  // Unpackaged (development) runs need the app folder as Electron's first argument.
  const appArgs = app.isPackaged ? '' : `"${app.getAppPath()}" `
  const source = fill(PROGRAM_CS, {
    TITLE: csVerbatim(a.name),
    NAME: csVerbatim(a.name),
    DESCRIPTION: csVerbatim(a.description),
    SHELL: a.shell,
    RECURSIVE: a.recursive ? 'true' : 'false',
    SCRIPT: csVerbatim(a.script),
    ENTRY: r.entry,
    FILE_NAMES: names.map((n) => `"${n}"`).join(', '),
    FILE_TEXTS: names.map((n) => `@"${csVerbatim(r.files[n])}"`).join(', '),
    APP: csVerbatim(process.execPath),
    APP_ARGS: csVerbatim(appArgs)
  })
  // Short, space-free names in a private folder keep the compiler's command line simple.
  const work = join(tmpdir(), `pt-build-${randomBytes(5).toString('hex')}`)
  mkdirSync(work, { recursive: true })
  try {
    writeFileSync(join(work, 'program.cs'), '\ufeff' + source, 'utf8')
    writeFileSync(join(work, 'payload.txt'), payload(a), 'ascii')
    writeFileSync(join(work, 'icon.ico'), icon)
    await run(
      csc,
      [
        '/nologo',
        '/target:winexe',
        '/platform:anycpu',
        '/optimize+',
        '/codepage:65001',
        '/utf8output',
        '/win32icon:icon.ico',
        '/resource:payload.txt,PtAction',
        '/reference:System.Windows.Forms.dll',
        '/out:action.exe',
        'program.cs'
      ],
      work
    )
    copyFileSync(join(work, 'action.exe'), out)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------------------------
// Reading an action file, and running an action in Pro Terminal
// ---------------------------------------------------------------------------------------------

const COLOR_RE = /^#[0-9a-f]{6}$/i

export function normActionSpec(v: unknown): ActionSpec | null {
  if (!isObject(v)) return null
  const script = str(v.script, '', LIMITS.snippetCommandLength).replace(/\s+$/, '')
  if (!script.trim()) return null
  return {
    id: str(v.id, '', 64),
    name: str(v.name, '', LIMITS.nameLength).trim() || 'Folder action',
    description: str(v.description, '', LIMITS.descriptionLength).trim(),
    color: typeof v.color === 'string' && COLOR_RE.test(v.color) ? v.color : LAUNCHER_MOODS[0].color,
    shell: oneOf(v.shell, ['cmd', 'powershell', 'pwsh'] as const, 'powershell'),
    script,
    recursive: v.recursive === true
  }
}

/** Read the action out of a folder action file. Throws a readable message when it isn't one. */
export async function readActionFile(file: string): Promise<ActionSpec> {
  if (!isAbsolute(file) || !/\.exe$/i.test(file)) throw new Error('This is not a folder action file.')
  const st = statSync(file)
  if (!st.isFile() || st.size > 32 * 1024 * 1024) throw new Error('This is not a folder action file.')
  const text = (await readFile(file)).toString('latin1')
  const start = text.indexOf(MARK)
  const end = start >= 0 ? text.indexOf(MARK_END, start) : -1
  if (start < 0 || end < 0) throw new Error('This file was not made by Pro Terminal, so it has no folder action in it.')
  let spec: ActionSpec | null = null
  try {
    spec = normActionSpec(JSON.parse(Buffer.from(text.slice(start + MARK.length, end), 'base64').toString('utf8')))
  } catch {
    /* damaged */
  }
  if (!spec) throw new Error('The folder action in this file is damaged.')
  return spec
}

export class ActionRuns {
  private readonly dir: string

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'actions')
    try {
      cleanOldRuns(this.dir)
    } catch {
      /* not important */
    }
  }

  /**
   * Write the runner for one run, with the folder baked in, and return the line to type into a session
   * of the action's shell. PowerShell runs it as a script block, so the execution policy doesn't apply.
   */
  prepare(a: ActionSpec, folder: string, file: string | undefined): string {
    const dir = join(this.dir, `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${randomBytes(3).toString('hex')}`)
    const entry = writeRunner(dir, runnerFiles(a), a.shell, folder, file ?? '')
    return familyOf(a.shell) === 'cmd' ? `call "${entry}"` : `& ([scriptblock]::Create([IO.File]::ReadAllText(${psQuote(entry)})))`
  }
}

/** The folder an action file runs in. */
export const actionFolderOf = (file: string): string => dirname(file)
