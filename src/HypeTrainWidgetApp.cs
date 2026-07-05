using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace HypeTrainWidgetApp
{
    internal static class AppInfo
    {
        public const string Version = "0.2.0";
        public const string ReleaseDate = "2026-07-05";
        public const string GitHubRepo = "Bittersweet1987/StreamerHypeTrain";
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            AppDomain.CurrentDomain.UnhandledException += delegate (object sender, UnhandledExceptionEventArgs e)
            {
                LogCrash(e.ExceptionObject as Exception);
            };
            Application.ThreadException += delegate (object sender, System.Threading.ThreadExceptionEventArgs e)
            {
                LogCrash(e.Exception);
            };
            try
            {
                if (TryApplyUpdate()) return;
                ServicePointManager.Expect100Continue = false;
                ServicePointManager.SecurityProtocol =
                    (SecurityProtocolType)3072 | // TLS 1.2 for Twitch Helix and OAuth APIs
                    (SecurityProtocolType)768 |
                    SecurityProtocolType.Tls;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
            catch (Exception ex)
            {
                LogCrash(ex);
            }
        }

        // Self-update relaunches the freshly extracted exe (running from the temp staging dir,
        // NOT the install dir) in this "--apply-update" mode. Because this updater instance does
        // NOT run out of the install dir's HypeTrainWidget.exe, it can overwrite that exe once the
        // old instance has exited - a running exe can never overwrite itself, which is exactly the
        // "file is in use" failure the old in-place relaunch hit. We copy the new files in, launch
        // the now-updated install-dir exe, and exit without ever showing a window or binding a port.
        private static bool TryApplyUpdate()
        {
            bool apply = false;
            int waitPid = 0;
            string installDir = null;
            string sourceDir = null;
            foreach (string arg in Environment.GetCommandLineArgs())
            {
                if (arg.Equals("--apply-update", StringComparison.OrdinalIgnoreCase)) apply = true;
                else if (arg.StartsWith("--wait-for-pid=", StringComparison.OrdinalIgnoreCase))
                {
                    int pid;
                    if (Int32.TryParse(arg.Substring("--wait-for-pid=".Length), out pid)) waitPid = pid;
                }
                else if (arg.StartsWith("--install-dir=", StringComparison.OrdinalIgnoreCase))
                    installDir = arg.Substring("--install-dir=".Length).Trim('"');
                else if (arg.StartsWith("--source-dir=", StringComparison.OrdinalIgnoreCase))
                    sourceDir = arg.Substring("--source-dir=".Length).Trim('"');
            }
            if (!apply || String.IsNullOrEmpty(installDir) || String.IsNullOrEmpty(sourceDir)) return false;

            try
            {
                if (waitPid != 0)
                {
                    try { Process.GetProcessById(waitPid).WaitForExit(15000); } catch { }
                }
                installDir = installDir.TrimEnd('\\');
                // The old instance's exe handle may linger briefly after exit; retry the copy so a
                // momentary lock on HypeTrainWidget.exe doesn't abort the whole update.
                Exception lastError = null;
                for (int attempt = 0; attempt < 20; attempt++)
                {
                    try { CopyDirectoryRecursive(sourceDir, installDir); lastError = null; break; }
                    catch (Exception ex) { lastError = ex; Thread.Sleep(500); }
                }
                if (lastError != null) throw lastError;

                Process.Start(new ProcessStartInfo
                {
                    FileName = Path.Combine(installDir, "HypeTrainWidget.exe"),
                    UseShellExecute = true,
                    WorkingDirectory = installDir
                });
            }
            catch (Exception ex)
            {
                LogCrash(ex);
            }
            return true;
        }

        private static void CopyDirectoryRecursive(string sourceDir, string destDir)
        {
            Directory.CreateDirectory(destDir);
            foreach (string file in Directory.GetFiles(sourceDir))
            {
                File.Copy(file, Path.Combine(destDir, Path.GetFileName(file)), true);
            }
            foreach (string dir in Directory.GetDirectories(sourceDir))
            {
                CopyDirectoryRecursive(dir, Path.Combine(destDir, Path.GetFileName(dir)));
            }
        }

        private static void LogCrash(Exception ex)
        {
            try
            {
                string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "crash.log");
                File.AppendAllText(path, DateTime.UtcNow.ToString("o") + " " + (ex == null ? "(unknown)" : ex.ToString()) + Environment.NewLine + Environment.NewLine, Encoding.UTF8);
            }
            catch
            {
            }
        }
    }

    public sealed class MainForm : Form
    {
        private readonly WebView2 adminView;
        private readonly HypeTrainServer server;
        private string adminUrl;
        private string overlayUrl;

        public MainForm()
        {
            Text = "Streamer Hype Train";
            MinimumSize = new Size(1180, 780);
            Size = new Size(1320, 900);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9F);
            BackColor = Color.FromArgb(245, 243, 248);
            // WinForms doesn't default the title bar/taskbar icon to the exe's own embedded icon
            // (set via /win32icon at compile time) - it has to be assigned explicitly here.
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            server = new HypeTrainServer(AppDomain.CurrentDomain.BaseDirectory);

            adminView = new WebView2();
            adminView.Dock = DockStyle.Fill;
            Controls.Add(adminView);

            Load += async delegate { await StartAppAsync(); };
            FormClosing += delegate { server.Stop(); };
        }

        private async Task StartAppAsync()
        {
            try
            {
                server.Stop();
                int port = server.Start(5378);
                adminUrl = "http://localhost:" + port + "/admin.html";
                overlayUrl = "http://localhost:" + port + "/overlay.html";
                await adminView.EnsureCoreWebView2Async(null);
                adminView.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
                adminView.CoreWebView2.Navigate(adminUrl);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Die App konnte die Verwaltung nicht laden.\n\n" + ex.Message,
                    "Streamer Hype Train",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        private void OnNewWindowRequested(object sender, Microsoft.Web.WebView2.Core.CoreWebView2NewWindowRequestedEventArgs e)
        {
            // Twitch's login page actively restricts embedded WebView popups (CAPTCHA loops,
            // "this might not be you" blocks). Hand the OAuth URL to the user's real browser instead,
            // where they are likely already logged in to Twitch.
            e.Handled = true;
            try
            {
                Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
            }
            catch
            {
            }
        }

    }

    public sealed class HypeTrainServer
    {
        private readonly string rootDir;
        private readonly string publicDir;
        private readonly string dataDir;
        private readonly string defaultsDir;
        private readonly JavaScriptSerializer json;
        private readonly List<SseClient> clients;
        private readonly object clientsLock;
        private readonly TwitchBridge twitchBridge;
        private readonly EventLog eventLog;
        private TcpListener listener;
        private bool running;
        private int port;

        public HypeTrainServer(string rootDir)
        {
            this.rootDir = rootDir;
            publicDir = Path.Combine(rootDir, "public");
            dataDir = Path.Combine(rootDir, "data");
            defaultsDir = Path.Combine(rootDir, "defaults");
            json = new JavaScriptSerializer();
            json.MaxJsonLength = Int32.MaxValue;
            clients = new List<SseClient>();
            clientsLock = new object();
            twitchBridge = new TwitchBridge(this);
            eventLog = new EventLog(Path.Combine(dataDir, "app-log.json"), json);
        }

        public void Log(string category, string level, string message)
        {
            eventLog.Add(category, level, message);
        }

        private void InstallUpdate(string downloadUrl)
        {
            string tempRoot = Path.Combine(Path.GetTempPath(), "StreamerHypeTrain-update-" + Guid.NewGuid().ToString("N"));
            string zipPath = tempRoot + ".zip";
            string stagingDir = tempRoot;
            Directory.CreateDirectory(stagingDir);

            using (var client = new WebClient())
            {
                client.Headers["User-Agent"] = "StreamerHypeTrain-Updater";
                client.DownloadFile(downloadUrl, zipPath);
            }

            ZipFile.ExtractToDirectory(zipPath, stagingDir);
            try { File.Delete(zipPath); } catch { }

            // Some release zips wrap their contents in a single top-level folder. If the exe
            // isn't directly in stagingDir, look one level down so the copy step below works
            // regardless of how the archive was packed.
            string exeSourceDir = stagingDir;
            if (!File.Exists(Path.Combine(stagingDir, "HypeTrainWidget.exe")))
            {
                foreach (string dir in Directory.GetDirectories(stagingDir))
                {
                    if (File.Exists(Path.Combine(dir, "HypeTrainWidget.exe")))
                    {
                        exeSourceDir = dir;
                        break;
                    }
                }
            }
            if (!File.Exists(Path.Combine(exeSourceDir, "HypeTrainWidget.exe")))
            {
                throw new InvalidOperationException("Im Release wurde keine HypeTrainWidget.exe gefunden.");
            }

            string installDir = rootDir.TrimEnd('\\');
            int currentPid = Process.GetCurrentProcess().Id;

            // Relaunch the freshly extracted exe FROM the staging dir (not the install dir) in
            // --apply-update mode. Running from staging is what lets it overwrite the install-dir
            // exe - a process can never overwrite the exe it is itself running from, which is the
            // "file is in use" error the previous in-place relaunch always hit. The updater waits
            // for this (old) instance to exit, copies the new files into installDir, then starts
            // the updated install-dir exe. Only that final instance shows a window and binds the
            // port; by then both earlier processes are gone, so there is no two-instance race.
            string updaterExe = Path.Combine(exeSourceDir, "HypeTrainWidget.exe");

            Log("update", "info", "Update wird installiert, App startet neu...");

            Process.Start(new ProcessStartInfo
            {
                FileName = updaterExe,
                Arguments = "--apply-update --wait-for-pid=" + currentPid
                    + " --install-dir=\"" + installDir + "\""
                    + " --source-dir=\"" + exeSourceDir + "\"",
                UseShellExecute = true,
                WorkingDirectory = exeSourceDir
            });

            Task.Run(delegate
            {
                Thread.Sleep(200);
                try { Stop(); } catch { }
                Environment.Exit(0);
            });
        }

        public int Start(int preferredPort)
        {
            EnsureDataFiles();
            // The event log is a live diagnostics view, not a persistent history - start every
            // app launch with an empty log.
            eventLog.Clear();
            // Defensive margin only - the actual self-update handover no longer relies on this.
            // A normal "the old window is still closing" moment could still want a brief retry.
            int attempts = 0;
            Exception lastError = null;
            while (attempts < 20)
            {
                try
                {
                    listener = new TcpListener(IPAddress.Loopback, preferredPort);
                    listener.Start();
                    port = preferredPort;
                    running = true;
                    Task.Factory.StartNew(AcceptLoop, TaskCreationOptions.LongRunning);
                    twitchBridge.Start();
                    return port;
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    attempts++;
                    Thread.Sleep(500);
                }
            }
            throw new InvalidOperationException("Port " + preferredPort + " ist belegt. Bitte die alte Hype-Train-App schließen und erneut starten.", lastError);
        }

        public void Stop()
        {
            running = false;
            try
            {
                if (listener != null) listener.Stop();
            }
            catch
            {
            }

            lock (clientsLock)
            {
                foreach (SseClient client in clients.ToArray())
                {
                    client.Close();
                }
                clients.Clear();
            }
            twitchBridge.Stop();
        }

        private void AcceptLoop()
        {
            while (running)
            {
                try
                {
                    TcpClient client = listener.AcceptTcpClient();
                    Task.Factory.StartNew(delegate { HandleClient(client); });
                }
                catch
                {
                    if (!running) return;
                }
            }
        }

        private void HandleClient(TcpClient client)
        {
            bool keepOpen = false;
            try
            {
                client.ReceiveTimeout = 10000;
                client.SendTimeout = 10000;
                NetworkStream stream = client.GetStream();
                HttpRequest request = ReadRequest(stream);
                if (request == null)
                {
                    return;
                }

                if (request.Path == "/api/events")
                {
                    AddSseClient(client, stream);
                    keepOpen = true;
                    return;
                }

                if (request.Path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
                {
                    HandleApi(request, stream);
                }
                else
                {
                    ServeStatic(request, stream);
                }
            }
            catch
            {
            }
            finally
            {
                if (!keepOpen)
                {
                    try { client.Close(); } catch { }
                }
            }
        }

        private HttpRequest ReadRequest(NetworkStream stream)
        {
            var bytes = new List<byte>();
            int value;
            while ((value = stream.ReadByte()) >= 0)
            {
                bytes.Add((byte)value);
                int count = bytes.Count;
                if (count >= 4 &&
                    bytes[count - 4] == 13 &&
                    bytes[count - 3] == 10 &&
                    bytes[count - 2] == 13 &&
                    bytes[count - 1] == 10)
                {
                    break;
                }
                if (bytes.Count > 65536) return null;
            }

            if (bytes.Count == 0) return null;

            string headerText = Encoding.ASCII.GetString(bytes.ToArray());
            string[] lines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
            if (lines.Length == 0) return null;

            string[] first = lines[0].Split(' ');
            if (first.Length < 2) return null;

            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 1; i < lines.Length; i++)
            {
                int colon = lines[i].IndexOf(':');
                if (colon > 0)
                {
                    headers[lines[i].Substring(0, colon).Trim()] = lines[i].Substring(colon + 1).Trim();
                }
            }

            int contentLength = 0;
            if (headers.ContainsKey("Content-Length"))
            {
                Int32.TryParse(headers["Content-Length"], out contentLength);
            }

            byte[] bodyBytes = new byte[contentLength];
            int offset = 0;
            while (offset < contentLength)
            {
                int read = stream.Read(bodyBytes, offset, contentLength - offset);
                if (read <= 0) break;
                offset += read;
            }

            string target = first[1];
            string path = target;
            int question = path.IndexOf('?');
            if (question >= 0) path = path.Substring(0, question);
            path = Uri.UnescapeDataString(path);

            return new HttpRequest
            {
                Method = first[0].ToUpperInvariant(),
                Path = path,
                Body = Encoding.UTF8.GetString(bodyBytes, 0, offset)
            };
        }

        private void HandleApi(HttpRequest request, NetworkStream stream)
        {
            if (request.Method == "GET" && request.Path == "/api/health")
            {
                SendJson(stream, 200, "{\"ok\":true,\"port\":" + port + "}");
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/version")
            {
                SendJson(stream, 200, json.Serialize(new Dictionary<string, object>
                {
                    { "ok", true },
                    { "version", AppInfo.Version },
                    { "releaseDate", AppInfo.ReleaseDate },
                    { "repo", AppInfo.GitHubRepo }
                }));
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/update/install")
            {
                try
                {
                    Dictionary<string, object> body = ParseObject(request.Body);
                    string downloadUrl = GetString(body, "downloadUrl", "");
                    if (String.IsNullOrWhiteSpace(downloadUrl)) throw new InvalidOperationException("Keine Download-URL angegeben.");
                    InstallUpdate(downloadUrl);
                    SendJson(stream, 200, "{\"ok\":true}");
                }
                catch (Exception ex)
                {
                    Log("update", "error", "Update-Installation fehlgeschlagen: " + ex.Message);
                    SendJson(stream, 400, json.Serialize(new Dictionary<string, object>
                    {
                        { "ok", false },
                        { "error", ex.Message }
                    }));
                }
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/logs")
            {
                SendJson(stream, 200, json.Serialize(new Dictionary<string, object>
                {
                    { "ok", true },
                    { "logs", eventLog.GetAll() }
                }));
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/logs")
            {
                Dictionary<string, object> body = ParseObject(request.Body);
                eventLog.Add(GetString(body, "category", "app"), GetString(body, "level", "info"), GetString(body, "message", ""));
                SendJson(stream, 200, "{\"ok\":true}");
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/logs/clear")
            {
                eventLog.Clear();
                SendJson(stream, 200, "{\"ok\":true}");
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/settings")
            {
                SendJson(stream, 200, json.Serialize(ReadSettingsObject()));
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/settings")
            {
                Dictionary<string, object> incoming = ParseObject(request.Body);
                WriteSettingsObject(incoming);
                string payload = json.Serialize(ReadSettingsObject());
                SendJson(stream, 200, "{\"ok\":true,\"settings\":" + payload + "}");
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/reset-settings")
            {
                File.Copy(DefaultSettingsPath(), SettingsPath(), true);
                string settingsPayload = json.Serialize(ReadSettingsObject());
                Broadcast("settings", "{\"reset\":true}");
                SendJson(stream, 200, "{\"ok\":true,\"settings\":" + settingsPayload + "}");
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/twitch/status")
            {
                SendJson(stream, 200, json.Serialize(new Dictionary<string, object>
                {
                    { "ok", true },
                    { "status", twitchBridge.Status() }
                }));
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/twitch/token")
            {
                try
                {
                    Dictionary<string, object> tokenResult = twitchBridge.SaveToken(request.Body);
                    SendJson(stream, 200, json.Serialize(new Dictionary<string, object>
                    {
                        { "ok", true },
                        { "status", tokenResult }
                    }));
                }
                catch (Exception ex)
                {
                    Log("twitch", "error", "Twitch-Verbindung fehlgeschlagen: " + ex.Message);
                    SendJson(stream, 400, json.Serialize(new Dictionary<string, object>
                    {
                        { "ok", false },
                        { "error", ex.Message }
                    }));
                }
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/twitch/disconnect")
            {
                twitchBridge.Disconnect();
                SendJson(stream, 200, "{\"ok\":true}");
                return;
            }

            if (request.Method == "GET" && request.Path == "/api/hype-train/status")
            {
                SendJson(stream, 200, json.Serialize(new Dictionary<string, object>
                {
                    { "ok", true },
                    { "status", twitchBridge.HypeTrainStatus() }
                }));
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/hype-train/simulate")
            {
                Dictionary<string, object> body = ParseObject(request.Body);
                int participants = GetInt(body, "participants", 8);
                twitchBridge.SimulateHypeTrain(participants);
                SendJson(stream, 200, "{\"ok\":true}");
                return;
            }

            if (request.Method == "POST" && request.Path == "/api/hype-train/complete")
            {
                twitchBridge.CompleteHypeTrain();
                SendJson(stream, 200, "{\"ok\":true}");
                return;
            }

            SendJson(stream, 404, "{\"ok\":false,\"error\":\"API route not found.\"}");
        }

        private void ServeStatic(HttpRequest request, NetworkStream stream)
        {
            string relative = request.Path == "/" ? "admin.html" : request.Path.TrimStart('/');
            relative = relative.Replace('/', Path.DirectorySeparatorChar);
            string full = Path.GetFullPath(Path.Combine(publicDir, relative));
            string publicFull = Path.GetFullPath(publicDir);

            if (!full.StartsWith(publicFull, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
            {
                SendText(stream, 404, "text/plain; charset=utf-8", "Not found", "no-store");
                return;
            }

            byte[] bytes = File.ReadAllBytes(full);
            string contentType = MimeType(Path.GetExtension(full));
            string ext = Path.GetExtension(full).ToLowerInvariant();
            string cache = (ext == ".html" || ext == ".js" || ext == ".css") ? "no-store" : "public, max-age=3600";
            SendBytes(stream, 200, contentType, bytes, cache);
        }

        private void AddSseClient(TcpClient tcpClient, NetworkStream stream)
        {
            string headers =
                "HTTP/1.1 200 OK\r\n" +
                "Content-Type: text/event-stream; charset=utf-8\r\n" +
                "Cache-Control: no-cache, no-transform\r\n" +
                "Connection: keep-alive\r\n" +
                "Access-Control-Allow-Origin: *\r\n\r\n";
            byte[] headerBytes = Encoding.UTF8.GetBytes(headers);
            stream.Write(headerBytes, 0, headerBytes.Length);

            var client = new SseClient(tcpClient, stream);
            lock (clientsLock)
            {
                clients.Add(client);
            }
            client.Write("event: ready\ndata: {\"ok\":true}\n\n");
        }

        internal void Broadcast(string eventName, string dataJson)
        {
            string payload = "event: " + eventName + "\n" + "data: " + dataJson + "\n\n";
            lock (clientsLock)
            {
                foreach (SseClient client in clients.ToArray())
                {
                    if (!client.Write(payload))
                    {
                        clients.Remove(client);
                        client.Close();
                    }
                }
            }
        }

        private void EnsureDataFiles()
        {
            Directory.CreateDirectory(dataDir);
            if (!Directory.Exists(publicDir))
            {
                throw new DirectoryNotFoundException("Der public-Ordner fehlt.");
            }
            if (!File.Exists(SettingsPath()))
            {
                File.Copy(DefaultSettingsPath(), SettingsPath(), true);
            }
            MigrateTwitchConfig();
            MigrateObsConfig();
        }

        // Twitch settings used to live inline inside settings.json in the sibling CardPackWidget
        // app. Here they always live in their own file (twitch.json) so that app updates - which
        // only ever replace public/+the exe, never data/ - can never clobber a connected account,
        // and so settings.json resets/imports can't accidentally wipe credentials either.
        private void MigrateTwitchConfig()
        {
            if (!File.Exists(SettingsPath())) return;
            Dictionary<string, object> settings = ParseObject(ReadFile(SettingsPath(), "{}"));
            bool changed = false;

            if (!File.Exists(TwitchConfigPath()) && settings.ContainsKey("twitch") && settings["twitch"] is Dictionary<string, object>)
            {
                File.WriteAllText(TwitchConfigPath(), json.Serialize(settings["twitch"]), Encoding.UTF8);
            }
            if (settings.Remove("twitch")) changed = true;

            if (changed) File.WriteAllText(SettingsPath(), json.Serialize(settings), Encoding.UTF8);
        }

        // Same reasoning as MigrateTwitchConfig: the OBS host/port/password live in their own
        // file (obs.json) so a settings.json reset/import never wipes the OBS password, and so
        // app updates (which only ever replace public/+the exe) can't touch it either.
        private void MigrateObsConfig()
        {
            if (!File.Exists(SettingsPath())) return;
            Dictionary<string, object> settings = ParseObject(ReadFile(SettingsPath(), "{}"));
            bool changed = false;

            if (!File.Exists(ObsConfigPath()) && settings.ContainsKey("obs") && settings["obs"] is Dictionary<string, object>)
            {
                File.WriteAllText(ObsConfigPath(), json.Serialize(settings["obs"]), Encoding.UTF8);
            }
            if (settings.Remove("obs")) changed = true;

            if (changed) File.WriteAllText(SettingsPath(), json.Serialize(settings), Encoding.UTF8);
        }

        private Dictionary<string, object> ParseObject(string text)
        {
            if (String.IsNullOrWhiteSpace(text)) return new Dictionary<string, object>();
            try
            {
                object parsed = json.DeserializeObject(text);
                if (parsed is Dictionary<string, object>) return (Dictionary<string, object>)parsed;
            }
            catch
            {
            }
            return new Dictionary<string, object>();
        }

        internal Dictionary<string, object> ReadSettingsObject()
        {
            Dictionary<string, object> settings = ParseObject(ReadFile(SettingsPath(), "{}"));
            settings["twitch"] = ParseObject(ReadFile(TwitchConfigPath(), "{}"));
            settings["obs"] = ParseObject(ReadFile(ObsConfigPath(), "{}"));
            return settings;
        }

        internal void WriteSettingsObject(Dictionary<string, object> settings)
        {
            WriteSettingsObject(settings, true);
        }

        internal void WriteSettingsObject(Dictionary<string, object> settings, bool preserveTwitchSecrets)
        {
            // Twitch lives in its own file (see MigrateTwitchConfig), so it is written separately
            // and kept out of settings.json entirely. preserveTwitchSecrets still applies to the
            // dedicated twitch.json write: a settings.json save (e.g. a fresh /api/settings POST
            // without a "twitch" key) must not blank out the saved token.
            if (settings.ContainsKey("twitch") && settings["twitch"] is Dictionary<string, object>)
            {
                Dictionary<string, object> twitch = (Dictionary<string, object>)settings["twitch"];
                if (preserveTwitchSecrets) PreserveTwitchSecrets(twitch, ParseObject(ReadFile(TwitchConfigPath(), "{}")));
                File.WriteAllText(TwitchConfigPath(), json.Serialize(twitch), Encoding.UTF8);
            }

            if (settings.ContainsKey("obs") && settings["obs"] is Dictionary<string, object>)
            {
                File.WriteAllText(ObsConfigPath(), json.Serialize((Dictionary<string, object>)settings["obs"]), Encoding.UTF8);
            }

            // Serialize settings.json from a shallow copy so the externalized section is kept out
            // of settings.json without mutating the caller's dict (callers may return it to the client).
            Dictionary<string, object> toStore = new Dictionary<string, object>(settings);
            toStore.Remove("twitch");
            toStore.Remove("obs");
            toStore["version"] = 1;
            toStore["updatedAt"] = DateTime.UtcNow.ToString("o");
            File.WriteAllText(SettingsPath(), json.Serialize(toStore), Encoding.UTF8);
            Broadcast("settings", "{\"updatedAt\":\"" + EscapeJson(DateTime.UtcNow.ToString("o")) + "\"}");
        }

        internal JavaScriptSerializer Serializer
        {
            get { return json; }
        }

        private static void PreserveTwitchSecrets(Dictionary<string, object> incomingTwitch, Dictionary<string, object> currentTwitch)
        {
            if (incomingTwitch == null || currentTwitch == null) return;
            string[] keys = { "accessToken", "login", "displayName", "broadcasterId", "expiresAt" };
            foreach (string key in keys)
            {
                if ((!incomingTwitch.ContainsKey(key) || incomingTwitch[key] == null || String.IsNullOrWhiteSpace(Convert.ToString(incomingTwitch[key]))) &&
                    currentTwitch.ContainsKey(key) &&
                    currentTwitch[key] != null &&
                    !String.IsNullOrWhiteSpace(Convert.ToString(currentTwitch[key])))
                {
                    incomingTwitch[key] = currentTwitch[key];
                }
            }
        }

        private static string GetString(Dictionary<string, object> data, string key, string fallback)
        {
            if (!data.ContainsKey(key) || data[key] == null) return fallback;
            return Convert.ToString(data[key]);
        }

        private static int GetInt(Dictionary<string, object> data, string key, int fallback)
        {
            if (!data.ContainsKey(key) || data[key] == null) return fallback;
            int value;
            return Int32.TryParse(Convert.ToString(data[key]), out value) ? value : fallback;
        }

        private static string EscapeJson(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static string ReadFile(string path, string fallback)
        {
            return File.Exists(path) ? File.ReadAllText(path, Encoding.UTF8) : fallback;
        }

        private string SettingsPath()
        {
            return Path.Combine(dataDir, "settings.json");
        }

        private string TwitchConfigPath()
        {
            return Path.Combine(dataDir, "twitch.json");
        }

        private string ObsConfigPath()
        {
            return Path.Combine(dataDir, "obs.json");
        }

        private string DefaultSettingsPath()
        {
            return Path.Combine(defaultsDir, "settings.json");
        }

        private void SendJson(NetworkStream stream, int status, string jsonText)
        {
            SendText(stream, status, "application/json; charset=utf-8", jsonText, "no-store");
        }

        private void SendText(NetworkStream stream, int status, string contentType, string text, string cacheControl)
        {
            SendBytes(stream, status, contentType, Encoding.UTF8.GetBytes(text), cacheControl);
        }

        private void SendBytes(NetworkStream stream, int status, string contentType, byte[] body, string cacheControl)
        {
            string statusText = StatusText(status);
            string headers =
                "HTTP/1.1 " + status + " " + statusText + "\r\n" +
                "Content-Type: " + contentType + "\r\n" +
                "Content-Length: " + body.Length + "\r\n" +
                "Cache-Control: " + cacheControl + "\r\n" +
                "Connection: close\r\n\r\n";
            byte[] headerBytes = Encoding.UTF8.GetBytes(headers);
            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(body, 0, body.Length);
        }

        private static string StatusText(int status)
        {
            if (status == 200) return "OK";
            if (status == 400) return "Bad Request";
            if (status == 404) return "Not Found";
            if (status == 500) return "Internal Server Error";
            return "OK";
        }

        private static string MimeType(string ext)
        {
            ext = ext.ToLowerInvariant();
            if (ext == ".html") return "text/html; charset=utf-8";
            if (ext == ".css") return "text/css; charset=utf-8";
            if (ext == ".js") return "text/javascript; charset=utf-8";
            if (ext == ".json") return "application/json; charset=utf-8";
            if (ext == ".svg") return "image/svg+xml";
            if (ext == ".png") return "image/png";
            if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
            if (ext == ".webp") return "image/webp";
            if (ext == ".ico") return "image/x-icon";
            if (ext == ".mp3") return "audio/mpeg";
            if (ext == ".wav") return "audio/wav";
            if (ext == ".ogg") return "audio/ogg";
            return "application/octet-stream";
        }
    }

    public sealed class TwitchBridge
    {
        private readonly HypeTrainServer server;
        private ClientWebSocket socket;
        private CancellationTokenSource cancel;
        private bool eventSubConnected;
        private string lastError;
        private readonly object stateLock = new object();

        // ---- Hype Train state machine ----
        // "idle" -> "waiting" (begin received, collecting chatters) -> "departing" (end received,
        // overlay plays the drive-off animation) -> "idle" again (overlay ack or safety timeout).
        private readonly object hypeLock = new object();
        private string hypeState = "idle";
        private int hypeLevel;
        private int hypeGoal;
        private int hypeProgress;
        private readonly HashSet<string> uniqueChatters = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, int> avatarAssignment = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, string> displayNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private readonly List<string> joinOrder = new List<string>();
        private System.Threading.Timer safetyTimer;
        private static readonly Random HypeRandom = new Random();

        private ClientWebSocket chatSocket;
        private CancellationTokenSource chatCancel;
        private bool chatEventSubConnected;
        private string chatLastError;
        private bool chatRunning;

        public TwitchBridge(HypeTrainServer server)
        {
            this.server = server;
        }

        public void Start()
        {
            Dictionary<string, object> twitch = TwitchSettings();
            if (!String.IsNullOrWhiteSpace(GetString(twitch, "accessToken", "")))
            {
                Stop();
                cancel = new CancellationTokenSource();
                Task.Factory.StartNew(delegate { EventSubLoop(cancel.Token); }, TaskCreationOptions.LongRunning);
                chatRunning = true;
                chatCancel = new CancellationTokenSource();
                Task.Factory.StartNew(delegate { ChatEventSubLoop(chatCancel.Token); }, TaskCreationOptions.LongRunning);
            }
        }

        public void Stop()
        {
            try
            {
                if (cancel != null) cancel.Cancel();
                if (socket != null) socket.Abort();
            }
            catch
            {
            }
            lock (stateLock)
            {
                eventSubConnected = false;
            }
            StopChat();
        }

        private void StopChat()
        {
            chatRunning = false;
            try
            {
                if (chatCancel != null) chatCancel.Cancel();
                if (chatSocket != null) chatSocket.Abort();
            }
            catch
            {
            }
            lock (stateLock)
            {
                chatEventSubConnected = false;
            }
        }

        public Dictionary<string, object> Status()
        {
            Dictionary<string, object> twitch = TwitchSettings();
            bool connected = !String.IsNullOrWhiteSpace(GetString(twitch, "accessToken", ""));
            lock (stateLock)
            {
                return new Dictionary<string, object>
                {
                    { "connected", connected },
                    { "eventSubConnected", eventSubConnected },
                    { "chatEventSubConnected", chatEventSubConnected },
                    { "clientId", GetString(twitch, "clientId", "") },
                    { "login", GetString(twitch, "login", "") },
                    { "displayName", GetString(twitch, "displayName", "") },
                    { "broadcasterId", GetString(twitch, "broadcasterId", "") },
                    { "expiresAt", GetString(twitch, "expiresAt", "") },
                    { "lastError", lastError ?? chatLastError ?? "" }
                };
            }
        }

        public Dictionary<string, object> SaveToken(string bodyJson)
        {
            Dictionary<string, object> body = ParseObject(bodyJson);
            string token = NormalizeAccessToken(GetString(body, "accessToken", ""));
            if (String.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("Twitch Access Token fehlt.");

            Dictionary<string, object> validation = TwitchGet("https://id.twitch.tv/oauth2/validate", "", token);
            string clientId = GetString(validation, "client_id", "");
            string login = GetString(validation, "login", "");
            string broadcasterId = GetString(validation, "user_id", "");
            if (String.IsNullOrWhiteSpace(clientId) || String.IsNullOrWhiteSpace(broadcasterId))
            {
                throw new InvalidOperationException("Twitch Token konnte nicht validiert werden.");
            }
            EnsureRequiredScopes(validation);

            Dictionary<string, object> settings = server.ReadSettingsObject();
            Dictionary<string, object> twitch = EnsureObject(settings, "twitch");
            twitch["clientId"] = clientId;
            twitch["accessToken"] = token;
            twitch["login"] = login;
            twitch["displayName"] = login;
            twitch["broadcasterId"] = broadcasterId;
            twitch["expiresAt"] = DateTime.UtcNow.AddSeconds(GetInt(validation, "expires_in", 0)).ToString("o");
            server.WriteSettingsObject(settings);
            Start();
            server.Log("twitch", "info", "Twitch verbunden als " + login + ".");
            return Status();
        }

        public void Disconnect()
        {
            Stop();
            server.Log("twitch", "info", "Twitch-Verbindung getrennt.");
            Dictionary<string, object> settings = server.ReadSettingsObject();
            Dictionary<string, object> twitch = EnsureObject(settings, "twitch");
            twitch.Remove("accessToken");
            twitch.Remove("login");
            twitch.Remove("displayName");
            twitch.Remove("broadcasterId");
            twitch.Remove("expiresAt");
            server.WriteSettingsObject(settings, false);
        }

        // ---- Hype Train EventSub (channel.hype_train.begin/progress/end) ----

        private void EventSubLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    lock (stateLock)
                    {
                        eventSubConnected = false;
                        lastError = "";
                    }
                    using (socket = new ClientWebSocket())
                    {
                        socket.ConnectAsync(new Uri("wss://eventsub.wss.twitch.tv/ws"), token).Wait(token);
                        ReadEventSubMessages(token).Wait(token);
                    }
                }
                catch (Exception ex)
                {
                    string message = ex.GetBaseException().Message;
                    lock (stateLock)
                    {
                        eventSubConnected = false;
                        lastError = message;
                    }
                    if (!token.IsCancellationRequested)
                    {
                        server.Log("twitch", "error", "EventSub-Verbindung verloren: " + message);
                        Thread.Sleep(5000);
                    }
                }
            }
        }

        private async Task ReadEventSubMessages(CancellationToken token)
        {
            byte[] buffer = new byte[32768];
            while (!token.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                var bytes = new List<byte>();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    for (int i = 0; i < result.Count; i++) bytes.Add(buffer[i]);
                } while (!result.EndOfMessage);

                string text = Encoding.UTF8.GetString(bytes.ToArray());
                HandleEventSubMessage(text);
            }
        }

        private void HandleEventSubMessage(string text)
        {
            Dictionary<string, object> message = ParseObject(text);
            Dictionary<string, object> metadata = Obj(message, "metadata");
            string type = GetString(metadata, "message_type", "");
            Dictionary<string, object> payload = Obj(message, "payload");

            if (type == "session_welcome")
            {
                string sessionId = GetString(Obj(payload, "session"), "id", "");
                try { CreateHypeTrainSubscriptions(sessionId); }
                catch (Exception ex) { server.Log("twitch", "error", "Hype-Train-Abonnement fehlgeschlagen: " + ex.Message); }
                lock (stateLock) eventSubConnected = true;
                server.Log("twitch", "info", "Hype-Train-EventSub verbunden.");
                return;
            }

            if (type != "notification") return;
            Dictionary<string, object> subscription = Obj(payload, "subscription");
            string subType = GetString(subscription, "type", "");
            Dictionary<string, object> ev = Obj(payload, "event");

            if (subType == "channel.hype_train.begin") { OnHypeTrainBegin(ev); return; }
            if (subType == "channel.hype_train.progress") { OnHypeTrainProgress(ev); return; }
            if (subType == "channel.hype_train.end") { OnHypeTrainEnd(ev); return; }
        }

        private void CreateHypeTrainSubscriptions(string sessionId)
        {
            Dictionary<string, object> twitch = RequireTwitch();
            string broadcasterId = GetString(twitch, "broadcasterId", "");
            string[] types = { "channel.hype_train.begin", "channel.hype_train.progress", "channel.hype_train.end" };
            foreach (string subType in types)
            {
                var body = new Dictionary<string, object>
                {
                    { "type", subType },
                    { "version", "1" },
                    { "condition", new Dictionary<string, object> { { "broadcaster_user_id", broadcasterId } } },
                    { "transport", new Dictionary<string, object> { { "method", "websocket" }, { "session_id", sessionId } } }
                };
                TwitchJson("POST", "https://api.twitch.tv/helix/eventsub/subscriptions", GetString(twitch, "clientId", ""), GetString(twitch, "accessToken", ""), body);
            }
        }

        private void OnHypeTrainBegin(Dictionary<string, object> ev)
        {
            // A new begin unconditionally resets state, even if we were mid-departure - Twitch
            // enforces its own hype-train cooldown, so a stray double-begin cannot happen in
            // practice and no extra guard is needed here.
            lock (hypeLock)
            {
                uniqueChatters.Clear();
                avatarAssignment.Clear();
                displayNames.Clear();
                joinOrder.Clear();
                hypeState = "waiting";
                hypeLevel = GetInt(ev, "level", 1);
                hypeGoal = GetInt(ev, "goal", 0);
                hypeProgress = GetInt(ev, "progress", 0);
                CancelSafetyTimer();
            }
            server.Log("hypetrain", "info", "Hype Train gestartet (Level " + hypeLevel + ").");
            server.Broadcast("hype-train-begin", server.Serializer.Serialize(new Dictionary<string, object>
            {
                { "level", hypeLevel },
                { "goal", hypeGoal },
                { "progress", hypeProgress },
                { "expiresAt", GetString(ev, "expires_at", "") }
            }));
        }

        private void OnHypeTrainProgress(Dictionary<string, object> ev)
        {
            lock (hypeLock)
            {
                if (hypeState != "waiting") return;
                hypeLevel = GetInt(ev, "level", hypeLevel);
                hypeGoal = GetInt(ev, "goal", hypeGoal);
                hypeProgress = GetInt(ev, "progress", hypeProgress);
            }
            server.Broadcast("hype-train-progress", server.Serializer.Serialize(new Dictionary<string, object>
            {
                { "level", hypeLevel },
                { "goal", hypeGoal },
                { "progress", hypeProgress }
            }));
        }

        private void OnHypeTrainEnd(Dictionary<string, object> ev)
        {
            object[] participants;
            int level;
            lock (hypeLock)
            {
                hypeState = "departing";
                level = hypeLevel;
                var list = new List<object>();
                foreach (string login in joinOrder)
                {
                    int avatarIndex;
                    avatarAssignment.TryGetValue(login, out avatarIndex);
                    string display;
                    if (!displayNames.TryGetValue(login, out display)) display = login;
                    list.Add(new Dictionary<string, object>
                    {
                        { "login", login },
                        { "displayName", display },
                        { "avatarIndex", avatarIndex }
                    });
                }
                participants = list.ToArray();
                StartSafetyTimer();
            }
            server.Log("hypetrain", "info", "Hype Train beendet (Level " + level + ", " + participants.Length + " Teilnehmer).");
            server.Broadcast("hype-train-end", server.Serializer.Serialize(new Dictionary<string, object>
            {
                { "level", level },
                { "participants", participants }
            }));
        }

        // Safety net: if the overlay is not open or never acks, force the state back to idle so
        // the next real hype train isn't blocked by stale "departing" state forever.
        private void StartSafetyTimer()
        {
            CancelSafetyTimer();
            safetyTimer = new System.Threading.Timer(delegate { CompleteHypeTrain(); }, null, 60000, Timeout.Infinite);
        }

        private void CancelSafetyTimer()
        {
            if (safetyTimer != null)
            {
                try { safetyTimer.Dispose(); } catch { }
                safetyTimer = null;
            }
        }

        public void CompleteHypeTrain()
        {
            lock (hypeLock)
            {
                hypeState = "idle";
                uniqueChatters.Clear();
                avatarAssignment.Clear();
                displayNames.Clear();
                joinOrder.Clear();
                CancelSafetyTimer();
            }
        }

        public Dictionary<string, object> HypeTrainStatus()
        {
            lock (hypeLock)
            {
                return new Dictionary<string, object>
                {
                    { "state", hypeState },
                    { "level", hypeLevel },
                    { "goal", hypeGoal },
                    { "progress", hypeProgress },
                    { "participantCount", joinOrder.Count }
                };
            }
        }

        // Test helper: runs the exact same state machine/Broadcast path a real hype train would,
        // so the overlay animation can be exercised from the admin UI without Twitch.
        public void SimulateHypeTrain(int participantCount)
        {
            if (participantCount < 0) participantCount = 0;
            OnHypeTrainBegin(new Dictionary<string, object> { { "level", 1 }, { "goal", 100 }, { "progress", 0 } });

            int avatarCount = Math.Max(1, AvatarCount());
            for (int i = 0; i < participantCount; i++)
            {
                string login = "viewer" + i;
                lock (hypeLock)
                {
                    if (uniqueChatters.Add(login))
                    {
                        int avatarIndex;
                        lock (HypeRandom) avatarIndex = HypeRandom.Next(avatarCount);
                        avatarAssignment[login] = avatarIndex;
                        displayNames[login] = "Viewer" + i;
                        joinOrder.Add(login);
                    }
                }
            }

            Task.Run(delegate
            {
                Thread.Sleep(2000);
                OnHypeTrainEnd(new Dictionary<string, object>());
            });
        }

        private int AvatarCount()
        {
            Dictionary<string, object> settings = server.ReadSettingsObject();
            Dictionary<string, object> hypeTrain = Obj(settings, "hypeTrain");
            object avatarsObj;
            if (hypeTrain.TryGetValue("avatars", out avatarsObj) && avatarsObj is object[])
            {
                return ((object[])avatarsObj).Length;
            }
            return 0;
        }

        // ---- Chat: read-only, EventSub channel.chat.message. Only used to dedupe unique
        // chatters during an active hype train - no command parsing, no sending. ----

        private void ChatEventSubLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    lock (stateLock)
                    {
                        chatEventSubConnected = false;
                        chatLastError = "";
                    }
                    using (chatSocket = new ClientWebSocket())
                    {
                        chatSocket.ConnectAsync(new Uri("wss://eventsub.wss.twitch.tv/ws"), token).Wait(token);
                        ReadChatEventSubMessages(token).Wait(token);
                    }
                }
                catch (Exception ex)
                {
                    string message = ex.GetBaseException().Message;
                    lock (stateLock)
                    {
                        chatEventSubConnected = false;
                        chatLastError = message;
                    }
                    if (!token.IsCancellationRequested)
                    {
                        server.Log("twitch", "error", "Chat-Verbindung verloren: " + message);
                        Thread.Sleep(5000);
                    }
                }
            }
        }

        private async Task ReadChatEventSubMessages(CancellationToken token)
        {
            byte[] buffer = new byte[32768];
            while (!token.IsCancellationRequested && chatSocket.State == WebSocketState.Open)
            {
                var bytes = new List<byte>();
                WebSocketReceiveResult result;
                do
                {
                    result = await chatSocket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    for (int i = 0; i < result.Count; i++) bytes.Add(buffer[i]);
                } while (!result.EndOfMessage);

                string text = Encoding.UTF8.GetString(bytes.ToArray());
                HandleChatEventSubMessage(text);
            }
        }

        private void HandleChatEventSubMessage(string text)
        {
            Dictionary<string, object> message = ParseObject(text);
            Dictionary<string, object> metadata = Obj(message, "metadata");
            string type = GetString(metadata, "message_type", "");
            Dictionary<string, object> payload = Obj(message, "payload");

            if (type == "session_welcome")
            {
                string sessionId = GetString(Obj(payload, "session"), "id", "");
                try { CreateChatEventSubSubscription(sessionId); }
                catch (Exception ex) { server.Log("twitch", "error", "Chat-Abonnement fehlgeschlagen: " + ex.Message); }
                lock (stateLock) chatEventSubConnected = true;
                server.Log("twitch", "info", "Chat-Verbindung aufgebaut.");
                return;
            }

            if (type != "notification") return;
            Dictionary<string, object> subscription = Obj(payload, "subscription");
            if (GetString(subscription, "type", "") != "channel.chat.message") return;
            Dictionary<string, object> ev = Obj(payload, "event");
            string login = GetString(ev, "chatter_user_login", "");
            string displayName = GetString(ev, "chatter_user_name", login);
            if (String.IsNullOrWhiteSpace(login)) return;
            OnChatMessage(login, displayName);
        }

        private void CreateChatEventSubSubscription(string sessionId)
        {
            Dictionary<string, object> twitch = RequireTwitch();
            string broadcasterId = GetString(twitch, "broadcasterId", "");
            var body = new Dictionary<string, object>
            {
                { "type", "channel.chat.message" },
                { "version", "1" },
                { "condition", new Dictionary<string, object> { { "broadcaster_user_id", broadcasterId }, { "user_id", broadcasterId } } },
                { "transport", new Dictionary<string, object> { { "method", "websocket" }, { "session_id", sessionId } } }
            };
            TwitchJson("POST", "https://api.twitch.tv/helix/eventsub/subscriptions", GetString(twitch, "clientId", ""), GetString(twitch, "accessToken", ""), body);
        }

        private void OnChatMessage(string login, string displayName)
        {
            lock (hypeLock)
            {
                if (hypeState != "waiting") return;
                if (!uniqueChatters.Add(login)) return;
                int avatarCount = Math.Max(1, AvatarCount());
                int avatarIndex;
                lock (HypeRandom) avatarIndex = HypeRandom.Next(avatarCount);
                avatarAssignment[login] = avatarIndex;
                displayNames[login] = displayName;
                joinOrder.Add(login);
            }
        }

        // ---- Twitch API/OAuth plumbing ----

        private Dictionary<string, object> RequireTwitch()
        {
            Dictionary<string, object> twitch = TwitchSettings();
            if (String.IsNullOrWhiteSpace(GetString(twitch, "clientId", "")) ||
                String.IsNullOrWhiteSpace(GetString(twitch, "accessToken", "")) ||
                String.IsNullOrWhiteSpace(GetString(twitch, "broadcasterId", "")))
            {
                throw new InvalidOperationException("Bitte zuerst Twitch verbinden.");
            }
            return twitch;
        }

        private Dictionary<string, object> TwitchSettings()
        {
            return EnsureObject(server.ReadSettingsObject(), "twitch");
        }

        private Dictionary<string, object> TwitchGet(string url, string clientId, string token)
        {
            using (var client = new WebClient())
            {
                client.Encoding = Encoding.UTF8;
                if (!String.IsNullOrWhiteSpace(clientId)) client.Headers["Client-Id"] = clientId;
                if (!String.IsNullOrWhiteSpace(token)) client.Headers[HttpRequestHeader.Authorization] = "Bearer " + token;
                try
                {
                    string response = client.DownloadString(url);
                    return ParseObject(response);
                }
                catch (WebException ex)
                {
                    throw new InvalidOperationException(DescribeTwitchError(ex), ex);
                }
            }
        }

        private Dictionary<string, object> TwitchJson(string method, string url, string clientId, string token, Dictionary<string, object> payload)
        {
            string response = TwitchRaw(method, url, clientId, token, server.Serializer.Serialize(payload));
            return ParseObject(response);
        }

        private string TwitchRaw(string method, string url, string clientId, string token, string payload)
        {
            using (var client = new WebClient())
            {
                client.Encoding = Encoding.UTF8;
                client.Headers["Client-Id"] = clientId;
                client.Headers[HttpRequestHeader.Authorization] = "Bearer " + token;
                try
                {
                    if (payload != null)
                    {
                        client.Headers[HttpRequestHeader.ContentType] = "application/json";
                        return client.UploadString(url, method, payload);
                    }
                    return client.UploadString(url, method, "");
                }
                catch (WebException ex)
                {
                    throw new InvalidOperationException(DescribeTwitchError(ex), ex);
                }
            }
        }

        private string DescribeTwitchError(WebException ex)
        {
            string body = "";
            if (ex.Response != null)
            {
                using (var reader = new StreamReader(ex.Response.GetResponseStream(), Encoding.UTF8))
                {
                    body = reader.ReadToEnd();
                }
            }
            if (String.IsNullOrWhiteSpace(body)) return "Twitch API Fehler: " + ex.Message;
            Dictionary<string, object> parsed = ParseObject(body);
            string message = GetString(parsed, "message", "");
            return String.IsNullOrWhiteSpace(message)
                ? "Twitch API Fehler: " + body
                : "Twitch API Fehler: " + message;
        }

        private static Dictionary<string, object> EnsureObject(Dictionary<string, object> parent, string key)
        {
            if (!parent.ContainsKey(key) || !(parent[key] is Dictionary<string, object>))
            {
                parent[key] = new Dictionary<string, object>();
            }
            return (Dictionary<string, object>)parent[key];
        }

        private static Dictionary<string, object> Obj(Dictionary<string, object> parent, string key)
        {
            return parent.ContainsKey(key) && parent[key] is Dictionary<string, object>
                ? (Dictionary<string, object>)parent[key]
                : new Dictionary<string, object>();
        }

        private Dictionary<string, object> ParseObject(string text)
        {
            if (String.IsNullOrWhiteSpace(text)) return new Dictionary<string, object>();
            try
            {
                object parsed = server.Serializer.DeserializeObject(text);
                if (parsed is Dictionary<string, object>) return (Dictionary<string, object>)parsed;
            }
            catch
            {
            }
            return new Dictionary<string, object>();
        }

        private static string GetString(Dictionary<string, object> data, string key, string fallback)
        {
            if (!data.ContainsKey(key) || data[key] == null) return fallback;
            return Convert.ToString(data[key]);
        }

        private static int GetInt(Dictionary<string, object> data, string key, int fallback)
        {
            if (!data.ContainsKey(key) || data[key] == null) return fallback;
            int value;
            return Int32.TryParse(Convert.ToString(data[key]), out value) ? value : fallback;
        }

        private static string NormalizeAccessToken(string value)
        {
            if (String.IsNullOrWhiteSpace(value)) return "";
            string token = value.Trim().Trim('"', '\'');

            int accessTokenIndex = token.IndexOf("access_token=", StringComparison.OrdinalIgnoreCase);
            if (accessTokenIndex >= 0)
            {
                token = token.Substring(accessTokenIndex + "access_token=".Length);
                int end = token.IndexOfAny(new[] { '&', '#', ' ' });
                if (end >= 0) token = token.Substring(0, end);
                token = Uri.UnescapeDataString(token);
            }

            if (token.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                token = token.Substring("Bearer ".Length).Trim();
            }
            if (token.StartsWith("OAuth ", StringComparison.OrdinalIgnoreCase))
            {
                token = token.Substring("OAuth ".Length).Trim();
            }
            if (token.StartsWith("oauth:", StringComparison.OrdinalIgnoreCase))
            {
                token = token.Substring("oauth:".Length).Trim();
            }
            return token.Trim();
        }

        // Required scopes for this app: channel:read:hype_train (hype train events) and
        // user:read:chat (reading chat to dedupe unique chatters). Unlike the sibling
        // CardPackWidget app, we never send chat messages, so user:write:chat is not needed -
        // one broadcaster token with these two read scopes covers everything.
        private static void EnsureRequiredScopes(Dictionary<string, object> validation)
        {
            var scopes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            object scopesObj;
            if (validation.TryGetValue("scopes", out scopesObj) && scopesObj is object[])
            {
                foreach (object scope in (object[])scopesObj)
                {
                    scopes.Add(Convert.ToString(scope));
                }
            }

            var missing = new List<string>();
            if (!scopes.Contains("channel:read:hype_train")) missing.Add("channel:read:hype_train");
            if (!scopes.Contains("user:read:chat")) missing.Add("user:read:chat");
            if (missing.Count > 0)
            {
                throw new InvalidOperationException(
                    "Token ist gueltig, aber es fehlen Scopes: " +
                    String.Join(", ", missing.ToArray()) +
                    ". Bitte einen Token mit diesen Rechten generieren.");
            }
        }
    }

    public sealed class EventLog
    {
        private const int MaxEntries = 1000;
        private readonly string path;
        private readonly JavaScriptSerializer json;
        private readonly object entriesLock = new object();
        private List<Dictionary<string, object>> entries = new List<Dictionary<string, object>>();

        public EventLog(string path, JavaScriptSerializer json)
        {
            this.path = path;
            this.json = json;
            Load();
        }

        private void Load()
        {
            try
            {
                if (!File.Exists(path)) return;
                object parsed = json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8));
                if (parsed is object[])
                {
                    var loaded = new List<Dictionary<string, object>>();
                    foreach (object item in (object[])parsed)
                    {
                        if (item is Dictionary<string, object>) loaded.Add((Dictionary<string, object>)item);
                    }
                    lock (entriesLock) entries = loaded;
                }
            }
            catch
            {
            }
        }

        public void Add(string category, string level, string message)
        {
            var entry = new Dictionary<string, object>
            {
                { "timestamp", DateTime.UtcNow.ToString("o") },
                { "category", category },
                { "level", level },
                { "message", message }
            };
            lock (entriesLock)
            {
                entries.Add(entry);
                while (entries.Count > MaxEntries) entries.RemoveAt(0);
                Persist();
            }
        }

        public object[] GetAll()
        {
            lock (entriesLock) return entries.ToArray();
        }

        public void Clear()
        {
            lock (entriesLock)
            {
                entries.Clear();
                Persist();
            }
        }

        private void Persist()
        {
            try
            {
                File.WriteAllText(path, json.Serialize(entries), Encoding.UTF8);
            }
            catch
            {
            }
        }
    }

    public sealed class SseClient
    {
        private readonly TcpClient client;
        private readonly NetworkStream stream;
        private readonly object writeLock;

        public SseClient(TcpClient client, NetworkStream stream)
        {
            this.client = client;
            this.stream = stream;
            writeLock = new object();
        }

        public bool Write(string text)
        {
            try
            {
                byte[] bytes = Encoding.UTF8.GetBytes(text);
                lock (writeLock)
                {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush();
                }
                return true;
            }
            catch
            {
                return false;
            }
        }

        public void Close()
        {
            try { client.Close(); } catch { }
        }
    }

    public sealed class HttpRequest
    {
        public string Method;
        public string Path;
        public string Body;
    }
}
