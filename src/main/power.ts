import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { basename, join } from 'node:path'
import {
  POWER_ACTIONS,
  POWER_META,
  canForce,
  canWake,
  effectiveWarn,
  localIso,
  nextOccurrence,
  normDays,
  parseDate,
  parseTime
} from '@shared/power'
import type { PowerCaps, PowerScheduleResult, PowerTimer, PowerTimerSpec } from '@shared/types'
import icon from '../../resources/icon.ico?asset&asarUnpack'
import { compilerPath, run } from './actions'
import { JsonFile } from './store/jsonFile'
import { isObject, num, oneOf, str } from './store/util'

// ---------------------------------------------------------------------------------------------
// The power timer: shut down, restart, sleep or hibernate at a chosen time, once or every week.
//
// It is registered as a Windows scheduled task for the current user, so it happens even when Pro
// Terminal is closed, and it can wake the PC to shut down on time. When Windows refuses the task
// (some managed PCs), Pro Terminal waits itself instead and says it must stay open.
//
// Either way, what runs at that moment is a small helper program compiled on this PC (like folder
// actions, with the C# compiler that ships with Windows): it shows a warning window with a countdown,
// Cancel and +10 min, then does it. It reports what happened through a status file, so the app can show
// the countdown and move a repeating timer on to its next day.
// ---------------------------------------------------------------------------------------------

