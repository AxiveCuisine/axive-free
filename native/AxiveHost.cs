// Axive host: the small native companion Axive talks to over stdin/stdout,
// one JSON object per line. It does what a terminal program cannot do by
// itself on Windows:
//
//   - window buttons for the terminal window Axive runs in (minimize,
//     maximize/restore, drag to move, bring to front)
//   - the native "choose a folder" and "choose a file" dialogs
//   - the clipboard: read, write, and an opt-in watch that only ever
//     reports a link whose host is on an allowlist. Everything else on the
//     clipboard is dropped on the spot, never stored, logged or sent, and
//     content marked by password managers is never even read.
//   - a global hotkey (ctrl+alt+g) to pause/wake the watch
//   - Windows notifications and a chime
//   - the ghost card: a small notice in the corner of the screen that
//     never takes focus, so whatever the user is doing carries on
//
// Built with the C# compiler that ships with Windows (.NET Framework 4.x):
// see scripts/build-host.ps1. No network access, no files written.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Axive")]
[assembly: AssemblyProduct("Axive")]
[assembly: AssemblyDescription("Axive host")]
[assembly: AssemblyCompany("axive.xyz")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace Axive
{
    /// <summary>Explorer through the shell itself. Explorer's own command line misreads some paths (a drive's root,
    /// a quote after a backslash) and then opens Documents; these calls take the path as it is.</summary>
    static class Shell
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHParseDisplayName(string name, IntPtr bindCtx, out IntPtr pidl, uint sfgaoIn, out uint sfgaoOut);
        [DllImport("shell32.dll")] static extern int SHOpenFolderAndSelectItems(IntPtr pidlFolder, uint cidl, IntPtr[] apidl, uint flags);
        [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr pv);

        public static bool Reveal(string path)
        {
            if (string.IsNullOrEmpty(path)) return false;
            path = System.IO.Path.GetFullPath(path);
            if (System.IO.Directory.Exists(path))
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = path, UseShellExecute = true, Verb = "open" });
                return true;
            }
            if (!System.IO.File.Exists(path)) return false;
            IntPtr item;
            uint ignored;
            if (SHParseDisplayName(path, IntPtr.Zero, out item, 0, out ignored) != 0) return false;
            try
            {
                // the file's own full id and no children: Explorer opens its folder with it selected
                return SHOpenFolderAndSelectItems(item, 0, null, 0) == 0;
            }
            finally { CoTaskMemFree(item); }
        }

        public static bool Open(string path)
        {
            if (string.IsNullOrEmpty(path)) return false;
            path = System.IO.Path.GetFullPath(path);
            if (!System.IO.File.Exists(path) && !System.IO.Directory.Exists(path)) return false;
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = path, UseShellExecute = true, WorkingDirectory = System.IO.Path.GetDirectoryName(path) ?? "" });
            return true;
        }
    }

    static class Native
    {
        public const int SW_SHOW = 5, SW_MINIMIZE = 6, SW_MAXIMIZE = 3, SW_RESTORE = 9;
        public const int WM_CLOSE = 0x10, WM_SYSCOMMAND = 0x112, WM_CLIPBOARDUPDATE = 0x31D, WM_HOTKEY = 0x312;
        public const int SC_DRAGMOVE = 0xF012;
        public const uint GA_ROOTOWNER = 3, GW_OWNER = 4;
        public const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_NOREPEAT = 0x4000;
        public const uint SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10;

        [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
        [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
        [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] public static extern bool ReleaseCapture();
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
        public delegate bool EnumProc(IntPtr h, IntPtr p);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
        [DllImport("user32.dll")] public static extern bool EnumThreadWindows(uint thread, EnumProc cb, IntPtr p);
        [DllImport("user32.dll")] public static extern bool AddClipboardFormatListener(IntPtr h);
        [DllImport("user32.dll")] public static extern bool RemoveClipboardFormatListener(IntPtr h);
        [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
        [DllImport("user32.dll")] public static extern bool IsClipboardFormatAvailable(uint format);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterClipboardFormat(string name);
        [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint key);
        [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        public static string ClassOf(IntPtr h)
        {
            var sb = new StringBuilder(256);
            GetClassName(h, sb, sb.Capacity);
            return sb.ToString();
        }

        public static string TitleOf(IntPtr h)
        {
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            return sb.ToString();
        }
    }

    // --- the Vista+ file dialog, through COM -------------------------------

    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    class FileOpenDialogCom { }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct FilterSpec
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string Name;
        [MarshalAs(UnmanagedType.LPWStr)] public string Spec;
    }

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint count, [MarshalAs(UnmanagedType.LPArray)] FilterSpec[] filters);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem item);
        void SetFolder(IShellItem item);
        void GetFolder(out IShellItem item);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
        void AddPlace(IShellItem item, int where);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string ext);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem
    {
        void BindToHandler(IntPtr bc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem other, uint hint, out int order);
    }

    static class Dialogs
    {
        const uint FOS_NOCHANGEDIR = 0x8, FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800, FOS_FILEMUSTEXIST = 0x1000;
        const uint SIGDN_FILESYSPATH = 0x80058000;
        static readonly Guid ShellItemGuid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        static extern void SHCreateItemFromParsingName(string path, IntPtr bc, ref Guid riid, out IShellItem item);

        public static string Pick(bool folders, string title, string initial, string filterName, string filterSpec, IntPtr owner)
        {
            var dialog = (IFileDialog)new FileOpenDialogCom();
            try
            {
                uint options;
                dialog.GetOptions(out options);
                options |= FOS_NOCHANGEDIR | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
                options |= folders ? FOS_PICKFOLDERS : FOS_FILEMUSTEXIST;
                dialog.SetOptions(options);
                if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
                if (!folders && !string.IsNullOrEmpty(filterSpec))
                {
                    dialog.SetFileTypes(2, new[] {
                        new FilterSpec { Name = filterName ?? filterSpec, Spec = filterSpec },
                        new FilterSpec { Name = "All files", Spec = "*.*" },
                    });
                }
                if (!string.IsNullOrEmpty(initial) && System.IO.Directory.Exists(initial))
                {
                    try
                    {
                        IShellItem folder;
                        Guid guid = ShellItemGuid;
                        SHCreateItemFromParsingName(initial, IntPtr.Zero, ref guid, out folder);
                        dialog.SetFolder(folder);
                    }
                    catch { }
                }
                Host.RaiseSoon();
                int hr = dialog.Show(owner);
                if (hr != 0) return null; // cancelled (0x800704C7) or failed
                IShellItem result;
                dialog.GetResult(out result);
                string path;
                result.GetDisplayName(SIGDN_FILESYSPATH, out path);
                return path;
            }
            finally
            {
                Marshal.FinalReleaseComObject(dialog);
            }
        }
    }

    // --- the ghost card ------------------------------------------------------
    //
    // A link surfaced while the user is somewhere else. A Windows balloon is
    // easy to miss (and Focus Assist swallows it), and a line in the terminal
    // is no use when the terminal is behind the browser. So: a small card in
    // the corner of the screen the mouse is on. It never activates (typing and
    // ctrl+v carry on in whatever window has focus), waits while the mouse is
    // over it, and sinks away on its own.

    sealed class CardForm : Form
    {
        const int WS_EX_TOPMOST = 0x8, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;
        const int WM_MOUSEACTIVATE = 0x21, MA_NOACTIVATE = 3;
        static readonly Color Water = Color.FromArgb(6, 6, 9), Bone = Color.FromArgb(216, 208, 191), Ash = Color.FromArgb(111, 106, 114);
        static readonly Color Whisper = Color.FromArgb(61, 56, 66), Blood = Color.FromArgb(125, 15, 23), Lit = Color.FromArgb(200, 50, 60), Face = Color.FromArgb(239, 231, 214);

        public string Key;
        public event Action<string, string> Acted;
        string heading, line;
        string[] ids = new string[0], labels = new string[0];
        Rectangle[] hits = new Rectangle[0];
        int hover = -1, ttl, left;
        bool sinking, inside;
        readonly float scale;
        readonly Font headFont, lineFont, buttonFont;
        readonly System.Windows.Forms.Timer clock = new System.Windows.Forms.Timer();

        public CardForm(float scale)
        {
            this.scale = scale;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = Water;
            DoubleBuffered = true;
            Text = "Axive ghost";
            Opacity = 0;
            headFont = new Font("Segoe UI Semibold", 14f * scale, FontStyle.Regular, GraphicsUnit.Pixel);
            lineFont = new Font("Segoe UI", 12.5f * scale, FontStyle.Regular, GraphicsUnit.Pixel);
            buttonFont = new Font("Segoe UI Semibold", 12.5f * scale, FontStyle.Regular, GraphicsUnit.Pixel);
            clock.Interval = 16;
            clock.Tick += delegate { Tick(); };
        }

        int S(float v) { return (int)Math.Round(v * scale); }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE; return cp; }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_MOUSEACTIVATE) { m.Result = (IntPtr)MA_NOACTIVATE; return; }
            base.WndProc(ref m);
        }

        public void Present(string key, string title, string text, string[] actionIds, string[] actionLabels, int lifeMs)
        {
            Key = key; heading = title; line = text; ids = actionIds; labels = actionLabels;
            ttl = left = Math.Max(3000, Math.Min(60000, lifeMs));
            sinking = false;
            Place();
            if (!Visible) { Opacity = 0; Native.ShowWindow(Handle, 4 /* SW_SHOWNOACTIVATE */); }
            Invalidate();
            clock.Start();
        }

        void Place()
        {
            int pad = S(16), width = S(380);
            var buttons = new List<Rectangle>();
            int x = pad + S(6), y = pad + S(20) + S(6) + S(18) + S(14);
            using (var g = CreateGraphics())
            {
                for (int i = 0; i < labels.Length; i++)
                {
                    int w = TextRenderer.MeasureText(g, labels[i], buttonFont).Width + S(26);
                    buttons.Add(new Rectangle(x, y, w, S(30)));
                    x += w + S(8);
                }
            }
            hits = buttons.ToArray();
            int height = y + S(30) + pad + S(3);
            Rectangle area = Screen.FromPoint(Cursor.Position).WorkingArea;
            Bounds = new Rectangle(area.Right - width - S(18), area.Bottom - height - S(18), width, height);
        }

        void Tick()
        {
            if (sinking)
            {
                Opacity = Math.Max(0, Opacity - 0.08);
                if (Opacity <= 0) { clock.Stop(); Hide(); }
                return;
            }
            if (Opacity < 0.97) Opacity = Math.Min(0.97, Opacity + 0.09);
            if (inside) return; // the user is reading it: hold
            left -= clock.Interval;
            if (left % 160 < clock.Interval) Invalidate(new Rectangle(0, Height - S(3), Width, S(3)));
            if (left <= 0) { Sink(); if (Acted != null) Acted(Key, "expired"); }
        }

        public void Sink() { sinking = true; inside = false; hover = -1; clock.Start(); }

        public void Press(string action)
        {
            if (sinking) return;
            Sink();
            if (Acted != null) Acted(Key, action);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Water);
            using (var edge = new Pen(Whisper)) g.DrawRectangle(edge, 0, 0, Width - 1, Height - 1);
            using (var blood = new SolidBrush(Blood)) g.FillRectangle(blood, 0, 0, S(3), Height);
            int pad = S(16), x = pad + S(6);
            TextRenderer.DrawText(g, heading ?? "", headFont, new Rectangle(x, pad, Width - x - pad, S(22)), Bone, TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.Left);
            TextRenderer.DrawText(g, line ?? "", lineFont, new Rectangle(x, pad + S(26), Width - x - pad, S(20)), Ash, TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.Left);
            for (int i = 0; i < hits.Length; i++)
            {
                Rectangle r = hits[i];
                bool first = i == 0, lit = i == hover;
                if (first) using (var fill = new SolidBrush(lit ? Lit : Blood)) g.FillRectangle(fill, r);
                else using (var outline = new Pen(lit ? Lit : Whisper)) g.DrawRectangle(outline, r.X, r.Y, r.Width - 1, r.Height - 1);
                TextRenderer.DrawText(g, labels[i], buttonFont, r, first ? Face : (lit ? Bone : Ash), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
            }
            // how long it stays: a thin line that runs out
            int run = ttl > 0 ? (int)((long)Width * Math.Max(0, left) / ttl) : 0;
            using (var faint = new SolidBrush(Whisper)) g.FillRectangle(faint, 0, Height - S(3), Width, S(3));
            using (var blood = new SolidBrush(Blood)) g.FillRectangle(blood, 0, Height - S(3), run, S(3));
        }

        int HitAt(Point p) { for (int i = 0; i < hits.Length; i++) if (hits[i].Contains(p)) return i; return -1; }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            int at = HitAt(e.Location);
            if (at != hover) { hover = at; Cursor = at >= 0 ? Cursors.Hand : Cursors.Default; Invalidate(); }
        }

        protected override void OnMouseEnter(EventArgs e) { inside = true; base.OnMouseEnter(e); }

        protected override void OnMouseLeave(EventArgs e)
        {
            inside = false; hover = -1; left = Math.Max(left, 2500); Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            int at = HitAt(e.Location);
            if (at >= 0) Press(ids[at]);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { clock.Dispose(); headFont.Dispose(); lineFont.Dispose(); buttonFont.Dispose(); }
            base.Dispose(disposing);
        }
    }

    // --- the host ----------------------------------------------------------

    class HostForm : Form
    {
        protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == Native.WM_CLIPBOARDUPDATE) Host.OnClipboardChanged();
            else if (m.Msg == Native.WM_HOTKEY) Host.Emit("hotkey", "name", "ghost");
            base.WndProc(ref m);
        }
    }

    static class Host
    {
        static readonly object OutLock = new object();
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        static HostForm form;
        static IntPtr target = IntPtr.Zero;
        static bool watching;
        static List<string> allowedHosts = new List<string>();
        static uint ignoreSequence;
        static string lastLink;
        static DateTime lastLinkAt = DateTime.MinValue;
        static NotifyIcon tray;
        static CardForm card;
        static bool dialogOpen;
        static uint excludeFormat, historyFormat, viewerIgnoreFormat;

        [STAThread]
        static int Main(string[] args)
        {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            Application.EnableVisualStyles();
            excludeFormat = Native.RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
            historyFormat = Native.RegisterClipboardFormat("CanIncludeInClipboardHistory");
            viewerIgnoreFormat = Native.RegisterClipboardFormat("Clipboard Viewer Ignore");

            form = new HostForm();
            IntPtr handle = form.Handle; // creates the message window
            var reader = new Thread(ReadLoop);
            reader.IsBackground = true;
            reader.Start();
            Application.Run();
            if (tray != null) tray.Dispose();
            if (card != null) card.Dispose();
            return 0;
        }

        static void ReadLoop()
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                string captured = line;
                try { form.BeginInvoke((MethodInvoker)delegate { Handle(captured); }); }
                catch { break; }
            }
            // Axive is gone: so are we
            try { form.BeginInvoke((MethodInvoker)delegate { Application.Exit(); }); } catch { }
        }

        static void Write(Dictionary<string, object> message)
        {
            string text = Json.Serialize(message);
            lock (OutLock)
            {
                Console.Out.WriteLine(text);
                Console.Out.Flush();
            }
        }

        public static void Emit(string name, string key, string value)
        {
            var message = new Dictionary<string, object>();
            message["event"] = name;
            if (key != null) message[key] = value;
            Write(message);
        }

        static void Reply(object id, bool ok, object result)
        {
            var message = new Dictionary<string, object>();
            message["id"] = id;
            message["ok"] = ok;
            message[ok ? "result" : "error"] = result;
            Write(message);
        }

        static string Str(Dictionary<string, object> args, string key)
        {
            object value;
            return args.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : null;
        }

        static int Int(Dictionary<string, object> args, string key, int fallback)
        {
            object value;
            if (!args.TryGetValue(key, out value) || value == null) return fallback;
            try { return Convert.ToInt32(value); } catch { return fallback; }
        }

        static void Handle(string line)
        {
            Dictionary<string, object> request;
            try { request = Json.DeserializeObject(line) as Dictionary<string, object>; }
            catch { return; }
            if (request == null) return;
            object id;
            request.TryGetValue("id", out id);
            string cmd = Str(request, "cmd") ?? "";
            try
            {
                switch (cmd)
                {
                    case "ping": Reply(id, true, "axive-host 1.0"); break;
                    case "idle": // how long since the owner last touched the keyboard or mouse (speed limits that apply only while they are here)
                        {
                            var info = new Native.LASTINPUTINFO();
                            info.cbSize = (uint)Marshal.SizeOf(info);
                            long ms = Native.GetLastInputInfo(ref info) ? (long)unchecked((uint)Environment.TickCount - info.dwTime) : -1;
                            Reply(id, true, new System.Collections.Generic.Dictionary<string, object> { { "ms", ms } });
                        }
                        break;
                    case "window": Reply(id, true, Window(Str(request, "op"), request)); break;
                    case "adopt": // the GUI window: pickers belong to it, the ghost card knows when it is in front
                        target = new IntPtr(Convert.ToInt64(request["hwnd"]));
                        Reply(id, true, Native.IsWindow(target));
                        break;
                    case "pickFolder":
                    case "pickFile":
                        if (dialogOpen) { Reply(id, false, "busy"); break; }
                        dialogOpen = true;
                        try
                        {
                            string picked = Dialogs.Pick(cmd == "pickFolder", Str(request, "title"), Str(request, "initial"),
                                Str(request, "filterName"), Str(request, "filter"), FindTarget());
                            Reply(id, true, picked);
                        }
                        finally { dialogOpen = false; }
                        break;
                    case "clipRead": Reply(id, true, ReadClipboard()); break;
                    case "clipWrite":
                        WriteClipboard(Str(request, "text") ?? "");
                        Reply(id, true, null);
                        break;
                    case "watch":
                        Watch(Str(request, "on") == "True", request);
                        Reply(id, true, watching);
                        break;
                    case "hotkey":
                        bool on = Str(request, "on") == "True";
                        Native.UnregisterHotKey(form.Handle, 1);
                        bool registered = !on || Native.RegisterHotKey(form.Handle, 1, Native.MOD_CONTROL | Native.MOD_ALT | Native.MOD_NOREPEAT, (uint)Keys.G);
                        Reply(id, true, registered);
                        break;
                    case "card":
                        Reply(id, true, ShowCard(request));
                        break;
                    case "cardPress": // the same path a click takes (used by the packaged-exe tests)
                        bool pressed = card != null && card.Visible;
                        if (pressed) card.Press(Str(request, "action") ?? "dismiss");
                        Reply(id, true, pressed);
                        break;
                    case "cardState":
                        Reply(id, true, card != null && card.Visible ? card.Bounds.ToString() : null);
                        break;
                    case "cardClose":
                        if (card != null && card.Visible && card.Key == Str(request, "key")) card.Sink();
                        Reply(id, true, null);
                        break;
                    case "reveal": // the folder, with the file selected: the shell's own call, no command line to misread
                        Reply(id, true, Shell.Reveal(Str(request, "path")));
                        break;
                    case "open": // a file with the program Windows opens it with (Axive never sends a program here)
                        Reply(id, true, Shell.Open(Str(request, "path")));
                        break;
                    case "notify":
                        Notify(Str(request, "title") ?? "Axive", Str(request, "text") ?? "");
                        Reply(id, true, null);
                        break;
                    case "sound":
                        if (Str(request, "kind") == "error") System.Media.SystemSounds.Hand.Play();
                        else if (Str(request, "kind") == "chime") ThreadPool.QueueUserWorkItem(_ => PlayChime());
                        else System.Media.SystemSounds.Asterisk.Play();
                        Reply(id, true, null);
                        break;
                    default: Reply(id, false, "unknown command"); break;
                }
            }
            catch (Exception e) { Reply(id, false, e.Message); }
        }

        // --- the terminal window ---------------------------------------

        static IntPtr FindTarget()
        {
            if (target != IntPtr.Zero && Native.IsWindow(target)) return target;
            IntPtr console = Native.GetConsoleWindow();
            if (console == IntPtr.Zero) return IntPtr.Zero;
            string cls = Native.ClassOf(console);
            if (cls == "ConsoleWindowClass") return target = console; // the classic console host
            // ConPTY (Windows Terminal and friends): the real window owns the pseudo one
            IntPtr owner = Native.GetAncestor(console, Native.GA_ROOTOWNER);
            if (owner == IntPtr.Zero || owner == console) owner = Native.GetWindow(console, Native.GW_OWNER);
            if (owner != IntPtr.Zero && owner != console) return target = owner;
            return IntPtr.Zero;
        }

        static IntPtr FindByTitle(string title)
        {
            IntPtr found = IntPtr.Zero;
            Native.EnumWindows(delegate (IntPtr h, IntPtr p)
            {
                if (Native.IsWindowVisible(h) && Native.TitleOf(h) == title) { found = h; return false; }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        static object Window(string op, Dictionary<string, object> args)
        {
            string title = Str(args, "title");
            if (!string.IsNullOrEmpty(title) && FindTarget() == IntPtr.Zero)
            {
                IntPtr byTitle = FindByTitle(title);
                if (byTitle != IntPtr.Zero) target = byTitle;
            }
            IntPtr h = FindTarget();
            if (h == IntPtr.Zero) throw new InvalidOperationException("no window");
            switch (op)
            {
                case "find":
                    return Native.ClassOf(h);
                case "minimize":
                    Native.ShowWindow(h, Native.SW_MINIMIZE);
                    return true;
                case "toggleMax":
                    Native.ShowWindow(h, Native.IsZoomed(h) ? Native.SW_RESTORE : Native.SW_MAXIMIZE);
                    return Native.IsZoomed(h);
                case "isMax":
                    return Native.IsZoomed(h);
                case "close":
                    Native.PostMessage(h, Native.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                    return true;
                case "drag":
                    // the mouse button is still down on Axive's title row: hand the
                    // window to Windows' own move loop, which follows the mouse
                    Native.ReleaseCapture();
                    Native.PostMessage(h, Native.WM_SYSCOMMAND, (IntPtr)Native.SC_DRAGMOVE, IntPtr.Zero);
                    return true;
                case "focus":
                    ForceForeground(h);
                    return true;
                case "minimizeLater":
                    Native.ShowWindow(h, Native.SW_MINIMIZE);
                    return true;
                case "fit":
                {
                    // keep the window on its screen, at the asked size at most
                    int w = Int(args, "width", 0), hgt = Int(args, "height", 0);
                    Native.RECT r;
                    if (w <= 0 || hgt <= 0 || !Native.GetWindowRect(h, out r)) return false;
                    Rectangle area = Screen.FromHandle(h).WorkingArea;
                    w = Math.Min(w, area.Width);
                    hgt = Math.Min(hgt, area.Height);
                    int x = area.Left + (area.Width - w) / 2, y = area.Top + (area.Height - hgt) / 2;
                    Native.SetWindowPos(h, IntPtr.Zero, x, y, w, hgt, Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
                    return true;
                }
                default:
                    throw new ArgumentException("unknown window op");
            }
        }

        static void ForceForeground(IntPtr h)
        {
            IntPtr fg = Native.GetForegroundWindow();
            uint fgThread = Native.GetWindowThreadProcessId(fg, IntPtr.Zero);
            uint mine = Native.GetCurrentThreadId();
            bool attached = fgThread != 0 && fgThread != mine && Native.AttachThreadInput(mine, fgThread, true);
            try
            {
                if (Native.IsIconic(h)) Native.ShowWindow(h, Native.SW_RESTORE);
                Native.SetForegroundWindow(h);
                Native.BringWindowToTop(h);
            }
            finally
            {
                if (attached) Native.AttachThreadInput(mine, fgThread, false);
            }
        }

        /** A dialog opened from a background helper starts behind the terminal; lift it once it exists. */
        public static void RaiseSoon()
        {
            uint uiThread = Native.GetCurrentThreadId();
            var raiser = new Thread(delegate ()
            {
                for (int i = 0; i < 60; i++)
                {
                    Thread.Sleep(50);
                    IntPtr dialog = IntPtr.Zero;
                    Native.EnumThreadWindows(uiThread, delegate (IntPtr h, IntPtr p)
                    {
                        if (Native.IsWindowVisible(h) && Native.ClassOf(h) == "#32770") { dialog = h; return false; }
                        return true;
                    }, IntPtr.Zero);
                    if (dialog != IntPtr.Zero) { ForceForeground(dialog); return; }
                }
            });
            raiser.IsBackground = true;
            raiser.Start();
        }

        // --- the clipboard -------------------------------------------------

        static string ReadClipboard()
        {
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try { return Clipboard.ContainsText() ? Clipboard.GetText(TextDataFormat.UnicodeText) : ""; }
                catch (ExternalException) { Thread.Sleep(40); }
            }
            return "";
        }

        // the ghost chime: our own synthesized WAV (scripts/make-chime.mjs), embedded at build time
        static byte[] chimeBytes;
        static void PlayChime()
        {
            try
            {
                if (chimeBytes == null)
                {
                    using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Axive.chime.wav"))
                    {
                        if (s == null) { System.Media.SystemSounds.Asterisk.Play(); return; }
                        var ms = new System.IO.MemoryStream();
                        s.CopyTo(ms);
                        chimeBytes = ms.ToArray();
                    }
                }
                using (var player = new System.Media.SoundPlayer(new System.IO.MemoryStream(chimeBytes))) player.PlaySync();
            }
            catch { try { System.Media.SystemSounds.Asterisk.Play(); } catch { } }
        }

        static void WriteClipboard(string text)
        {
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try
                {
                    if (text.Length == 0) Clipboard.Clear(); else Clipboard.SetText(text, TextDataFormat.UnicodeText);
                    // Axive's own copies must never come back as "a link surfaced"
                    ignoreSequence = Native.GetClipboardSequenceNumber();
                    return;
                }
                catch (ExternalException) { Thread.Sleep(40); }
            }
        }

        static void Watch(bool on, Dictionary<string, object> args)
        {
            object hosts;
            if (args.TryGetValue("hosts", out hosts) && hosts is object[])
            {
                var list = new List<string>();
                foreach (object item in (object[])hosts) if (item != null) list.Add(Convert.ToString(item).ToLowerInvariant());
                allowedHosts = list;
            }
            if (on && !watching) watching = Native.AddClipboardFormatListener(form.Handle);
            else if (!on && watching) { Native.RemoveClipboardFormatListener(form.Handle); watching = false; }
        }

        public static void OnClipboardChanged()
        {
            if (!watching) return;
            if (Native.GetClipboardSequenceNumber() == ignoreSequence) return;
            // password managers mark what they copy; such content is not ours to look at
            if (Native.IsClipboardFormatAvailable(excludeFormat) || Native.IsClipboardFormatAvailable(viewerIgnoreFormat)) return;
            if (Native.IsClipboardFormatAvailable(historyFormat)) return;
            string text = ReadClipboard();
            string link = FilterLink(text);
            text = null;
            if (link == null) return;
            if (link == lastLink && (DateTime.UtcNow - lastLinkAt).TotalSeconds < 5) return;
            lastLink = link;
            lastLinkAt = DateTime.UtcNow;
            Emit("clip", "url", link);
        }

        /** A single http(s) link whose host is allowlisted, or null. */
        static string FilterLink(string text)
        {
            if (text == null) return null;
            text = text.Trim();
            if (text.Length < 10 || text.Length > 2048) return null;
            foreach (char c in text) if (char.IsWhiteSpace(c) || char.IsControl(c)) return null;
            Uri uri;
            if (!Uri.TryCreate(text, UriKind.Absolute, out uri)) return null;
            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;
            string host = uri.Host.ToLowerInvariant();
            foreach (string allowed in allowedHosts)
            {
                if (host == allowed || host.EndsWith("." + allowed)) return text;
            }
            return null;
        }

        // --- notifications -------------------------------------------------

        [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

        /** Shows (or refreshes) the ghost card; false when Axive itself is the window in front. */
        static bool ShowCard(Dictionary<string, object> request)
        {
            if (Str(request, "unlessFront") == "True")
            {
                IntPtr mine = FindTarget(), front = Native.GetForegroundWindow();
                if (mine != IntPtr.Zero && front != IntPtr.Zero && Native.GetAncestor(front, Native.GA_ROOTOWNER) == Native.GetAncestor(mine, Native.GA_ROOTOWNER)) return false;
            }
            var ids = new List<string>();
            var labels = new List<string>();
            foreach (string pair in (Str(request, "actions") ?? "").Split('|'))
            {
                int eq = pair.IndexOf('=');
                if (eq <= 0 || ids.Count >= 3) continue;
                ids.Add(pair.Substring(0, eq));
                labels.Add(pair.Substring(eq + 1));
            }
            if (card == null || card.IsDisposed)
            {
                // crisp on high-DPI screens: this one window is system-aware (Windows 10 1607+)
                IntPtr before = IntPtr.Zero;
                try { before = SetThreadDpiAwarenessContext(new IntPtr(-2)); } catch { }
                try
                {
                    float scale = 1f;
                    using (var probe = new Form()) using (var g = probe.CreateGraphics()) scale = g.DpiX / 96f;
                    card = new CardForm(scale);
                    IntPtr made = card.Handle;
                }
                finally { if (before != IntPtr.Zero) try { SetThreadDpiAwarenessContext(before); } catch { } }
                card.Acted += delegate (string key, string action)
                {
                    var message = new Dictionary<string, object>();
                    message["event"] = "card";
                    message["key"] = key;
                    message["action"] = action;
                    Write(message);
                };
            }
            card.Present(Str(request, "key") ?? "", Str(request, "title") ?? "Axive", Str(request, "text") ?? "", ids.ToArray(), labels.ToArray(), Int(request, "ttl", 9000));
            return true;
        }

        static void Notify(string title, string text)
        {
            if (tray == null)
            {
                tray = new NotifyIcon();
                try { tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { tray.Icon = SystemIcons.Application; }
                tray.Text = "Axive";
                tray.BalloonTipClicked += delegate { Emit("toastClick", null, null); tray.Visible = false; };
                tray.BalloonTipClosed += delegate { tray.Visible = false; };
            }
            tray.Visible = true;
            tray.ShowBalloonTip(6000, title, text, ToolTipIcon.None);
        }
    }
}
