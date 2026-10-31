// Axive's window: the graphical interface, drawn by the same Node core as the
// terminal one, shown in a native Windows window through WebView2 (the Edge
// engine that ships with Windows 10 and 11).
//
// The core starts this with the local address of its interface:
//   axive-window.exe --url http://127.0.0.1:<port>/?k=<token> --data <folder>
// It prints one JSON line when the window exists ({"event":"ready","hwnd":N}),
// one if WebView2 is missing ({"event":"noruntime"}, exit 3), and exits 0 when
// the window is closed. It never navigates anywhere but that one origin:
// other https links open in the default browser.
//
// Built with the C# compiler that ships with Windows (.NET Framework 4.x),
// referencing the WebView2 SDK's WinForms and Core assemblies (BSD-style
// licence, redistributable), which sit next to the exe with WebView2Loader.dll.

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class AxiveWindow
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SetCurrentProcessExplicitAppUserModelID(string id);

    [STAThread]
    static int Main(string[] args)
    {
        // the window's own taskbar identity: never stacked with the terminal
        try { SetCurrentProcessExplicitAppUserModelID("Axive.Free.Window"); } catch { }
        string url = Arg(args, "--url"), data = Arg(args, "--data"), title = Arg(args, "--title") ?? "Axive Free";
        if (url == null || !url.StartsWith("http://127.0.0.1:")) { Console.Error.WriteLine("usage: axive-window --url http://127.0.0.1:<port>/... --data <folder>"); return 2; }
        try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch (Exception) { Say("{\"event\":\"noruntime\"}"); return 3; }
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } // per-monitor v2: crisp text on every screen
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var form = new GuiForm(new Uri(url), data ?? Path.Combine(Path.GetTempPath(), "axive-gui"), title);
        Application.Run(form);
        return 0;
    }

    static string Arg(string[] args, string name)
    {
        for (int i = 0; i < args.Length - 1; i++) if (args[i] == name) return args[i + 1];
        return null;
    }

    public static void Say(string line)
    {
        Console.Out.WriteLine(line);
        Console.Out.Flush();
    }

    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}

