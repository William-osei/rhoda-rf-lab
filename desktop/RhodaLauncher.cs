using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using Microsoft.Win32;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("RHODA — Lab Companion")]
[assembly: AssemblyProduct("RHODA")]
[assembly: AssemblyDescription("Local offline RHODA desktop supervisor")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace RhodaDesktop
{
    internal sealed class Options
    {
        public string ConfigPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "rhoda-desktop.json");
        public string DataDir;
        public int DebugPort;
        public bool Check;
        public bool Exit;
        public static Options Parse(string[] args)
        {
            var value = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--check": value.Check = true; break;
                    case "--exit": value.Exit = true; break;
                    case "--config": value.ConfigPath = Next(args, ref i); break;
                    case "--data-dir": value.DataDir = Next(args, ref i); break;
                    case "--debug-port":
                        int port;
                        if (!Int32.TryParse(Next(args, ref i), out port) || port < 1024 || port > 65535)
                            throw new InvalidOperationException("--debug-port must be between 1024 and 65535.");
                        value.DebugPort = port;
                        break;
                    default: throw new InvalidOperationException("Unknown launcher option: " + args[i]);
                }
            }
            if (value.Check && value.Exit) throw new InvalidOperationException("Use --check or --exit separately.");
            return value;
        }
        private static string Next(string[] args, ref int index)
        {
            if (++index >= args.Length) throw new InvalidOperationException("A launcher option is missing its value.");
            return args[index];
        }
    }

    internal sealed class Configuration
    {
        public string ProjectRoot;
        public string ResourceRoot;
        public string DataDir;
        public string ProjectId;
        public string BrowserPath;
        public string PythonPath;
        public bool Portable;
        public int Port;
        public int DebugPort;
        public string DisplayMode = "borderless";
        private string configPath;
        public string Origin { get { return "http://127.0.0.1:" + Port; } }
        public string ProfilePath { get { return Path.Combine(DataDir, "browser-profile"); } }
        public string LogDir { get { return Path.Combine(DataDir, "logs"); } }
        public string InstanceName { get { return "Local\\RHODA.Desktop." + ProjectId; } }

        public static Configuration Load(Options options)
        {
            var configPath = Path.GetFullPath(options.ConfigPath);
            if (!File.Exists(configPath)) throw new InvalidOperationException("rhoda-desktop.json is missing beside RHODA.exe. Run desktop/install-local.ps1 to create the app entry point.");
            if (new FileInfo(configPath).Length > 65536) throw new InvalidOperationException("The desktop configuration is too large.");
            var raw = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath));
            if (raw == null) throw new InvalidOperationException("The desktop configuration is empty.");
            var directory = Path.GetDirectoryName(configPath);
            var config = new Configuration();
            config.configPath = configPath;
            config.ProjectRoot = Native.CanonicalDirectory(Resolve(directory, RequiredString(raw, "projectRoot")));
            config.ResourceRoot = Native.CanonicalDirectory(Resolve(directory, RequiredString(raw, "resourceRoot")));
            config.Port = raw.ContainsKey("port") ? Convert.ToInt32(raw["port"]) : 8765;
            if (config.Port < 1024 || config.Port > 65535) throw new InvalidOperationException("The local app port must be between 1024 and 65535.");
            config.DebugPort = options.DebugPort;
            if (config.DebugPort == config.Port) throw new InvalidOperationException("The debugging port must differ from the app port.");
            config.Portable = raw.ContainsKey("portable") && raw["portable"] is bool && (bool)raw["portable"];
            if (raw.ContainsKey("displayMode") && raw["displayMode"] is string)
            {
                var displayMode = ((string)raw["displayMode"]).ToLowerInvariant();
                if (displayMode == "windowed" || displayMode == "fullscreen" || displayMode == "borderless") config.DisplayMode = displayMode;
            }
            using (var hash = SHA256.Create())
                config.ProjectId = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(config.ProjectRoot.TrimEnd('\\').ToLowerInvariant()))).Replace("-", "").Substring(0, 20).ToLowerInvariant();
            if (options.DataDir != null) config.DataDir = Path.GetFullPath(options.DataDir);
            else if (raw.ContainsKey("dataDir")) config.DataDir = Resolve(directory, RequiredString(raw, "dataDir"));
            else config.DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RHODA Desktop", "instances", config.ProjectId);
            var displayPreferencePath = Path.Combine(config.DataDir, "display-mode.json");
            if (File.Exists(displayPreferencePath))
            {
                try
                {
                    var preference = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(displayPreferencePath));
                    if (preference != null && preference.ContainsKey("mode") && preference["mode"] is string)
                    {
                        var displayMode = ((string)preference["mode"]).ToLowerInvariant();
                        if (displayMode == "windowed" || displayMode == "fullscreen" || displayMode == "borderless") config.DisplayMode = displayMode;
                    }
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                catch (InvalidOperationException) { }
                catch (ArgumentException) { }
            }
            config.PythonPath = raw.ContainsKey("pythonPath") ? Resolve(directory, RequiredString(raw, "pythonPath")) : Path.Combine(config.ProjectRoot, ".venv", "Scripts", "python.exe");
            config.BrowserPath = FindBrowser();
            return config;
        }
        public void SaveDisplayMode(string displayMode)
        {
            if (displayMode != "windowed" && displayMode != "fullscreen" && displayMode != "borderless")
                throw new InvalidOperationException("Unsupported display mode.");
            var raw = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath));
            if (raw == null) throw new InvalidOperationException("The desktop configuration is empty.");
            raw["displayMode"] = displayMode;
            File.WriteAllText(configPath, new JavaScriptSerializer().Serialize(raw), Encoding.UTF8);
            DisplayMode = displayMode;
        }
        private static string Resolve(string parent, string value) { return Path.IsPathRooted(value) ? Path.GetFullPath(value) : Path.GetFullPath(Path.Combine(parent, value)); }
        private static string RequiredString(Dictionary<string, object> raw, string name)
        {
            object value;
            if (!raw.TryGetValue(name, out value) || !(value is string) || String.IsNullOrWhiteSpace((string)value))
                throw new InvalidOperationException("The desktop configuration needs " + name + ".");
            return (string)value;
        }
        private static string FindBrowser()
        {
            string[] paths = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe")
            };
            return paths.FirstOrDefault(File.Exists);
        }
        public List<string> Problems()
        {
            var errors = new List<string>();
            if (!File.Exists(PythonPath)) errors.Add(Portable
                ? "The bundled Python runtime is missing: runtime/python.exe."
                : "The project's Python environment is missing: .venv/Scripts/python.exe.");
            if (!File.Exists(Path.Combine(ProjectRoot, "desktop", "server.py"))) errors.Add("desktop/server.py is missing from the configured project.");
            if (!File.Exists(Path.Combine(ProjectRoot, "server", "app.py"))) errors.Add("The RHODA backend is missing from the configured project.");
            foreach (var name in new[] { "desktop.html", "index.html", "chat.html", "library.html", "practice.html", "spatial-bench.html", "instruments.html", "instructor.html" })
                if (!File.Exists(Path.Combine(ProjectRoot, "dist", name))) errors.Add("The built app is missing dist/" + name + ". Rebuild RHODA before launching.");
            if (!File.Exists(Path.Combine(ResourceRoot, "00-START-HERE", "catalog", "documents.json"))) errors.Add("The resource folder is missing 00-START-HERE/catalog/documents.json.");
            if (BrowserPath == null) errors.Add("Microsoft Edge is required to display RHODA's modern 3D interface.");
            if (EdgeProfilePolicyIsSet()) errors.Add("This PC has an Edge policy that forces a shared browser profile. RHODA stopped before opening it so your normal Edge windows and profile stay separate.");
            var fullData = Path.GetFullPath(DataDir).TrimEnd('\\') + "\\";
            var fullProject = ProjectRoot.TrimEnd('\\') + "\\";
            if (Portable && !fullData.StartsWith(fullProject, StringComparison.OrdinalIgnoreCase)) errors.Add("Portable mode keeps its data directory inside the extracted app folder.");
            if (!Portable && fullData.StartsWith(fullProject, StringComparison.OrdinalIgnoreCase)) errors.Add("Choose a data directory outside the development checkout so browser profiles do not trigger its watcher.");
            return errors;
        }
        private static bool EdgeProfilePolicyIsSet()
        {
            foreach (var hive in new[] { Registry.LocalMachine, Registry.CurrentUser })
            using (var policy = hive.OpenSubKey(@"SOFTWARE\Policies\Microsoft\Edge", false))
                if (policy != null && (policy.GetValue("UserDataDir") != null || policy.GetValue("UserDataDirSuffix") != null)) return true;
            return false;
        }
        public static bool PortOccupied(int port)
        {
            return IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(endpoint => endpoint.Port == port);
        }
        public static bool InstanceIsRunning(string instanceName)
        {
            try { using (Mutex.OpenExisting(instanceName)) return true; }
            catch (WaitHandleCannotBeOpenedException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            Options options = null;
            try
            {
                options = Options.Parse(args);
                var config = Configuration.Load(options);
                if (options.Check)
                {
                    var problems = config.Problems();
                    var instanceRunning = Configuration.InstanceIsRunning(config.InstanceName);
                    var portAvailable = !Configuration.PortOccupied(config.Port);
                    if (!portAvailable && !instanceRunning)
                        problems.Add("Local port " + config.Port + " is already in use by another process. Close it, or choose a different port in rhoda-desktop.json.");
                    WriteJson(new { ok = problems.Count == 0, projectRoot = config.ProjectRoot, resourceRoot = config.ResourceRoot, dataDir = config.DataDir,
                        port = config.Port, debugPort = config.DebugPort == 0 ? (int?)null : config.DebugPort, displayMode = config.DisplayMode, browser = config.BrowserPath, python = config.PythonPath,
                        appUrl = config.Origin + "/desktop.html", mode = "mock", portAvailable = portAvailable, existingInstanceRunning = instanceRunning,
                        requiresLocalPythonEnvironment = !config.Portable, pythonBundled = config.Portable,
                        requiresInstalledEdge = true, requiresNetFramework48 = true, problems = problems });
                    return problems.Count == 0 ? 0 : 1;
                }
                if (options.Exit)
                {
                    try { using (var stop = EventWaitHandle.OpenExisting(config.InstanceName + ".Stop")) stop.Set(); return 0; }
                    catch (WaitHandleCannotBeOpenedException) { return 0; }
                }
                bool first;
                using (var mutex = new Mutex(true, config.InstanceName, out first))
                {
                    if (!first)
                    {
                        Native.AllowSetForegroundWindow(-1);
                        for (int attempt = 0; attempt < 20; attempt++)
                        {
                            try { using (var focus = EventWaitHandle.OpenExisting(config.InstanceName + ".Focus")) focus.Set(); return 0; }
                            catch (WaitHandleCannotBeOpenedException) { Thread.Sleep(100); }
                        }
                        throw new InvalidOperationException("RHODA is already starting. Wait a moment, then open it again.");
                    }
                    try
                    {
                        Application.EnableVisualStyles();
                        Application.SetCompatibleTextRenderingDefault(false);
                        using (var focus = new EventWaitHandle(false, EventResetMode.AutoReset, config.InstanceName + ".Focus"))
                        using (var stop = new EventWaitHandle(false, EventResetMode.AutoReset, config.InstanceName + ".Stop"))
                        using (var form = new LauncherForm(config, focus, stop)) Application.Run(form);
                    }
                    finally { mutex.ReleaseMutex(); }
                }
                return 0;
            }
            catch (Exception error)
            {
                if (options != null && options.Check) WriteJson(new { ok = false, problems = new[] { error.Message } });
                else MessageBox.Show(error.Message, "RHODA could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
        private static void WriteJson(object value)
        {
            using (var writer = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)))
            { writer.WriteLine(new JavaScriptSerializer().Serialize(value)); writer.Flush(); }
        }
    }

    internal sealed class DisplaySettingsForm : Form
    {
        private readonly RadioButton windowed;
        private readonly RadioButton borderless;
        private readonly RadioButton fullscreen;
        public string SelectedMode
        {
            get
            {
                if (fullscreen.Checked) return "fullscreen";
                if (windowed.Checked) return "windowed";
                return "borderless";
            }
        }
        public DisplaySettingsForm(string currentMode)
        {
            Text = "RHODA display settings";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new Size(420, 245);
            Font = new Font("Segoe UI", 9F);

            var title = new Label { Text = "Choose how RHODA opens", AutoSize = true, Location = new Point(24, 20), Font = new Font("Segoe UI Semibold", 11F) };
            var hint = new Label { Text = "The setting is saved for the next launch.", AutoSize = true, Location = new Point(24, 50), ForeColor = Color.DimGray };
            borderless = new RadioButton { Text = "Borderless app (recommended)", AutoSize = true, Location = new Point(28, 82) };
            windowed = new RadioButton { Text = "Windowed app", AutoSize = true, Location = new Point(28, 116) };
            fullscreen = new RadioButton { Text = "Fullscreen", AutoSize = true, Location = new Point(28, 150) };
            borderless.Checked = currentMode != "windowed" && currentMode != "fullscreen";
            windowed.Checked = currentMode == "windowed";
            fullscreen.Checked = currentMode == "fullscreen";
            var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Size = new Size(90, 30), Location = new Point(214, 198) };
            var save = new Button { Text = "Save", DialogResult = DialogResult.OK, Size = new Size(90, 30), Location = new Point(314, 198) };
            AcceptButton = save;
            CancelButton = cancel;
            Controls.AddRange(new Control[] { title, hint, borderless, windowed, fullscreen, cancel, save });
        }
    }

    internal sealed class LauncherForm : Form
    {
        private readonly Configuration config;
        private readonly Label status;
        private readonly Label detail;
        private readonly Label pulse;
        private readonly Label title;
        private readonly ProgressBar progress;
        private readonly PictureBox splashArtwork;
        private readonly System.Windows.Forms.Timer animation;
        private readonly Button openButton;
        private readonly Button logsButton;
        private readonly Button exitButton;
        private readonly NotifyIcon tray;
        private readonly System.Windows.Forms.Timer monitor;
        private readonly RegisteredWaitHandle focusWait;
        private readonly RegisteredWaitHandle stopWait;
        private readonly CancellationTokenSource cancel = new CancellationTokenSource();
        private readonly object processLock = new object();
        private readonly object logLock = new object();
        private readonly DateTime startedAt = DateTime.UtcNow;
        private OwnedJob job;
        private Native.ChildProcess server;
        private Process initialBrowser;
        private DateTime browserStarted;
        private readonly Dictionary<int, DateTime> browserIdentities = new Dictionary<int, DateTime>();
        private HashSet<int> browserIds = new HashSet<int>();
        private IntPtr browserWindow;
        private DateTime lastOwnershipRefresh = DateTime.MinValue;
        private DateTime nextExitPoll = DateTime.MinValue;
        private DateTime windowMissingSince = DateTime.MinValue;
        private bool hadWindow;
        private bool initialized;
        private bool stopping;
        private bool allowClose;
        private int animationTick;
        private string token;
        private int serverPid;
        private int browserPid;
        private int exitPollInFlight;
        private string phase = "starting";

        public LauncherForm(Configuration configuration, EventWaitHandle focusEvent, EventWaitHandle stopEvent)
        {
            config = configuration;
            Text = "RHODA — Lab Companion";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            ClientSize = new Size(420, 640);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(15, 27, 38); ForeColor = Color.FromArgb(232, 241, 245);
            Font = new Font("Segoe UI", 10); FormBorderStyle = FormBorderStyle.None; MaximizeBox = false;
            Opacity = 0.0;
            title = new Label { Text = "RHODA", Font = new Font("Segoe UI Semibold", 24, FontStyle.Bold), ForeColor = Color.FromArgb(102, 226, 236), BackColor = Color.FromArgb(8, 13, 31), Location = new Point(28, 438), Size = new Size(150, 42) };
            var eyebrow = new Label { Text = "ROHDE & SCHWARZ  /  VIRTUAL LAB", Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Color.FromArgb(118, 190, 224), BackColor = Color.FromArgb(8, 13, 31), Location = new Point(28, 417), AutoSize = true };
            var subtitle = new Label { Text = "LAB COMPANION", Font = new Font("Segoe UI Semibold", 9, FontStyle.Bold), ForeColor = Color.FromArgb(220, 237, 246), BackColor = Color.FromArgb(8, 13, 31), Location = new Point(171, 455), AutoSize = true };
            status = new Label { Text = "Preparing your workspace…", Font = new Font("Segoe UI Semibold", 12, FontStyle.Bold), ForeColor = Color.FromArgb(241, 248, 251), BackColor = Color.FromArgb(8, 13, 31), Location = new Point(28, 493), Size = new Size(365, 28) };
            detail = new Label { Text = "Chat, resources and the virtual lab open together.", ForeColor = Color.FromArgb(169, 195, 209), BackColor = Color.FromArgb(8, 13, 31), Location = new Point(28, 522), Size = new Size(364, 42), AutoEllipsis = true };
            pulse = new Label { Text = "●  ●  ●", Font = new Font("Segoe UI", 9, FontStyle.Bold), ForeColor = Color.FromArgb(102, 226, 236), BackColor = Color.FromArgb(8, 13, 31), Location = new Point(345, 455), Size = new Size(48, 22), TextAlign = ContentAlignment.MiddleRight };
            progress = new ProgressBar { Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 28, Location = new Point(28, 573), Size = new Size(364, 8) };
            splashArtwork = new PictureBox { Location = new Point(0, 0), Size = ClientSize, SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.FromArgb(8, 13, 31), Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right };
            var splashPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "rhoda-splash.png");
            if (File.Exists(splashPath))
            {
                try { splashArtwork.Image = Image.FromFile(splashPath); }
                catch (Exception error) { Log("Could not load supplied splash artwork: " + error.Message); }
            }
            openButton = Button("Open RHODA", 28, delegate { FocusApp(); }); openButton.Enabled = false;
            logsButton = Button("Open logs", 152, delegate { OpenLogs(); });
            exitButton = Button("Exit RHODA", 276, delegate { BeginShutdown(); });
            var startupPanel = new Panel { Location = new Point(0, 410), Size = new Size(420, 230), BackColor = Color.FromArgb(8, 13, 31), Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right };
            Controls.AddRange(new Control[] { splashArtwork, startupPanel, eyebrow, title, subtitle, pulse, status, detail, progress, openButton, logsButton, exitButton });
            splashArtwork.SendToBack();
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open RHODA", null, delegate { FocusApp(); });
            menu.Items.Add("Display settings", null, delegate { OpenDisplaySettings(); });
            menu.Items.Add("Open logs", null, delegate { OpenLogs(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit RHODA", null, delegate { BeginShutdown(); });
            tray = new NotifyIcon { Icon = Icon, Text = "RHODA — starting", ContextMenuStrip = menu, Visible = true };
            tray.DoubleClick += delegate { FocusApp(); };
            monitor = new System.Windows.Forms.Timer { Interval = 250 };
            monitor.Tick += delegate { MonitorApp(); };
            animation = new System.Windows.Forms.Timer { Interval = 180 };
            animation.Tick += delegate
            {
                animationTick++;
                var dots = new string('●', (animationTick % 3) + 1);
                pulse.Text = dots.PadLeft(7, '·');
                var glow = 190 + ((animationTick % 4) * 14);
                title.ForeColor = Color.FromArgb(102, Math.Min(255, glow), 236);
                if (!stopping && Opacity < 1.0) Opacity = Math.Min(1.0, Opacity + 0.12);
            };
            animation.Start();
            focusWait = ThreadPool.RegisterWaitForSingleObject(focusEvent, delegate { Ui(FocusApp); }, null, Timeout.Infinite, false);
            stopWait = ThreadPool.RegisterWaitForSingleObject(stopEvent, delegate { Ui(BeginShutdown); }, null, Timeout.Infinite, false);
            Shown += delegate { Task.Run((Action)StartApp); };
            FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!allowClose) { e.Cancel = true; BeginShutdown(); } else { animation.Stop(); animation.Dispose(); } };
        }
        private Button Button(string label, int x, EventHandler handler)
        {
            var button = new Button { Text = label, Location = new Point(x, 594), Size = new Size(116, 32), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(17, 83, 124), ForeColor = Color.White, Font = new Font("Segoe UI Semibold", 8.5F, FontStyle.Bold) };
            button.Click += handler; return button;
        }
        private void Ui(Action action)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try { BeginInvoke(action); } catch (InvalidOperationException) { }
        }
        private void UpdateStatus(string heading, string message)
        {
            Ui(delegate { status.Text = heading; detail.Text = message; });
        }
        private void StartApp()
        {
            try
            {
                var problems = config.Problems();
                if (problems.Count > 0) throw new InvalidOperationException(String.Join("\n", problems));
                Directory.CreateDirectory(config.LogDir);
                Directory.CreateDirectory(config.ProfilePath);
                if (Configuration.PortOccupied(config.Port)) throw new InvalidOperationException("Local port " + config.Port + " is already in use. RHODA will not replace another service. Close that service, or choose a different port in rhoda-desktop.json.");
                if (config.DebugPort != 0 && Configuration.PortOccupied(config.DebugPort)) throw new InvalidOperationException("The requested debugging port is already in use. Choose a different --debug-port.");
                Log("Starting offline local workspace on port " + config.Port + ".");
                var bytes = new byte[32];
                using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
                token = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
                cancel.Token.ThrowIfCancellationRequested();
                var ownedJob = new OwnedJob();
                lock (processLock) { job = ownedJob; }
                var env = Native.EnvironmentBlock(new Dictionary<string, string> {
                    { "RHODA_DESKTOP_TOKEN", token }, { "SCOPE_RESOURCE", "" }, { "SCOPE_SIMULATE", "0" },
                    { "RHODA_AI_ENABLED", "0" }, { "RHODA_RAG_ENABLED", "1" }, { "HOST", "127.0.0.1" }, { "PORT", config.Port.ToString() },
                    { "PYTHONUTF8", "1" }, { "PYTHONUNBUFFERED", "1" }, { "PYTHONDONTWRITEBYTECODE", "1" }
                });
                var args = new[] { config.PythonPath, "-B", Path.Combine(config.ProjectRoot, "desktop", "server.py"), "--project-root", config.ProjectRoot,
                    "--resource-root", config.ResourceRoot, "--data-dir", config.DataDir, "--port", config.Port.ToString() };
                lock (processLock)
                {
                    cancel.Token.ThrowIfCancellationRequested();
                    server = Native.StartSuspended(config.PythonPath, args, config.ProjectRoot, env, Path.Combine(config.LogDir, "server.log"), job);
                    serverPid = server.Id;
                }
                WriteStatus();
                UpdateStatus("Starting the local service…", "Preparing the training simulator and resource library. No instrument hardware or paid AI provider is connected.");
                var deadline = DateTime.UtcNow.AddSeconds(40);
                bool ready = false;
                while (DateTime.UtcNow < deadline && !cancel.IsCancellationRequested)
                {
                    try
                    {
                        var response = Request("/_desktop/ready", "GET");
                        object app, available, mode, port, pid;
                        if (response.TryGetValue("app", out app) && Convert.ToString(app) == "rhoda-desktop" &&
                            response.TryGetValue("ready", out available) && available is bool && (bool)available &&
                            response.TryGetValue("mode", out mode) && Convert.ToString(mode) == "mock" &&
                            response.TryGetValue("port", out port) && Convert.ToInt32(port) == config.Port &&
                            response.TryGetValue("pid", out pid) && job.Contains(Convert.ToInt32(pid)) &&
                            response.ContainsKey("projectId") && Convert.ToString(response["projectId"]) == config.ProjectId)
                        { serverPid = Convert.ToInt32(pid); ready = true; break; }
                    }
                    catch (WebException) { }
                    catch (IOException) { }
                    if (job.ActiveProcesses == 0) throw new InvalidOperationException("The local service exited during startup. Open logs to see its Python error; the launcher has not reused another service.");
                    cancel.Token.WaitHandle.WaitOne(250);
                }
                cancel.Token.ThrowIfCancellationRequested();
                if (!ready) throw new InvalidOperationException("The local service did not become ready within 40 seconds. Open logs to check the Python environment, account configuration or occupied port.");
                phase = "ready"; WriteStatus();
                UpdateStatus("Opening RHODA…", "Your workspace uses its own Edge window and profile. Close the app window when you are finished.");
                StartBrowser();
                Ui(delegate { initialized = true; monitor.Start(); });
            }
            catch (OperationCanceledException) { }
            catch (Exception error) { Fail(error.Message); }
        }
        private Dictionary<string, object> Request(string path, string method)
        {
            var request = (HttpWebRequest)WebRequest.Create(config.Origin + path);
            request.Proxy = null; request.AllowAutoRedirect = false; request.Method = method; request.Timeout = 2000; request.ReadWriteTimeout = 2000;
            request.Headers["X-Rhoda-Desktop-Token"] = token;
            if (method == "POST") request.ContentLength = 0;
            using (var response = request.GetResponse())
            using (var stream = response.GetResponseStream())
            using (var reader = new StreamReader(stream))
            {
                var buffer = new char[65537]; int count = 0, read;
                while (count < buffer.Length && (read = reader.Read(buffer, count, buffer.Length - count)) > 0) count += read;
                if (count > 65536) throw new IOException("The local readiness response was too large.");
                var body = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(new string(buffer, 0, count));
                if (body == null) throw new IOException("The local readiness response was empty.");
                return body;
            }
        }
        private void StartBrowser()
        {
            var args = new List<string> { "--user-data-dir=" + config.ProfilePath, "--disable-background-mode", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--app=" + config.Origin + "/desktop.html" };
            if (config.DisplayMode == "fullscreen") args.Add("--start-fullscreen");
            if (config.DisplayMode == "windowed") args.Add("--start-maximized=false");
            if (config.DebugPort != 0)
            { args.Add("--remote-debugging-address=127.0.0.1"); args.Add("--remote-debugging-port=" + config.DebugPort); }
            cancel.Token.ThrowIfCancellationRequested();
            lock (processLock)
            {
                cancel.Token.ThrowIfCancellationRequested();
                browserStarted = DateTime.UtcNow;
                initialBrowser = Process.Start(new ProcessStartInfo(config.BrowserPath, String.Join(" ", args.Select(Native.Quote))) {
                    UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Normal, WorkingDirectory = config.DataDir
                });
                if (initialBrowser == null) throw new InvalidOperationException("Microsoft Edge did not start.");
                browserPid = initialBrowser.Id;
            }
            Log("Opened dedicated Edge application profile" + (config.DebugPort == 0 ? "." : " with explicitly requested local debugging."));
            WriteStatus();
        }
        private void RefreshBrowserOwnership()
        {
            var ids = new HashSet<int>();
            var rows = new List<Tuple<int, int, string>>();
            try
            {
                using (var search = new ManagementObjectSearcher("SELECT ProcessId, ParentProcessId, CommandLine FROM Win32_Process WHERE Name='msedge.exe'"))
                using (var collection = search.Get())
                    foreach (ManagementObject row in collection)
                    {
                        using (row) rows.Add(Tuple.Create(Convert.ToInt32(row["ProcessId"]), Convert.ToInt32(row["ParentProcessId"]), Convert.ToString(row["CommandLine"])));
                    }
                foreach (var row in rows)
                    if (Native.HasExactProfile(row.Item3, config.ProfilePath)) ids.Add(row.Item1);
                bool changed;
                do { changed = false; foreach (var row in rows) if (!ids.Contains(row.Item1) && ids.Contains(row.Item2)) { ids.Add(row.Item1); changed = true; } } while (changed);
            }
            catch (ManagementException) { }
            catch (UnauthorizedAccessException) { }
            lock (processLock)
            {
                if (initialBrowser != null)
                    try { if (!initialBrowser.HasExited) ids.Add(initialBrowser.Id); } catch (InvalidOperationException) { }
                foreach (var id in ids.ToArray())
                {
                    try
                    {
                        using (var process = Process.GetProcessById(id))
                        {
                            var start = process.StartTime.ToUniversalTime();
                            DateTime known;
                            if (browserIdentities.TryGetValue(id, out known) && known != start) { ids.Remove(id); continue; }
                            browserIdentities[id] = start;
                        }
                    }
                    catch (ArgumentException) { ids.Remove(id); }
                    catch (System.ComponentModel.Win32Exception) { ids.Remove(id); }
                }
                browserIds = ids;
            }
            lastOwnershipRefresh = DateTime.UtcNow;
        }
        private void MonitorApp()
        {
            if (stopping || !initialized) return;
            try
            {
                if (job == null || job.ActiveProcesses == 0) { Fail("The local service stopped unexpectedly. Open logs for details, then close and reopen RHODA."); return; }
                if (DateTime.UtcNow >= nextExitPoll)
                {
                    nextExitPoll = DateTime.UtcNow.AddMilliseconds(250);
                    PollDesktopExitRequest();
                }
                if ((DateTime.UtcNow - lastOwnershipRefresh).TotalSeconds >= 2) RefreshBrowserOwnership();
                browserWindow = Native.FindAppWindow(browserIds);
                if (browserWindow != IntPtr.Zero)
                {
                    Native.GetWindowThreadProcessId(browserWindow, out browserPid);
                    windowMissingSince = DateTime.MinValue;
                    if (!hadWindow)
                    {
                        hadWindow = true; phase = "running"; openButton.Enabled = true; tray.Text = "RHODA — offline workspace";
                        progress.Style = ProgressBarStyle.Blocks; progress.Value = 100; status.Text = "RHODA is ready";
                        detail.Text = "Use the RHODA window. Its local service stops when you close that window, or choose Exit RHODA here.";
                        WriteStatus(); Hide(); Log("Application window detected; supervisor remains active.");
                    }
                }
                else if (hadWindow)
                {
                    if (windowMissingSince == DateTime.MinValue) windowMissingSince = DateTime.UtcNow;
                    if ((DateTime.UtcNow - windowMissingSince).TotalSeconds >= 1.5) BeginShutdown();
                }
                else if ((DateTime.UtcNow - browserStarted).TotalSeconds > 25)
                    Fail("Edge did not create a RHODA app window within 25 seconds. Open logs, then close and reopen RHODA. A private profile may be locked by a previous app instance.");
            }
            catch (Exception error) { Fail(error.Message); }
        }
        private void PollDesktopExitRequest()
        {
            if (token == null || Interlocked.CompareExchange(ref exitPollInFlight, 1, 0) != 0) return;
            Task.Run((Action)delegate
            {
                try
                {
                    var response = Request("/_desktop/exit-requested", "GET");
                    object requested;
                    if (response.TryGetValue("requested", out requested) && requested is bool && (bool)requested) Ui(BeginShutdown);
                }
                catch (Exception) { /* A transient poll failure must not close or fail the app. */ }
                finally { Interlocked.Exchange(ref exitPollInFlight, 0); }
            });
        }
        private void FocusApp()
        {
            if (browserWindow != IntPtr.Zero && Native.IsWindow(browserWindow))
            { Native.ShowWindow(browserWindow, 9); Native.SetForegroundWindow(browserWindow); }
            else { Show(); WindowState = FormWindowState.Normal; Activate(); }
        }
        private void OpenLogs()
        {
            try { Directory.CreateDirectory(config.LogDir); Process.Start(new ProcessStartInfo(config.LogDir) { UseShellExecute = true }); }
            catch (Exception error) { MessageBox.Show(this, error.Message, "RHODA logs", MessageBoxButtons.OK, MessageBoxIcon.Information); }
        }
        private void OpenDisplaySettings()
        {
            using (var dialog = new DisplaySettingsForm(config.DisplayMode))
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    config.SaveDisplayMode(dialog.SelectedMode);
                    MessageBox.Show(this, "Display mode saved. Restart RHODA to apply it.", "RHODA display settings", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                catch (Exception error) { MessageBox.Show(this, error.Message, "RHODA display settings", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            }
        }
        private void Fail(string message)
        {
            Log("Startup/runtime failure: " + message);
            Ui(delegate
            {
                if (stopping) return;
                monitor.Stop(); initialized = false; phase = "failed"; WriteStatus();
                FormBorderStyle = FormBorderStyle.None; ClientSize = new Size(420, 640);
                splashArtwork.Location = new Point(0, 0); splashArtwork.Size = ClientSize;
                title.Text = "RHODA"; status.Text = "RHODA needs attention"; detail.Text = message; progress.Style = ProgressBarStyle.Blocks; progress.Value = 0;
                openButton.Text = "Open RHODA";
                tray.Text = "RHODA — needs attention"; openButton.Enabled = false; Show(); Activate();
                Task.Run(delegate { StopOwnedProcesses(); });
            });
        }
        private void BeginShutdown()
        {
            if (stopping) return;
            stopping = true; cancel.Cancel(); monitor.Stop(); phase = "stopping";
            Hide();
            Log("Requested shutdown.");
            Task.Run(delegate
            {
                StopOwnedProcesses(); DeleteOwnStatus();
                Ui(delegate { allowClose = true; tray.Visible = false; Close(); });
            });
        }
        private void StopOwnedProcesses()
        {
            // Ask the service to stop while the RHODA window is already closing;
            // doing these sequentially made Exit wait through two separate grace periods.
            Task serviceShutdown = null;
            lock (processLock)
            {
                if (job != null && token != null && job.ActiveProcesses > 0)
                {
                    serviceShutdown = Task.Run((Action)delegate
                    {
                        try { Request("/_desktop/shutdown", "POST"); }
                        catch (Exception) { }
                    });
                }
            }

            // Close the cached app window immediately, then refresh the dedicated
            // Edge profile ownership list in parallel with the service shutdown.
            foreach (var window in Native.AppWindows(browserIds)) Native.PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
            var ownershipRefresh = Task.Run((Action)RefreshBrowserOwnership);
            var cleanupTasks = new List<Task>();
            if (serviceShutdown != null) cleanupTasks.Add(serviceShutdown);
            cleanupTasks.Add(ownershipRefresh);
            try { Task.WaitAll(cleanupTasks.ToArray(), 1200); }
            catch (AggregateException) { }

            foreach (var window in Native.AppWindows(browserIds)) Native.PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
            var browserDeadline = DateTime.UtcNow.AddSeconds(1);
            while (Native.FindAppWindow(browserIds) != IntPtr.Zero && DateTime.UtcNow < browserDeadline) Thread.Sleep(50);
            // Every PID is tied to this dedicated profile and its captured creation time.
            // A reused PID or a normal Edge profile is never terminated.
            lock (processLock)
            {
                if (job != null)
                {
                    // Give the graceful service request a short window, then the
                    // kill-on-close job handle safely cleans up any remaining child.
                    var serviceDeadline = DateTime.UtcNow.AddMilliseconds(500);
                    while (job.ActiveProcesses > 0 && DateTime.UtcNow < serviceDeadline) Thread.Sleep(50);
                    job.Dispose(); job = null;
                }
                if (server != null) { server.Dispose(); server = null; }
                foreach (var id in browserIds)
                    try
                    {
                        using (var process = Process.GetProcessById(id))
                        {
                            DateTime known;
                            if (!process.HasExited && browserIdentities.TryGetValue(id, out known) && process.StartTime.ToUniversalTime() == known) process.Kill();
                        }
                    }
                    catch (ArgumentException) { }
                    catch (InvalidOperationException) { }
                    catch (System.ComponentModel.Win32Exception) { }
                if (initialBrowser != null) { initialBrowser.Dispose(); initialBrowser = null; }
            }
            Log("Owned processes stopped.");
        }
        private string StatusPath { get { return Path.Combine(config.DataDir, "runtime-status.json"); } }
        private void WriteStatus()
        {
            try
            {
                Directory.CreateDirectory(config.DataDir);
                var json = new JavaScriptSerializer().Serialize(new { launcherPid = Process.GetCurrentProcess().Id, serverPid = serverPid, browserPid = browserPid,
                    port = config.Port, startedAt = startedAt.ToString("o"), mode = "mock", phase = phase });
                var temporary = StatusPath + "." + Process.GetCurrentProcess().Id + ".tmp";
                File.WriteAllText(temporary, json, new UTF8Encoding(false));
                if (File.Exists(StatusPath)) File.Replace(temporary, StatusPath, null); else File.Move(temporary, StatusPath);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        private void DeleteOwnStatus()
        {
            try
            {
                if (!File.Exists(StatusPath)) return;
                var statusValue = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(StatusPath));
                object pid;
                if (statusValue != null && statusValue.TryGetValue("launcherPid", out pid) && Convert.ToInt32(pid) == Process.GetCurrentProcess().Id) File.Delete(StatusPath);
            }
            catch (Exception) { }
        }
        private void Log(string message)
        {
            try
            {
                if (token != null) message = message.Replace(token, "[redacted]");
                lock (logLock)
                {
                    Directory.CreateDirectory(config.LogDir);
                    File.AppendAllText(Path.Combine(config.LogDir, "launcher.log"), DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine, new UTF8Encoding(false));
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                focusWait.Unregister(null); stopWait.Unregister(null); monitor.Dispose(); tray.Dispose(); cancel.Dispose();
                lock (processLock) { if (job != null) { job.Dispose(); job = null; } if (server != null) { server.Dispose(); server = null; } }
            }
            base.Dispose(disposing);
        }
    }

    internal sealed class OwnedJob : IDisposable
    {
        private IntPtr handle;
        public OwnedJob()
        {
            handle = Native.CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw Native.Error("Could not create the owned service job");
            var info = new Native.JobExtendedLimits(); info.BasicLimitInformation.LimitFlags = 0x2000;
            int size = Marshal.SizeOf(info); IntPtr memory = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(info, memory, false);
                if (!Native.SetInformationJobObject(handle, 9, memory, (uint)size)) throw Native.Error("Could not protect the local service lifecycle");
            }
            catch { Dispose(); throw; }
            finally { Marshal.FreeHGlobal(memory); }
        }
        public void Assign(IntPtr process) { if (!Native.AssignProcessToJobObject(handle, process)) throw Native.Error("Could not attach the suspended local service to its owned job"); }
        public bool Contains(int pid)
        {
            var process = Native.OpenProcess(0x1000, false, pid);
            if (process == IntPtr.Zero) return false;
            try { bool member; return Native.IsProcessInJob(process, handle, out member) && member; }
            finally { Native.CloseHandle(process); }
        }
        public uint ActiveProcesses
        {
            get
            {
                if (handle == IntPtr.Zero) return 0;
                Native.JobAccounting accounting;
                if (!Native.QueryInformationJobObject(handle, 1, out accounting, (uint)Marshal.SizeOf(typeof(Native.JobAccounting)), IntPtr.Zero)) throw Native.Error("Could not inspect the owned local service");
                return accounting.ActiveProcesses;
            }
        }
        public void Dispose() { var owned = Interlocked.Exchange(ref handle, IntPtr.Zero); if (owned != IntPtr.Zero) Native.CloseHandle(owned); }
    }

    internal static class Native
    {
        [StructLayout(LayoutKind.Sequential)] internal struct SecurityAttributes { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct StartupInfo { public int Size; public string Reserved, Desktop, Title; public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags; public short ShowWindow, ReservedSize; public IntPtr ReservedPointer, StdInput, StdOutput, StdError; }
        [StructLayout(LayoutKind.Sequential)] internal struct ProcessInformation { public IntPtr Process, Thread; public int ProcessId, ThreadId; }
        [StructLayout(LayoutKind.Sequential)] internal struct JobBasicLimits { public long PerProcessTimeLimit, PerJobTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
        [StructLayout(LayoutKind.Sequential)] internal struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] internal struct JobExtendedLimits { public JobBasicLimits BasicLimitInformation; public IoCounters IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
        [StructLayout(LayoutKind.Sequential)] internal struct JobAccounting { public long TotalUserTime, TotalKernelTime, ThisPeriodUserTime, ThisPeriodKernelTime; public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
        internal sealed class ChildProcess : IDisposable { public IntPtr Handle; public int Id; public void Dispose() { var owned = Interlocked.Exchange(ref Handle, IntPtr.Zero); if (owned != IntPtr.Zero) CloseHandle(owned); } }
        internal delegate bool WindowVisitor(IntPtr window, IntPtr parameter);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out JobAccounting info, uint length, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation process);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateFile(string name, uint access, uint share, ref SecurityAttributes attributes, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetFilePointerEx(IntPtr file, long distance, out long position, uint method);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandle(IntPtr file, StringBuilder path, uint length, uint flags);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CommandLineToArgvW(string command, out int count);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
        [DllImport("user32.dll")] private static extern bool EnumWindows(WindowVisitor visitor, IntPtr parameter);
        [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr window);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int length);
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out int processId);
        [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] internal static extern bool AllowSetForegroundWindow(int processId);
        [DllImport("user32.dll")] internal static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
        internal static Exception Error(string message) { return new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), message); }
        internal static string CanonicalDirectory(string directory)
        {
            if (!Directory.Exists(directory)) throw new InvalidOperationException("Configured directory does not exist: " + directory);
            var attributes = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), InheritHandle = false };
            var handle = CreateFile(directory, 0, 7, ref attributes, 3, 0x02000000, IntPtr.Zero);
            if (handle == new IntPtr(-1)) throw Error("Could not resolve the configured directory");
            try
            {
                var text = new StringBuilder(32768); var length = GetFinalPathNameByHandle(handle, text, (uint)text.Capacity, 0);
                if (length == 0 || length >= text.Capacity) throw Error("Could not resolve the configured directory");
                var resolved = text.ToString();
                if (resolved.StartsWith("\\\\?\\UNC\\", StringComparison.OrdinalIgnoreCase)) resolved = "\\\\" + resolved.Substring(8);
                else if (resolved.StartsWith("\\\\?\\", StringComparison.Ordinal)) resolved = resolved.Substring(4);
                return resolved.TrimEnd('\\');
            }
            finally { CloseHandle(handle); }
        }
        internal static string Quote(string argument)
        {
            var result = new StringBuilder("\""); int slashes = 0;
            foreach (char value in argument)
            {
                if (value == '\\') { slashes++; continue; }
                if (value == '"') { result.Append('\\', slashes * 2 + 1); result.Append(value); slashes = 0; continue; }
                result.Append('\\', slashes); slashes = 0; result.Append(value);
            }
            result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
        }
        internal static string EnvironmentBlock(Dictionary<string, string> overrides)
        {
            var values = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables()) values[Convert.ToString(entry.Key)] = Convert.ToString(entry.Value);
            foreach (var pair in overrides) values[pair.Key] = pair.Value;
            return String.Join("\0", values.Select(pair => pair.Key + "=" + pair.Value)) + "\0\0";
        }
        internal static ChildProcess StartSuspended(string executable, string[] arguments, string directory, string environment, string logFile, OwnedJob job)
        {
            var attributes = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), InheritHandle = true };
            var output = CreateFile(logFile, 0x40000000, 3, ref attributes, 4, 0x80, IntPtr.Zero);
            if (output == new IntPtr(-1)) throw Error("Could not open the local service log");
            IntPtr input = IntPtr.Zero, block = IntPtr.Zero; ProcessInformation info = new ProcessInformation();
            bool started = false;
            try
            {
                long position;
                if (!SetFilePointerEx(output, 0, out position, 2)) throw Error("Could not append to the local service log");
                input = CreateFile("NUL", 0x80000000, 3, ref attributes, 3, 0x80, IntPtr.Zero);
                if (input == new IntPtr(-1)) throw Error("Could not prepare the local service input");
                block = Marshal.StringToHGlobalUni(environment);
                var startup = new StartupInfo { Size = Marshal.SizeOf(typeof(StartupInfo)), Flags = 0x101, ShowWindow = 0, StdInput = input, StdOutput = output, StdError = output };
                var command = new StringBuilder(String.Join(" ", arguments.Select(Quote)));
                if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000404, block, directory, ref startup, out info)) throw Error("Could not start the project's Python environment");
                started = true;
                job.Assign(info.Process);
                if (ResumeThread(info.Thread) == UInt32.MaxValue) throw Error("Could not resume the owned local service");
                var child = new ChildProcess { Handle = info.Process, Id = info.ProcessId }; info.Process = IntPtr.Zero; return child;
            }
            catch { if (started && info.Process != IntPtr.Zero) TerminateProcess(info.Process, 1); throw; }
            finally
            {
                if (info.Thread != IntPtr.Zero) CloseHandle(info.Thread); if (info.Process != IntPtr.Zero) CloseHandle(info.Process);
                if (block != IntPtr.Zero) Marshal.FreeHGlobal(block); if (input != IntPtr.Zero && input != new IntPtr(-1)) CloseHandle(input); CloseHandle(output);
            }
        }
        internal static bool HasExactProfile(string command, string expected)
        {
            if (String.IsNullOrEmpty(command)) return false;
            int count; var memory = CommandLineToArgvW(command, out count); if (memory == IntPtr.Zero) return false;
            try
            {
                for (int i = 0; i < count; i++)
                {
                    var arg = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, i * IntPtr.Size)); string profile = null;
                    if (arg.StartsWith("--user-data-dir=", StringComparison.Ordinal)) profile = arg.Substring(16);
                    else if (arg == "--user-data-dir" && i + 1 < count) profile = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, ++i * IntPtr.Size));
                    if (profile != null)
                        try { return Path.GetFullPath(profile).TrimEnd('\\').Equals(Path.GetFullPath(expected).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase); }
                        catch (ArgumentException) { return false; }
                }
            }
            finally { LocalFree(memory); }
            return false;
        }
        internal static List<IntPtr> AppWindows(HashSet<int> ownedIds)
        {
            var windows = new List<IntPtr>();
            EnumWindows(delegate(IntPtr window, IntPtr parameter)
            {
                int pid; GetWindowThreadProcessId(window, out pid);
                if (!ownedIds.Contains(pid) || !IsWindowVisible(window)) return true;
                var name = new StringBuilder(256); GetClassName(window, name, name.Capacity);
                if (name.ToString() != "Chrome_WidgetWin_1") return true;
                var title = new StringBuilder(512); GetWindowText(window, title, title.Capacity);
                // The dedicated profile may also be showing a PDF or an official reference opened from the app.
                // Track its windows until they all close, rather than matching page titles.
                windows.Add(window);
                return true;
            }, IntPtr.Zero);
            return windows;
        }
        internal static IntPtr FindAppWindow(HashSet<int> ownedIds) { var windows = AppWindows(ownedIds); return windows.Count == 0 ? IntPtr.Zero : windows[0]; }
    }
}
