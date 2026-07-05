# CLAUDE.md — Streamer Hype Train

Diese Datei ist die Projekt-Landkarte für Claude. Sie soll unnötige Exploration sparen: erst
hier nachsehen, dann gezielt greifen. Bei strukturellen Änderungen bitte aktuell halten.

## Was das ist
Lokale Windows-App (C# WinForms + WebView2) für einen Twitch-Hype-Train-Zug als OBS-Overlay. Ein
**einzelner** C#-Server (`src/HypeTrainWidgetApp.cs`) serviert `public/` per handgeschriebenem
HTTP über TCP und pusht Live-Events per **SSE** (`Broadcast(event, jsonData)`). Kein Framework,
kein `.csproj`. Das Overlay läuft als OBS-Browserquelle; die Verwaltung ist eine WebView2-Admin-
Seite. Läuft auf **Port 5378** (CardPackWidget/StreamerCardWidget nutzt 5377 — beide Apps müssen
gleichzeitig in OBS laufen können, daher unterschiedliche Ports).

## Build (kein Projektfile — direkt mit csc.exe)
```
"C:\WINDOWS\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe
  /win32icon:"src\app.ico"
  /out:"<ziel>\HypeTrainWidget.exe"
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll
  /r:System.Web.Extensions.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll
  /r:"<ziel>\Microsoft.Web.WebView2.Core.dll"
  /r:"<ziel>\Microsoft.Web.WebView2.WinForms.dll"
  src\HypeTrainWidgetApp.cs
```
C# = **C# 5** (alter Compiler): kein `?.`, kein `$"..."`, kein Ausdruckskörper-Member; Dictionary-
Zugriff mit `TryGetValue`/`ContainsKey`. Kompiliert die App läuft → EXE ist **gesperrt**; dann nur
die anderen Instanzen bauen und diese EXE überspringen (User schließt die App).

## Standorte
- **Repo-Root (`C:\Users\marco\Documents\StreamerHypeTrain\`)** ist gleichzeitig Quelle UND die
  **lauffähige Release-App**: `src/`, `public/`, `defaults/`, `tests/` sind versioniert; direkt im
  Root liegen zusätzlich (gitignored) `HypeTrainWidget.exe`, die drei WebView2-DLLs und zur
  Laufzeit `data/`. So ist der Root-Ordner genau das, was auch im Release-ZIP landet.
- `HypeTrainWidget-DevApp/` und `HypeTrainWidget-TestApp/` — zwei zusätzliche, komplett
  gitignorede lokale Instanzen (eigene EXE + `public/` + `data/` + DLLs) nur fürs Entwickeln/
  Testen (z. B. Self-Update-Mechanismus durchspielen), **nicht** Teil des Release.

## Deploy-Checkliste für JEDE Änderung
1. C# geändert? → EXE(s) neu bauen: mindestens Repo-Root, ggf. zusätzlich
   `HypeTrainWidget-DevApp\` / `HypeTrainWidget-TestApp\` falls dort gerade getestet wird.
2. `public/` in die lokalen Test-Instanzen spiegeln (Root braucht das nicht, `public/` ist dort
   schon die Quelle selbst):
   `robocopy "public" "HypeTrainWidget-DevApp\public" /MIR /NFL /NDL /NJH /NJS /NP` (Exit 1 = OK,
   nicht Fehler) und dasselbe für `HypeTrainWidget-TestApp\public`.
3. JS/CSS/HTML geändert? → **Cache-Buster** hochzählen: das `?v=…` in `admin.html`
   (admin.js+admin.css) und `overlay.html` (overlay.js+overlay.css). OBS/WebView cachen sonst
   alte Dateien.
4. Verifizieren: `cd tests && npm test` (jsdom-Suiten: Admin-Init/OBS-Auto-Connect,
   Overlay-DOM/Animation, CSS-Invarianten, Namens-Schriftgrößen-Fit).
   Beim ersten Mal vorher `npm install` in `tests/`. Zusätzlich fängt
   `node public/assets/js/admin.js` echte ESM-Fehler (`node --check` ist zu nachsichtig).
5. Commit **nur mit `-F <datei>`** (siehe Gotchas), auf `main` pushen — nur wenn der User es will.

## Release-Workflow
- Version + `ReleaseDate` in `src/HypeTrainWidgetApp.cs` (ganz oben) setzen; `GitHubRepo` =
  `Bittersweet1987/StreamerHypeTrain`.
- ZIP direkt aus dem **Repo-Root** packen (`src/`, `public/`, `defaults/`, `HypeTrainWidget.exe`,
  die drei WebView2-DLLs, LICENSE, README — **ohne** `data/`, `.git/`, `tests/`, `CLAUDE.md`
  (interne Projekt-Landkarte, nicht für Endnutzer), `HypeTrainWidget-DevApp/`,
  `HypeTrainWidget-TestApp/`, `HypeTrainWidget.exe.WebView2/` (lokaler Browser-Cache, entsteht
  beim Ausführen — **niemals** mit ins ZIP, enthält u. a. Cookies/History), unbenutzte
  Roh-Bilder unter `public/assets/img/` außer `logo.png`), mit **Forward-Slash**-Einträgen
  (WebView/Update-Installer erwartet das). Standard-Skript: PowerShell
  `System.IO.Compression.ZipArchive`, jeden Entry mit `.Replace('\\','/')` anlegen.
- `gh release create vX.Y.Z <zip> --title … --notes-file … --target main`.
- Der In-App-Updater (`InstallUpdate`) lädt das `.zip`-Asset des neuesten Releases, entpackt es
  und kopiert ALLES rekursiv über das Install-Verzeichnis → deshalb kein `data/` im ZIP.
- `defaults/settings.json` enthält bereits eine fertige Zug-/Avatar-Grafik als Basis (Lok/Waggon/
  Endwagen + 17 Avatare, Base64) — ein frischer Install sieht damit sofort brauchbar aus; der
  Nutzer kann das über die Hypetrain-Admin-Seite jederzeit ersetzen.

## Code-Landkarte
### Backend — `src/HypeTrainWidgetApp.cs` (eine Datei)
- `class MainForm` / Startup / `--apply-update`-Selbstupdate ganz oben (Muster 1:1 aus dem
  Schwester-Projekt StreamerCardWidget übernommen).
- `class HypeTrainServer` — HTTP: `HandleApi(...)` (if-Baum für `/api/...`), `ServeStatic` (setzt
  `Cache-Control: no-store` für .html/.js/.css), `ReadSettingsObject`/`WriteSettingsObject`,
  `Broadcast`, SSE-`clients`.
- `class TwitchBridge` — **ein** EventSub-Socket (kein separater Bot-Account nötig): abonniert
  `channel.hype_train.begin/progress/end` (Scope `channel:read:hype_train`) UND
  `channel.chat.message` (Scope `user:read:chat`) auf demselben Broadcaster-Token/Session. State:
  `idle` → `waiting` (Hype Train läuft, Chat wird auf einzigartige Chatter geprüft) → `departing`
  (Zug fährt raus) → zurück zu `idle` nach Overlay-Ack oder 60s-Sicherheits-Timeout.
  `uniqueChatters`/`avatarAssignment`/`joinOrder` werden bei jedem `begin` zurückgesetzt.
- `class EventLog` — Ereignis-Log (`data/app-log.json`), wird bei jedem Start geleert.
- Secrets liegen getrennt in `data/twitch.json` und `data/obs.json` (werden bei
  `ReadSettingsObject` reingemerged, bei `WriteSettingsObject` wieder rausgesplittet). `twitch`
  wird im Frontend beim Speichern immer gestrippt (eigener Connect/Disconnect-Flow); `obs` läuft
  normal durch den Settings-Save mit.
- **OBS-Verbindung ist reines Frontend**: `admin.js` spricht direkt per Browser-`WebSocket` mit
  obs-websocket v5 (Hello/Identify/Request/Response über `op`-Codes, SHA-256-Challenge-Response-
  Auth), legt Szene + Browser-Quelle (`overlay.html`) an und synct Host/Port/Passwort/Namen über
  `settings.obs`. Kein C#-Code dafür nötig.

### Frontend — `public/`
- `admin.html` + `assets/js/admin.js` — die Verwaltung. Tabs: Übersicht, Verbindung (Twitch +
  OBS), Hypetrain (Bild-Uploads Lokomotive/Endwagen/Waggon, Avatar-Grid mit Mehrfach-Upload,
  3 Sound-Slots, Testlauf-Button), Log, Update. Muster: `I18N`-Objekt (de/en) + `t(key)` +
  `data-i18n`; `bindTabs` für die Navigation. Topbar mit dem Speichern-Button ist `position:
  sticky`. **Achtung**: `data-i18n` niemals auf ein Element setzen, das selbst Kind-Elemente
  (z. B. ein `<input>`) enthält — `applyI18n()` setzt `textContent` und würde sie löschen; Text
  in ein eigenes `<span data-i18n="…">` packen.
- `assets/js/api.js` — geteilt (Overlay + Admin): `connectEventStream` (SSE-Wrapper),
  `getSettings`/`saveSettings`, `readFileAsDataUrl`, `trimImageToDataUrl` (schneidet nur
  transparente Ränder weg, behält native Auflösung — für Lok/Waggon/Endwagen, damit der
  gemeinsame Maßstab zwischen den Teilen erhalten bleibt), `trimAvatarToDataUrl` (dito, plus
  Normierung auf eine feste Höhe).
- `overlay.html`/`overlay.js` — Zug-Animation, alles im **unteren Viertel** der 1080p-Canvas,
  Gleise über die volle Breite. Ablauf: `hype-train-begin` → nur die Lokomotive erscheint rechts
  (Dampfwolke aus dem Lok-Bild selbst pulsiert per `.loco-steam`-Crop, Warte-Sound-Loop). Alle
  Bilder (inkl. aller Avatare) werden dabei schon vorgeladen+dekodiert. `hype-train-end` → kompl.
  Zug (Lok + Kuppler + ein Waggon pro Teilnehmer + Kuppler + Endwagen) wird fertig zusammengebaut,
  steht kurz, fährt dann mit konstanter Pixel/Sekunde-Geschwindigkeit nach links raus (Dauer
  skaliert mit der Zuglänge). Avatare sitzen als reines PNG hinter der Waggon-Grafik (ragen oben
  raus), Usernamen auf dem goldenen Schild-Bereich des Waggon-Bilds mit automatisch angepasster
  Schriftgröße (`fitNameFontSize`, per Canvas `measureText`, kürzere Namen größer). Nach Ende:
  `POST /api/hype-train/complete`.
- `assets/css/overlay.css` — `.rails` (Gleise, volle Breite), `.train`/`.train-locomotive`/
  `.train-wagon`/`.train-endcar`/`.train-coupler`, `.wagon-avatar`/`.wagon-face`/`.wagon-name`,
  `.loco-steam` (Dampf-Puls). Räder werden **nicht** animiert (bewusst, User-Feedback).

### Tests — `tests/` (jsdom, `npm test`)
- `test-admin.mjs`, `test-overlay.mjs`, `test-css.mjs`, `test-name-fit.mjs` — booten admin.js/
  overlay.js in jsdom mit gestubbtem `fetch`/`WebSocket`/`EventSource`/`Audio`, prüfen DOM-Aufbau,
  Reihenfolge, CSS-Invarianten. `helpers.mjs` kopiert die JS-Dateien nach `tests/_sut/` (damit sie
  als ESM importierbar sind, da `public/` selbst kein `package.json` hat).

## Wichtige Konventionen / Muster
- **Ein Twitch-Account reicht**: Hype-Train-Events brauchen `channel:read:hype_train`
  (Broadcaster-Scope), das Zählen einzigartiger Chatter braucht `user:read:chat`. Beide Scopes
  werden im selben OAuth-Flow angefragt (`TWITCH_REQUIRED_SCOPES` in `admin.js`) — anders als beim
  Schwester-Projekt gibt es hier **keinen** separaten Bot-Account-Flow, weil kein `user:write:chat`
  (Chat schreiben) benötigt wird.
- **Avatar-Zuweisung ist stabil pro Hype Train**: `avatarAssignment` (login → Index) wird beim
  ersten Chat-Auftritt eines Users gewürfelt und bleibt für den Rest des Hype Trains gleich.
- **Overlay-Abschluss**: Overlay muss nach der Abfahrt-Animation `POST /api/hype-train/complete`
  senden, sonst blockiert der Status bis zum 60s-Sicherheits-Timeout im Server.
- **Kein festes Zielformat mehr für Lok/Waggon/Endwagen**: Uploads werden nur getrimmt (siehe
  oben), nicht auf eine feste Pixelgröße gezwungen — die drei Teile müssen im selben Maßstab
  gezeichnet sein, damit sie zueinander passen. `LOCO_ART.steam` in `overlay.js` ist auf die
  aktuell hinterlegte Lok-Grafik kalibriert (Bounding-Box der gezeichneten Dampfwolke als
  Prozent-Koordinaten) — bei neuer Lok-Grafik neu vermessen.
- **OBS-Auto-Connect**: Beim Admin-Start wird automatisch (still, ohne Toast) versucht, OBS zu
  erreichen, wenn ein Passwort gespeichert ist — kein manueller Klick auf „OBS testen" nötig.

## Gotchas (häufige Stolperfallen)
- **PowerShell-Commit**: `git commit -m "…"` bricht an eingebetteten `"`/deutschen Quotes.
  **Immer** Commit-Message in eine Datei schreiben und `git commit -F <datei>` nutzen.
- **`data/settings.json` und `defaults/settings.json` NICHT unnötig komplett ausgeben** — beide
  enthalten Bilder/Sounds als Base64 und sind mehrere MB groß (defaults/settings.json aktuell
  ~8 MB wegen 17 Standard-Avataren + Zug-Grafik). Fürs Debuggen nur gezielt Felder über
  `/api/settings` ziehen oder mit `node -e "JSON.parse(...).hypeTrain.avatars.length"` prüfen.
- **OBS cacht Overlays hart**: nach JS-Änderung Cache-Buster hochzählen; der User muss die
  Browserquelle ggf. per „Cache aktualisieren" neu laden. Server sendet zwar `no-store`, aber
  sicher ist sicher.
- **`node --check` reicht nicht**: kompiliert nur die Einzeldatei. Für echte Modul-/Zeichenfehler
  die Datei mit `node <file>` ausführen (fängt SyntaxError im ESM-Graph), oder `cd tests && npm
  test` für echte Verhaltensprüfung.
- robocopy-Exit **1** bedeutet „Dateien kopiert" = Erfolg, nicht Fehler.
- Git warnt „LF will be replaced by CRLF" — harmlos.
- Branch ist `main`; Releases hängen am `main`-Target.
- Port **5378** ist absichtlich anders als StreamerCardWidgets 5377, damit beide Apps parallel in
  OBS laufen können.