const SCHTASKS = join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'schtasks.exe')
/** A one-off task removes itself this long after its time (well after the helper's 2-hour limit). */
const KEEP_ONE_OFF_MS = 3 * 3600_000
/** A moment that passed this long ago without the helper reporting was missed (the PC was off or asleep). */
const MISSED_MS = 2 * 60_000
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const HELPER_CS = String.raw`using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Media;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Pro Terminal power timer")]
[assembly: AssemblyDescription("Warns before a scheduled shutdown, restart, sleep or hibernate, then does it.")]
[assembly: AssemblyProduct("Pro Terminal")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Native
{
    // BOOLEAN (one byte) in and out: the default 4-byte bool would read garbage in the upper bytes.
    [DllImport("powrprof.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SetSuspendState([MarshalAs(UnmanagedType.I1)] bool hibernate, [MarshalAs(UnmanagedType.I1)] bool forceCritical, [MarshalAs(UnmanagedType.I1)] bool disableWakeEvent);

    [DllImport("powrprof.dll")]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool GetPwrCapabilities([Out] byte[] capabilities);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}

static class Program
{
    public static string Action = "shutdown";
    public static int Warn;
    public static bool Force, Repeat, DryRun;
    public static string StatusFile = "";
    public static Color Accent = Color.FromArgb(244, 63, 94);

    [STAThread]
    static int Main(string[] args)
    {
        string caps = null;
        foreach (string arg in args)
        {
            int eq = arg.IndexOf('=');
            string key = eq > 0 ? arg.Substring(0, eq) : arg;
            string value = eq > 0 ? arg.Substring(eq + 1) : "";
            if (key == "--action") Action = value;
            else if (key == "--warn") int.TryParse(value, out Warn);
            else if (key == "--force") Force = value == "1";
            else if (key == "--repeat") Repeat = value == "1";
            else if (key == "--dry-run") DryRun = true;
            else if (key == "--status") StatusFile = value;
            else if (key == "--accent") { try { Accent = ColorTranslator.FromHtml(value); } catch { } }
            else if (key == "--caps") caps = value;
        }
        if (caps != null) return WriteCaps(caps);
        if (Action != "shutdown" && Action != "restart" && Action != "sleep" && Action != "hibernate") return 2;
        Warn = Math.Max(0, Math.Min(Warn, 600));
        try { Native.SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (Warn > 0)
        {
            var form = new WarningForm();
            Application.Run(form);
            if (!form.Proceed)
            {
                Status("canceled", DateTime.UtcNow);
                return 1;
            }
        }
        Status("done", DateTime.UtcNow);
        return DryRun ? 0 : Perform();
    }

    /** Tells Pro Terminal what happened: "<state> <moment in ms> <process id>". */
    public static void Status(string state, DateTime whenUtc)
    {
        if (StatusFile.Length == 0) return;
        try
        {
            long ms = (long)(whenUtc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            File.WriteAllText(StatusFile, state + " " + ms + " " + Process.GetCurrentProcess().Id);
        }
        catch { }
    }

    public static string Doing()
    {
        if (Action == "restart") return "Restarting";
        if (Action == "sleep") return "Going to sleep";
        if (Action == "hibernate") return "Hibernating";
        return "Shutting down";
    }

    public static string NowLabel()
    {
        if (Action == "restart") return "Restart now";
        if (Action == "sleep") return "Sleep now";
        if (Action == "hibernate") return "Hibernate now";
        return "Shut down now";
    }

    public static string Advice()
    {
        if (Action == "sleep") return "Your apps stay open while the PC sleeps.";
        if (Action == "hibernate") return "Your open apps come back when the PC starts.";
        if (Force) return "Open apps will be closed without saving.";
        return "Save your work, or cancel to keep using the PC.";
    }

    // SYSTEM_POWER_CAPABILITIES: one byte each for S1 (3), S2 (4), S3 (5), S4 (6), HiberFilePresent (8), AoAc (20).
    static int WriteCaps(string file)
    {
        try
        {
            var c = new byte[512];
            string text = Native.GetPwrCapabilities(c)
                ? "s1=" + c[3] + "\ns2=" + c[4] + "\ns3=" + c[5] + "\ns4=" + c[6] + "\nhiber=" + c[8] + "\naoac=" + c[20]
                : "error";
            File.WriteAllText(file, text);
            return 0;
        }
        catch { return 3; }
    }

    static bool ModernStandby()
    {
        try
        {
            var c = new byte[512];
            return Native.GetPwrCapabilities(c) && c[20] != 0;
        }
        catch { return false; }
    }

    static int Perform()
    {
        try
        {
            if (Action == "shutdown") return Shutdown("/s /t 0" + (Force ? " /f" : ""));
            if (Action == "restart") return Shutdown("/r /t 0" + (Force ? " /f" : ""));
            if (Action == "hibernate") return Native.SetSuspendState(true, false, false) ? 0 : Shutdown("/h");
            // Modern Standby PCs have no classic sleep to ask for: turning the screen off starts standby.
            if (!ModernStandby() && Native.SetSuspendState(false, false, false)) return 0;
            using (var f = new Form()) Native.SendMessage(f.Handle, 0x0112, (IntPtr)0xF170, (IntPtr)2);
            return 0;
        }
        catch { return 3; }
    }

    static int Shutdown(string args)
    {
        var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "shutdown.exe"), args);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        using (var p = Process.Start(psi))
        {
            p.WaitForExit(15000);
            return p.HasExited ? p.ExitCode : 0;
        }
    }
}

/** A rounded button drawn in the window's own colors. */
class PillButton : Control
{
    public bool Primary;
    public Color Fill, HoverFill, DownFill, Ink, Edge, Ring, Back;
    bool over, down;

    public PillButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
        TabStop = true;
        Cursor = Cursors.Hand;
    }

    protected override void OnMouseEnter(EventArgs e) { over = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { over = false; down = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) { down = true; Focus(); Invalidate(); } base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
    protected override bool IsInputKey(Keys keyData) { return keyData == Keys.Enter || keyData == Keys.Space || base.IsInputKey(keyData); }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space)
        {
            e.Handled = true;
            OnClick(EventArgs.Empty);
        }
        base.OnKeyDown(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Back);
        var box = new RectangleF(1.5f, 1.5f, Width - 3f, Height - 3f);
        using (GraphicsPath path = Rounded(box, Height * 0.26f))
        {
            using (var b = new SolidBrush(down ? DownFill : over ? HoverFill : Fill)) g.FillPath(b, path);
            if (!Primary) using (var p = new Pen(Edge)) g.DrawPath(p, path);
        }
        if (Focused)
        {
            var ring = new RectangleF(0.75f, 0.75f, Width - 1.5f, Height - 1.5f);
            using (GraphicsPath path = Rounded(ring, Height * 0.3f))
            using (var p = new Pen(Ring, 1.5f)) g.DrawPath(p, path);
        }
        TextRenderer.DrawText(g, Text, Font, ClientRectangle, Ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
    }

    public static GraphicsPath Rounded(RectangleF r, float radius)
    {
        float d = radius * 2;
        var p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
}

/** The countdown before it happens: Cancel (or Skip), +10 min, or do it now. */
class WarningForm : Form
{
    public bool Proceed;
    readonly float scale;
    readonly Timer tick = new Timer();
    readonly int total;
    DateTime target;
    bool waiting;
    readonly bool light;
    readonly Color bg, fg, muted, track, line;
    readonly Font capFont, titleFont, textFont, numFont, unitFont;
    readonly PillButton cancel, later, now;

    public WarningForm()
    {
        total = Program.Warn;
        target = DateTime.UtcNow.AddSeconds(total);
        light = LightTheme();
        bg = light ? Color.FromArgb(250, 251, 254) : Color.FromArgb(17, 21, 30);
        fg = light ? Color.FromArgb(28, 33, 48) : Color.FromArgb(231, 234, 243);
        muted = light ? Color.FromArgb(98, 106, 124) : Color.FromArgb(148, 156, 176);
        track = light ? Color.FromArgb(226, 230, 239) : Color.FromArgb(39, 45, 59);
        line = light ? Color.FromArgb(214, 219, 230) : Color.FromArgb(50, 57, 73);
        // The screen's DPI: the form's own graphics would create its window before it is told to center.
        using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) scale = g.DpiX / 96f;

        Text = Program.Doing() + " - Pro Terminal";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ShowInTaskbar = true;
        TopMost = true;
        KeyPreview = true;
        DoubleBuffered = true;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = bg;
        ClientSize = new Size(S(560), S(224));
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        capFont = new Font("Segoe UI Semibold", 7.5f);
        titleFont = new Font("Segoe UI Semibold", 17f);
        textFont = new Font("Segoe UI", 9.75f);
        numFont = new Font("Segoe UI Semibold", 25f);
        unitFont = new Font("Segoe UI", 8.25f);

        cancel = AddButton(Program.Repeat ? "Skip this time" : "Cancel", false);
        later = AddButton("+10 min", false);
        now = AddButton(Program.NowLabel(), true);
        int y = S(168), h = S(34), gap = S(8), right = ClientSize.Width - S(22);
        now.SetBounds(right - S(134), y, S(134), h);
        later.SetBounds(now.Left - gap - S(86), y, S(86), h);
        cancel.SetBounds(later.Left - gap - S(120), y, S(120), h);
        cancel.Click += (s, e) => Close();
        later.Click += (s, e) => Postpone();
        now.Click += (s, e) => { Proceed = true; Close(); };

        tick.Interval = 40;
        tick.Tick += (s, e) => OnTick();
    }

    int S(float v) { return (int)Math.Round(v * scale); }

    PillButton AddButton(string text, bool primary)
    {
        Color accent = Program.Accent;
        // Light accents (amber, cyan) need dark text to stay readable.
        bool pale = (accent.R * 0.299 + accent.G * 0.587 + accent.B * 0.114) > 160;
        var b = new PillButton();
        b.Primary = primary;
        b.Text = text;
        b.Back = bg;
        b.Font = new Font("Segoe UI Semibold", 9.5f);
        b.Ring = Color.FromArgb(200, accent);
        if (primary)
        {
            b.Fill = accent;
            b.HoverFill = Blend(accent, pale ? Color.White : Color.Black, 0.12f);
            b.DownFill = Blend(accent, Color.Black, 0.22f);
            b.Ink = pale ? Color.FromArgb(17, 21, 30) : Color.White;
        }
        else
        {
            b.Fill = light ? Color.White : Color.FromArgb(28, 33, 45);
            b.HoverFill = light ? Color.FromArgb(240, 242, 247) : Color.FromArgb(38, 44, 58);
            b.DownFill = light ? Color.FromArgb(228, 231, 239) : Color.FromArgb(46, 53, 69);
            b.Ink = fg;
            b.Edge = line;
        }
        Controls.Add(b);
        return b;
    }

    static Color Blend(Color a, Color b, float t)
    {
        return Color.FromArgb((int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
    }

    static bool LightTheme()
    {
        try
        {
            object v = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 0);
            return v is int && (int)v == 1;
        }
        catch { return false; }
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ClassStyle |= 0x20000; // CS_DROPSHADOW
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Rounded corners on Windows 11 (ignored by Windows 10).
        try { int round = 2; Native.DwmSetWindowAttribute(Handle, 33, ref round, 4); } catch { }
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Program.Status("warning", target);
        tick.Start();
        Alert();
    }

    void Alert()
    {
        Activate();
        cancel.Focus();
        try { SystemSounds.Exclamation.Play(); } catch { }
    }

    void OnTick()
    {
        double left = (target - DateTime.UtcNow).TotalSeconds;
        if (waiting)
        {
            if (left > total) return;
            waiting = false;
            Show();
            Alert();
        }
        if (left <= 0)
        {
            tick.Stop();
            Proceed = true;
            Close();
            return;
        }
        Invalidate();
    }

    void Postpone()
    {
        target = DateTime.UtcNow.AddMinutes(10);
        Program.Status("postponed", target);
        waiting = true;
        Hide();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Escape) Close();
        base.OnKeyDown(e);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        // Drag the window by its body.
        Native.ReleaseCapture();
        Native.SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        tick.Stop();
        base.OnFormClosed(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        Color accent = Program.Accent;
        double left = Math.Max(0, (target - DateTime.UtcNow).TotalSeconds);
        float stroke = S(9);
        var ring = new RectangleF(S(30) + stroke / 2, S(51) + stroke / 2, S(122) - stroke, S(122) - stroke);
        PointF c = new PointF(ring.X + ring.Width / 2, ring.Y + ring.Height / 2);

        // A soft glow of the action's color behind the ring.
        using (var glow = new GraphicsPath())
        {
            float rad = S(100);
            glow.AddEllipse(c.X - rad, c.Y - rad, rad * 2, rad * 2);
            using (var b = new PathGradientBrush(glow))
            {
                b.CenterColor = Color.FromArgb(light ? 38 : 52, accent);
                b.SurroundColors = new Color[] { Color.FromArgb(0, accent) };
                g.FillPath(b, glow);
            }
        }

        using (var p = new Pen(track, stroke)) g.DrawEllipse(p, ring);
        float frac = total > 0 ? (float)Math.Min(1, left / total) : 0;
        if (frac > 0.002f)
        {
            // The last ten seconds pulse.
            int alpha = left <= 10 ? (int)(175 + 80 * Math.Sin(DateTime.UtcNow.TimeOfDay.TotalSeconds * Math.PI * 2)) : 255;
            using (var p = new Pen(Color.FromArgb(alpha, accent), stroke))
            {
                p.StartCap = LineCap.Round;
                p.EndCap = LineCap.Round;
                g.DrawArc(p, ring, -90, 360 * frac);
            }
        }

        int secs = (int)Math.Ceiling(left);
        string num = secs >= 60 ? (secs / 60) + ":" + (secs % 60).ToString("00") : secs.ToString();
        string unit = secs >= 60 ? "min" : secs == 1 ? "second" : "seconds";
        var numBox = Rectangle.Round(new RectangleF(ring.X, ring.Y, ring.Width, ring.Height * 0.62f));
        TextRenderer.DrawText(g, num, numFont, numBox, fg, TextFormatFlags.HorizontalCenter | TextFormatFlags.Bottom | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
        var unitBox = Rectangle.Round(new RectangleF(ring.X, ring.Y + ring.Height * 0.63f, ring.Width, ring.Height * 0.2f));
        TextRenderer.DrawText(g, unit, unitFont, unitBox, muted, TextFormatFlags.HorizontalCenter | TextFormatFlags.Top | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);

        int x = S(184), w = ClientSize.Width - x - S(24);
        string caption = "PRO TERMINAL  \u00B7  POWER TIMER" + (Program.DryRun ? "  \u00B7  PREVIEW" : "");
        TextRenderer.DrawText(g, caption, capFont, new Point(x, S(32)), muted, TextFormatFlags.NoPadding);
        TextRenderer.DrawText(g, Program.Doing(), titleFont, new Point(x - S(2), S(48)), fg, TextFormatFlags.NoPadding);
        string when = "Scheduled for " + target.ToLocalTime().ToShortTimeString() + (Program.Repeat ? " \u00B7 repeating timer" : "");
        TextRenderer.DrawText(g, when, textFont, new Rectangle(x, S(90), w, S(22)), fg, TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
        TextRenderer.DrawText(g, Program.Advice(), textFont, new Rectangle(x, S(112), w, S(40)), muted, TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);

        using (var p = new Pen(line)) g.DrawRectangle(p, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
    }
}
`