sealed class GuiForm : Form
{
    readonly Uri home;
    readonly string data;
    readonly WebView2 view = new WebView2();
    static readonly Color Ground = Color.FromArgb(6, 6, 9);

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    public GuiForm(Uri home, string data, string title)
    {
        this.home = home;
        this.data = data;
        Text = title;
        BackColor = Ground;
        MinimumSize = new Size(940, 640);
        StartPosition = FormStartPosition.Manual;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        Restore();
        view.DefaultBackgroundColor = Ground; // no white flash before the page paints
        // until the page has painted, the window shows Axive's mark, never an empty frame
        view.Visible = false;
        DoubleBuffered = true;
        LoadFont();
        view.Dock = DockStyle.Fill;
        Controls.Add(view);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // the title bar in the house colours: dark mode (Windows 10 20H1+), then
        // the caption, its text and the border (Windows 11). Ignored where unsupported.
        int on = 1, caption = 0x00090606, text = 0x00BFD0D8, border = 0x002B2225;
        DwmSetWindowAttribute(Handle, 20, ref on, 4);
        DwmSetWindowAttribute(Handle, 35, ref caption, 4);
        DwmSetWindowAttribute(Handle, 36, ref text, 4);
        DwmSetWindowAttribute(Handle, 34, ref border, 4);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        AxiveWindow.Say("{\"event\":\"ready\",\"hwnd\":" + Handle.ToInt64() + "}");
        try { await Start(); }
        catch (Exception error)
        {
            AxiveWindow.Say("{\"event\":\"failed\"}");
            MessageBox.Show(this, "The window of Axive Free could not start: " + error.Message, "Axive Free", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    async Task Start()
    {
        Directory.CreateDirectory(data);
        var env = await CoreWebView2Environment.CreateAsync(null, data, new CoreWebView2EnvironmentOptions { Language = "en-GB" });
        await view.EnsureCoreWebView2Async(env);
        var core = view.CoreWebView2;
        var settings = core.Settings;
        bool devtools = Environment.GetEnvironmentVariable("AXIVE_GUI_DEVTOOLS") == "1";
        settings.AreDevToolsEnabled = devtools;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = true;            // ctrl + wheel / ctrl + = : larger text for those who need it
        settings.AreBrowserAcceleratorKeysEnabled = devtools; // no F5 / ctrl+R / ctrl+P: this is an app, not a page
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        // the one origin, and nothing else
        core.NavigationStarting += (s, a) =>
        {
            Uri to;
            if (!Uri.TryCreate(a.Uri, UriKind.Absolute, out to) || to.Scheme == "about") return;
            if (to.Host == home.Host && to.Port == home.Port && to.Scheme == home.Scheme) return;
            a.Cancel = true;
            OpenOutside(to);
        };
        core.NewWindowRequested += (s, a) =>
        {
            a.Handled = true;
            Uri to;
            if (Uri.TryCreate(a.Uri, UriKind.Absolute, out to)) OpenOutside(to);
        };
        // the right-click menu keeps what editing needs, nothing that reloads or inspects
        core.ContextMenuRequested += (s, a) =>
        {
            var keep = new[] { "cut", "copy", "paste", "selectAll", "undo", "redo" };
            for (int i = a.MenuItems.Count - 1; i >= 0; i--)
                if (Array.IndexOf(keep, a.MenuItems[i].Name) < 0 && !devtools) a.MenuItems.RemoveAt(i);
            if (a.MenuItems.Count == 0) a.Handled = true;
        };
        // files dropped on the page: the page cannot see their paths, the window can
        core.WebMessageReceived += (s, a) =>
        {
            var paths = new System.Collections.Generic.List<string>();
            if (a.AdditionalObjects != null)
                foreach (object o in a.AdditionalObjects)
                {
                    var file = o as CoreWebView2File;
                    if (file != null && !string.IsNullOrEmpty(file.Path)) paths.Add(file.Path.Replace("\\", "\\\\").Replace("\"", "\\\""));
                }
            if (paths.Count > 0) core.PostWebMessageAsJson("{\"dropped\":[\"" + string.Join("\",\"", paths) + "\"]}");
        };
        core.NavigationCompleted += (s, a) =>
        {
            // the page says when it has painted; this is the fallback
            var later = new Timer { Interval = 600 };
            later.Tick += (o, e) => { later.Stop(); Uncover(); };
            later.Start();
        };
        core.WebMessageReceived += (s, a) =>
        {
            string text = null;
            try { text = a.TryGetWebMessageAsString(); } catch { }
            if (text == "painted") Uncover();
        };
        core.DocumentTitleChanged += (s, a) => Text = string.IsNullOrEmpty(core.DocumentTitle) ? "Axive Free" : core.DocumentTitle;
        core.Navigate(home.ToString());
    }

    void Uncover()
    {
        if (view.Visible) return;
        view.Visible = true;
        view.Focus();
    }

    // --- the mark, painted while the page loads -----------------------------

    readonly PrivateFontCollection fonts = new PrivateFontCollection();
    static readonly Color Ink = Color.FromArgb(216, 208, 191), Signal = Color.FromArgb(125, 15, 23);

    void LoadFont()
    {
        try
        {
            using (Stream s = typeof(GuiForm).Assembly.GetManifestResourceStream("cormorant-sc-500.ttf"))
            {
                if (s == null) return;
                var bytes = new byte[s.Length];
                s.Read(bytes, 0, bytes.Length);
                IntPtr mem = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, mem, bytes.Length);
                fonts.AddMemoryFont(mem, bytes.Length);
            }
        }
        catch { }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (view.Visible) return;
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        float k = DeviceDpi / 96f, w = ClientSize.Width, h = ClientSize.Height;
        FontFamily family = fonts.Families.Length > 0 ? fonts.Families[0] : new FontFamily("Georgia");
        using (var font = new Font(family, 34 * k, FontStyle.Regular, GraphicsUnit.Pixel))
        using (var brush = new SolidBrush(Ink))
        {
            var format = StringFormat.GenericTypographic;
            const string word = "AXIVE";
            float gap = font.Size * 0.55f, total = 0;
            var widths = new float[word.Length];
            for (int i = 0; i < word.Length; i++) { widths[i] = g.MeasureString(word[i].ToString(), font, PointF.Empty, format).Width; total += widths[i] + (i < word.Length - 1 ? gap : 0); }
            float x = (w - total) / 2, y = h * 0.42f - font.Size * 0.62f;
            for (int i = 0; i < word.Length; i++) { g.DrawString(word[i].ToString(), font, brush, x, y, format); x += widths[i] + gap; }
        }
        using (var seal = new SolidBrush(Signal)) g.FillRectangle(seal, w / 2 - 3 * k, h * 0.42f + 30 * k, 6 * k, 6 * k);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (!view.Visible) Invalidate();
    }

    static void OpenOutside(Uri to)
    {
        if (to.Scheme != "https") return;
        try { Process.Start(new ProcessStartInfo(to.ToString()) { UseShellExecute = true }); } catch { }
    }

    // --- where the window was ------------------------------------------------

    string PlacementFile { get { return Path.Combine(data, "placement.txt"); } }

    void Restore()
    {
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        var size = new Size(Math.Min(1220, area.Width - 80), Math.Min(820, area.Height - 60));
        Bounds = new Rectangle(area.Left + (area.Width - size.Width) / 2, area.Top + (area.Height - size.Height) / 2, size.Width, size.Height);
        try
        {
            string[] p = File.ReadAllText(PlacementFile).Split(',');
            var saved = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            // only if it is still on a screen (a monitor may have gone)
            foreach (Screen s in Screen.AllScreens)
                if (s.WorkingArea.IntersectsWith(saved) && saved.Width >= MinimumSize.Width && saved.Height >= MinimumSize.Height) { Bounds = saved; break; }
            if (p.Length > 4 && p[4] == "max") WindowState = FormWindowState.Maximized;
        }
        catch { }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        try
        {
            Rectangle r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            File.WriteAllText(PlacementFile, string.Format("{0},{1},{2},{3},{4}", r.X, r.Y, r.Width, r.Height, WindowState == FormWindowState.Maximized ? "max" : "normal"));
        }
        catch { }
        base.OnFormClosing(e);
    }
}