const HELPER_HASH = createHash('sha1').update(HELPER_CS).digest('hex').slice(0, 10)
const HELPER_PREFIX = 'power-timer-'

const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
/** One argument for a Windows command line (the values here never contain quotes). */
const quoteArg = (a: string): string => (/\s/.test(a) ? `"${a}"` : a)
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err)).trim()

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function normSpec(v: unknown): PowerTimerSpec | null {
  if (!isObject(v)) return null
  if (!(POWER_ACTIONS as unknown[]).includes(v.action)) return null
  const action = v.action as PowerTimerSpec['action']
  const time = str(v.time, '', 5)
  if (!parseTime(time)) return null
  const days = normDays(v.days)
  const date = days.length ? '' : str(v.date, '', 10)
  if (!days.length && !parseDate(date)) return null
  return {
    action,
    time,
    date,
    days,
    warn: Math.round(num(v.warn, 60, 0, 300)),
    force: canForce(action) && v.force === true,
    wake: canWake(action) && v.wake === true
  }
}

function normTimer(v: unknown): PowerTimer | null {
  const spec = normSpec(v)
  if (!spec || !isObject(v)) return null
  const id = str(v.id, '', 64)
  const next = num(v.next, 0)
  if (!ID_RE.test(id) || !next) return null
  return {
    ...spec,
    id,
    next,
    engine: oneOf(v.engine, ['task', 'app'] as const, 'task'),
    engineNote: str(v.engineNote, '', 400) || undefined,
    createdAt: num(v.createdAt, Date.now()),
    warningUntil: typeof v.warningUntil === 'number' ? v.warningUntil : undefined
  }
}

interface PowerFile {
  timer: PowerTimer | null
  /** The helper program the scheduled task starts (it may be from an older version of the app). */
  helper: string
}

const normalize = (raw: unknown): PowerFile => {
  const timer = isObject(raw) ? normTimer(raw.timer) : null
  return { timer, helper: timer && isObject(raw) ? str(raw.helper, '', 1024) : '' }
}

/** What the helper last reported for a timer. */
interface HelperStatus {
  state: 'warning' | 'postponed' | 'done' | 'canceled'
  at: number
  pid: number
}

export class PowerTimers {
  private readonly file: JsonFile<PowerFile>
  private readonly dir: string
  private readonly taskName: string
  private readonly listeners = new Set<(t: PowerTimer | null) => void>()
  private ticker: NodeJS.Timeout | null = null
  private helperBuild: Promise<string> | null = null
  private capsCheck: Promise<PowerCaps | null> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  /** The moment the in-app engine already started the helper for. */
  private launchedFor = 0

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'power')
    const statePath = join(dataDir, 'power.json')
    const lost = !existsSync(statePath)
    this.file = new JsonFile<PowerFile>(statePath, { timer: null, helper: '' }, normalize)
    let user = ''
    try {
      user = userInfo().username
    } catch {
      user = process.env.USERNAME ?? ''
    }
    // A second, isolated profile (PRO_TERMINAL_USER_DATA) gets its own task.
    const profile = process.env.PRO_TERMINAL_USER_DATA ? ` ${createHash('sha1').update(dataDir.toLowerCase()).digest('hex').slice(0, 6)}` : ''
    const who = `${user.replace(/[\\/:*?"<>|]+/g, '')}${profile}`.trim()
    this.taskName = `Pro Terminal power timer${who ? ` (${who})` : ''}`
    if (lost) {
      // A data folder without this file may have lost it: a task left behind would still fire, unseen.
      void this.deleteTask()
      this.file.save()
      this.file.flush()
    }
  }

  get timer(): PowerTimer | null {
    return this.file.data.timer
  }

  onChange(l: (t: PowerTimer | null) => void): void {
    this.listeners.add(l)
  }

  /** Checks the saved timer against Windows and catches up on what happened while the app was closed. */
  async start(): Promise<void> {
    const t = this.timer
    if (!t) {
      this.cleanFiles()
      return
    }
    if (t.engine === 'task' && !this.readStatus(t)) {
      if (!(await this.taskExists())) {
        // Deleted in Task Scheduler, or a one-off task that already ran and removed itself.
        this.setTimer(null)
        return
      }
      await this.moveToCurrentHelper(t)
    }
    this.tick()
    this.syncTicker()
    this.cleanFiles()
  }

  /** A task made by an older version starts that version's helper: point it at this one's. */
  private moveToCurrentHelper(t: PowerTimer): Promise<void> {
    return this.serial(async () => {
      const exe = this.helperExe()
      // A one-off task about to start is left as it is.
      const soon = !t.days.length && t.next - t.warn * 1000 < Date.now() + 60_000
      if (this.file.data.helper === exe || this.timer?.id !== t.id || soon) return
      try {
        await this.registerTask(t, await this.helper())
        this.file.data.helper = exe
        this.file.save()
        this.file.flush()
      } catch (err) {
        // The old helper stays in use, and is kept.
        console.warn('[power] could not update the scheduled task', err)
      }
    })
  }

  dispose(): void {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
    this.file.flush()
  }

  // ---------------------------------------------------------------- requests from the app

  schedule(raw: unknown): Promise<PowerScheduleResult> {
    return this.serial(async (): Promise<PowerScheduleResult> => {
      const spec = normSpec(raw)
      if (!spec) return { ok: false, error: 'These timer settings are not valid.' }
      const now = Date.now()
      const next = nextOccurrence(spec, now)
      if (!next) return { ok: false, error: spec.days.length ? 'Pick at least one day.' : 'Pick a time at least a minute from now.' }
      let helper: string
      try {
        helper = await this.helper()
      } catch (err) {
        return { ok: false, error: `The power timer couldn't be prepared on this PC: ${message(err)}` }
      }
      // The current timer goes first: its task, and its warning window if one is open.
      await this.stopCurrent()
      const timer: PowerTimer = { ...spec, warn: effectiveWarn(spec, next, now), id: randomUUID(), next, engine: 'task', createdAt: now }
      try {
        await this.registerTask(timer, helper)
      } catch (err) {
        timer.engine = 'app'
        timer.engineNote = message(err).replace(/^ERROR:\s*/i, '')
      }
      this.launchedFor = 0
      this.file.data.helper = timer.engine === 'task' ? helper : ''
      this.setTimer(timer)
      this.cleanFiles()
      return { ok: true, timer }
    })
  }

  cancel(): Promise<void> {
    return this.serial(async () => {
      await this.stopCurrent()
      this.setTimer(null)
      this.cleanFiles()
    })
  }

  /** Shows the warning window with the timer's look, counting down briefly, without doing anything. */
  async preview(raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
    const spec = normSpec(raw)
    if (!spec) return { ok: false, error: 'These timer settings are not valid.' }
    try {
      const helper = await this.helper()
      const warn = Math.min(Math.max(spec.warn, 15), 20)
      this.launch(helper, [...this.helperArgs({ ...spec, warn }, ''), '--dry-run'])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  }

  caps(): Promise<PowerCaps | null> {
    this.capsCheck ??= this.readCaps().catch((err) => {
      console.warn('[power] could not read the power capabilities', err)
      this.capsCheck = null
      return null
    })
    return this.capsCheck
  }

  // ---------------------------------------------------------------- state

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn)
    this.queue = p.catch(() => undefined)
    return p
  }

  private setTimer(t: PowerTimer | null): void {
    this.file.data = { timer: t, helper: t ? this.file.data.helper : '' }
    this.file.save()
    this.file.flush()
    this.syncTicker()
    for (const l of this.listeners) l(t)
  }

  private syncTicker(): void {
    if (this.timer && !this.ticker) {
      this.ticker = setInterval(() => {
        try {
          this.tick()
        } catch (err) {
          console.warn('[power] timer check failed', err)
        }
      }, 1000)
    }
    else if (!this.timer && this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
  }

  /** Follows the helper's reports, starts the in-app engine on time, and moves on after each occurrence. */
  private tick(): void {
    const t = this.timer
    if (!t) return
    const now = Date.now()
    const st = this.readStatus(t)
    if (st && (st.state === 'done' || st.state === 'canceled')) {
      this.finishOccurrence(t, false)
      return
    }
    if (st && t.warningUntil !== st.at) {
      this.setTimer({ ...t, warningUntil: st.at })
      return
    }
    const until = st ? st.at : t.next
    if (now > until + MISSED_MS) {
      this.finishOccurrence(t, !st)
      return
    }
    if (t.engine === 'app' && !st && this.launchedFor !== t.next && now >= t.next - t.warn * 1000) {
      this.launchedFor = t.next
      void this.helper()
        .then((exe) => this.launch(exe, this.helperArgs(t, this.statusPath(t))))
        .catch((err) => console.warn('[power] could not start the timer', err))
    }
  }

  /** One occurrence is over: a repeating timer moves to its next day, a one-off timer is done. */
  private finishOccurrence(t: PowerTimer, missed: boolean): void {
    rmSync(this.statusPath(t), { force: true })
    if (t.days.length) {
      const next = nextOccurrence(t, Date.now())
      this.setTimer(next ? { ...t, next, warningUntil: undefined } : null)
      return
    }
    // A missed one-off task is removed now; one that ran removes itself (deleting it could stop it mid-way).
    if (missed && t.engine === 'task') void this.deleteTask()
    this.setTimer(null)
  }

  /** Stops the current timer: its warning window and its scheduled task. */
  private async stopCurrent(): Promise<void> {
    const t = this.timer
    if (!t) return
    const st = this.readStatus(t)
    // Only a helper still counting down: an old report's process id may belong to another program by now.
    if (st && (st.state === 'warning' || st.state === 'postponed') && st.pid > 0 && st.at > Date.now() - MISSED_MS) {
      try {
        process.kill(st.pid)
      } catch {
        /* already gone */
      }
    }
    rmSync(this.statusPath(t), { force: true })
    if (t.engine === 'task') {
      await this.schtasks(['/End', '/TN', this.taskName]).catch(() => undefined)
      await this.deleteTask()
    }
  }

  private statusPath(t: Pick<PowerTimer, 'id'>): string {
    return join(this.dir, `${t.id}.status`)
  }

  private readStatus(t: PowerTimer): HelperStatus | null {
    const file = this.statusPath(t)
    if (!existsSync(file)) return null
    try {
      const [state, at, pid] = readFileSync(file, 'utf8').trim().split(/\s+/)
      const s = oneOf(state, ['warning', 'postponed', 'done', 'canceled'] as const, 'done')
      return { state: s, at: Number(at) || Date.now(), pid: Number(pid) || 0 }
    } catch {
      return null
    }
  }

  /** Removes status files of other timers and helper programs from other versions. */
  private cleanFiles(): void {
    if (!existsSync(this.dir)) return
    const keep = new Set([this.timer ? `${this.timer.id}.status` : '', basename(this.helperExe()), basename(this.file.data.helper)])
    for (const f of readdirSync(this.dir)) {
      if (keep.has(f)) continue
      const old = f.endsWith('.status') || f.startsWith(HELPER_PREFIX)
      if (!old) continue
      try {
        rmSync(join(this.dir, f), { force: true })
      } catch {
        /* in use */
      }
    }
  }

  // ---------------------------------------------------------------- Windows scheduled task

  private schtasks(args: string[]): Promise<string> {
    return run(SCHTASKS, args, process.env.SystemRoot || 'C:\\Windows')
  }

  private taskExists(): Promise<boolean> {
    return this.schtasks(['/Query', '/TN', this.taskName]).then(
      () => true,
      () => false
    )
  }

  private deleteTask(): Promise<void> {
    return this.schtasks(['/Delete', '/TN', this.taskName, '/F']).then(
      () => undefined,
      () => undefined
    )
  }

  private async registerTask(t: PowerTimer, helper: string): Promise<void> {
    mkdirSync(this.dir, { recursive: true })
    const xmlFile = join(this.dir, `task-${randomBytes(4).toString('hex')}.xml`)
    // Task Scheduler reads task files as UTF-16.
    writeFileSync(xmlFile, '\ufeff' + this.taskXml(t, helper), 'utf16le')
    try {
      await this.schtasks(['/Create', '/TN', this.taskName, '/XML', xmlFile, '/F'])
    } finally {
      rmSync(xmlFile, { force: true })
    }
  }

  private taskXml(t: PowerTimer, helper: string): string {
    // The task starts when the warning should start, so the action itself happens on the minute.
    const start = t.next - t.warn * 1000
    let trigger: string
    if (t.days.length) {
      // A warning that starts before midnight starts on the day before.
      const tm = parseTime(t.time)!
      const shift = tm.h * 3600 + tm.m * 60 < t.warn ? 6 : 0
      const days = [...new Set(t.days.map((d) => (d + shift) % 7))].sort((a, b) => a - b)
      trigger =
        `<CalendarTrigger><StartBoundary>${localIso(start)}</StartBoundary><Enabled>true</Enabled>` +
        `<ScheduleByWeek><DaysOfWeek>${days.map((d) => `<${DAY_NAMES[d]} />`).join('')}</DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek></CalendarTrigger>`
    } else {
      trigger = `<TimeTrigger><StartBoundary>${localIso(start)}</StartBoundary><EndBoundary>${localIso(t.next + KEEP_ONE_OFF_MS)}</EndBoundary><Enabled>true</Enabled></TimeTrigger>`
    }
    const args = this.helperArgs(t, this.statusPath(t)).map(quoteArg).join(' ')
    const what = `${POWER_META[t.action].label} at ${t.time}${t.days.length ? ` on ${t.days.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ')}` : ` on ${t.date}`}`
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>Pro Terminal</Author>
    <Description>${xmlEscape(`${what}. Made by the power timer in Pro Terminal; change or cancel it there.`)}</Description>
  </RegistrationInfo>
  <Triggers>${trigger}</Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>${t.wake && canWake(t.action) ? 'true' : 'false'}</WakeToRun>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>${t.days.length ? '' : '\n    <DeleteExpiredTaskAfter>PT0S</DeleteExpiredTaskAfter>'}
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(helper)}</Command>
      <Arguments>${xmlEscape(args)}</Arguments>
    </Exec>
  </Actions>
</Task>
`
  }

  // ---------------------------------------------------------------- the helper program

  private helperArgs(t: PowerTimerSpec, status: string): string[] {
    return [
      `--action=${t.action}`,
      `--warn=${t.warn}`,
      `--force=${t.force ? 1 : 0}`,
      `--repeat=${t.days.length ? 1 : 0}`,
      `--accent=${POWER_META[t.action].color}`,
      ...(status ? [`--status=${status}`] : [])
    ]
  }

  private launch(exe: string, args: string[]): void {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', cwd: this.dir })
    child.on('error', (err) => console.warn('[power] could not start the helper', err))
    child.unref()
  }

  private helperExe(): string {
    return join(this.dir, `${HELPER_PREFIX}${HELPER_HASH}.exe`)
  }

  /** The compiled helper; built once per version of its source. */
  private helper(): Promise<string> {
    const exe = this.helperExe()
    if (existsSync(exe)) return Promise.resolve(exe)
    this.helperBuild ??= this.buildHelper(exe).finally(() => {
      this.helperBuild = null
    })
    return this.helperBuild
  }

  private async buildHelper(exe: string): Promise<string> {
    const csc = compilerPath()
    if (!csc) throw new Error('the C# compiler that comes with Windows (.NET Framework 4) was not found.')
    const work = join(tmpdir(), `pt-power-${randomBytes(5).toString('hex')}`)
    mkdirSync(work, { recursive: true })
    try {
      writeFileSync(join(work, 'power.cs'), '\ufeff' + HELPER_CS, 'utf8')
      copyFileSync(icon, join(work, 'icon.ico'))
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
          '/reference:System.Windows.Forms.dll',
          '/reference:System.Drawing.dll',
          '/out:power.exe',
          'power.cs'
        ],
        work
      )
      mkdirSync(this.dir, { recursive: true })
      copyFileSync(join(work, 'power.exe'), exe)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
    return exe
  }

  private async readCaps(): Promise<PowerCaps | null> {
    const exe = await this.helper()
    const out = join(this.dir, `caps-${randomBytes(4).toString('hex')}.txt`)
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(exe, [`--caps=${out}`], { timeout: 15_000, windowsHide: true }, (err) => (err ? reject(err) : resolve()))
      })
      const text = readFileSync(out, 'utf8').trim()
      if (text === 'error') return null
      const v = Object.fromEntries(text.split(/\r?\n/).map((l) => l.split('=')))
      const on = (k: string): boolean => v[k] === '1'
      return { sleep: on('aoac') ? 'modern' : on('s1') || on('s2') || on('s3') ? 'standby' : 'none', hibernate: on('s4') && on('hiber') }
    } finally {
      rmSync(out, { force: true })
    }
  }
}
