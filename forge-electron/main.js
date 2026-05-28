const { app, BrowserWindow, ipcMain, net } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');

const API_PORT = 4567;

// ── Config (persisted to userData/nexus-config.json) ──────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'nexus-config.json');

function loadConfig() {
  try {
    const fs = require('fs');
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  return {};
}

function saveConfig(cfg) {
  try {
    const fs = require('fs');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) { console.error('[config] save error:', e); }
}

let appConfig = loadConfig();

// Dynamic API base — localhost when hosting, remote Hamachi IP when guest
function getApiBase() {
  return appConfig.remoteUrl || ('http://localhost:' + API_PORT);
}
function isGuestMode() { return !!appConfig.remoteUrl; }

// Paths differ between dev (electron .) and packaged (Nexus.exe)
const isDev = !app.isPackaged;
const APP_ROOT = isDev
  ? path.join(__dirname, '..')          // d:\Nexus
  : path.join(process.resourcesPath, '..'); // d:\...\Nexus\resources\..

const JAR_PATH = isDev
  ? path.join(APP_ROOT, 'forge-api', 'target', 'forge-api-2.0.12-SNAPSHOT-jar-with-dependencies.jar')
  : path.join(APP_ROOT, 'forge-api', 'forge-api.jar');
const JAR_WORKDIR = path.join(APP_ROOT, 'forge-api');

let mainWindow = null;
let forgeProcess = null;

// ── Nexus API process ──────────────────────────────────────────────────────

function sendLoadStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('load:status', status);
}

function startForgeApi() {
  console.log('[main] Starting Nexus API server...');
  const fs = require('fs');
  const logDir = path.join(JAR_WORKDIR, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logStream = fs.createWriteStream(path.join(logDir, 'api.log'), { flags: 'w' });
  forgeProcess = spawn('java', ['-jar', JAR_PATH, String(API_PORT)], {
    cwd: JAR_WORKDIR,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  forgeProcess.on('error', function(err) {
    console.error('[main] Failed to start Java:', err.message);
    sendLoadStatus({ event: 'java-crashed', noJava: err.code === 'ENOENT', code: null });
  });
  forgeProcess.stdout.on('data', function(d) {
    process.stdout.write('[nexus] ' + d);
    logStream.write(d);
    // Signal renderer once Java produces any output (it's alive)
    sendLoadStatus({ event: 'java-started' });
    forgeProcess.stdout.removeAllListeners('data');
    forgeProcess.stdout.on('data', function(d2) { process.stdout.write('[nexus] ' + d2); logStream.write(d2); });
  });
  forgeProcess.stderr.on('data', function(d) { process.stderr.write('[nexus] ' + d); logStream.write(d); });
  forgeProcess.on('exit', function(code) {
    console.log('[main] Nexus API exited (' + code + ')');
    if (code !== 0 && code !== null) sendLoadStatus({ event: 'java-crashed', code });
  });
}

function pollUntilReady(retries, interval) {
  retries = retries || 60;
  interval = interval || 2000;
  return new Promise(function(resolve, reject) {
    var attempts = 0;
    function check() {
      http.get(getApiBase() + '/api/status', function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() {
          try {
            var json = JSON.parse(data);
            if (json.forgeInitialized) return resolve();
          } catch (e) {}
          retry();
        });
      }).on('error', retry);
    }
    function retry() {
      attempts++;
      sendLoadStatus({ event: 'poll', attempt: attempts, max: retries });
      if (attempts >= retries) {
        sendLoadStatus({ event: 'failed' });
        return reject(new Error('Nexus API not ready'));
      }
      setTimeout(check, interval);
    }
    check();
  });
}

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1923',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Nexus'
  });
  mainWindow.on('closed', function() { mainWindow = null; });
  return mainWindow;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

var HTTP_TIMEOUT_MS = 15000; // 15 s hard timeout on all API calls

function withTimeout(promise, ms, label) {
  var timer;
  var timeout = new Promise(function(_, reject) {
    timer = setTimeout(function() {
      reject(new Error((label || 'request') + ' timed out after ' + ms + 'ms'));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(function() { clearTimeout(timer); });
}

function parseJsonOrThrow(data, url) {
  if (data.trimStart().startsWith('<')) {
    throw new Error(
      'Le serveur a répondu avec du HTML au lieu de JSON.\n' +
      'URL appelée : ' + url + '\n' +
      'Causes possibles :\n' +
      '  • URL Hamachi incorrecte dans Paramètres (format requis : http://25.x.x.x:4567)\n' +
      '  • Port manquant ou erroné\n' +
      '  • Version de Nexus trop ancienne chez l\'hôte — mettre à jour avec mise-a-jour.bat'
    );
  }
  return JSON.parse(data);
}

function fetchJson(endpoint) {
  var url = getApiBase() + endpoint;
  return withTimeout(new Promise(function(resolve, reject) {
    http.get(url, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(parseJsonOrThrow(data, url)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  }), HTTP_TIMEOUT_MS, 'GET ' + endpoint);
}

function postJson(endpoint, body) {
  return withTimeout(new Promise(function(resolve, reject) {
    var base = getApiBase();
    var payload = JSON.stringify(body);
    var parsed = new URL(base);
    var port = parseInt(parsed.port);
    if (!port) port = parsed.protocol === 'https:' ? 443 : 80;
    var opts = {
      hostname: parsed.hostname,
      port: port,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    var req = http.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(parseJsonOrThrow(data, base + endpoint)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  }), HTTP_TIMEOUT_MS, 'POST ' + endpoint);
}

function deleteJson(endpoint) {
  return withTimeout(new Promise(function(resolve, reject) {
    var parsed = new URL(getApiBase());
    var opts = {
      hostname: parsed.hostname,
      port: parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
      path: endpoint,
      method: 'DELETE'
    };
    var req = http.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
      });
    });
    req.on('error', reject);
    req.end();
  }), HTTP_TIMEOUT_MS, 'DELETE ' + endpoint);
}

// ── Moxfield fetch ─────────────────────────────────────────────────────────

function fetchMoxfieldDeck(publicId) {
  // Use electron.net (Chromium network stack) to bypass Cloudflare TLS fingerprinting
  return new Promise(function(resolve, reject) {
    var req = net.request({
      method: 'GET',
      url: 'https://api2.moxfield.com/v2/decks/all/' + publicId
    });
    req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    req.setHeader('Accept', 'application/json');
    req.setHeader('Accept-Language', 'en-US,en;q=0.9');
    req.on('response', function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var data = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error('Moxfield HTTP ' + res.statusCode + ': ' + data.slice(0, 200)));
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON invalide: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function moxfieldFormatToForge(fmt) {
  if (!fmt) return 'Commander';
  var map = { duelcommander: 'Commander', commander: 'Commander', constructed: 'Constructed',
               standard: 'Constructed', modern: 'Constructed', legacy: 'Constructed',
               vintage: 'Constructed', pioneer: 'Constructed', pauper: 'Constructed' };
  return map[fmt.toLowerCase()] || 'Commander';
}

// ── App lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(function() {

  // Register IPC handlers inside whenReady (recommended practice)
  ipcMain.handle('api:get', function(_, endpoint) {
    return fetchJson(endpoint);
  });
  ipcMain.handle('api:post', function(_, endpoint, body) {
    return postJson(endpoint, body);
  });
  ipcMain.handle('api:delete', function(_, endpoint) {
    return deleteJson(endpoint);
  });

  ipcMain.handle('api:get-mode', function() {
    return {
      remoteUrl: appConfig.remoteUrl || null,
      isGuest: isGuestMode(),
      playerIndex: isGuestMode() ? 1 : 0
    };
  });

  ipcMain.handle('api:set-remote', function(_, url) {
    appConfig.remoteUrl = url;
    saveConfig(appConfig);
    return { ok: true, note: 'Restart required to switch mode' };
  });

  ipcMain.handle('api:clear-remote', function() {
    delete appConfig.remoteUrl;
    saveConfig(appConfig);
    return { ok: true, note: 'Restart required to switch mode' };
  });

  ipcMain.handle('api:import-moxfield', function(_, url, nameOverride) {
    // Extract publicId from URL like https://moxfield.com/decks/{publicId}
    var match = url.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/);
    if (!match) return Promise.reject(new Error('URL Moxfield invalide'));
    var publicId = match[1];
    return fetchMoxfieldDeck(publicId).then(function(d) {
      var format = moxfieldFormatToForge(d.format);
      function forgeName(n) { return n && n.includes(' // ') ? n.split(' // ')[0] : n; }
      var commanders = Object.values(d.commanders || {}).map(function(e) {
        return { name: forgeName(e.card.name), qty: e.quantity };
      });
      var mainboard = Object.values(d.mainboard || {}).map(function(e) {
        return { name: forgeName(e.card.name), qty: e.quantity };
      });
      var sideboard = Object.values(d.sideboard || {}).map(function(e) {
        return { name: forgeName(e.card.name), qty: e.quantity };
      });
      var payload = { name: nameOverride || d.name, format: format, commander: commanders, mainboard: mainboard };
      if (sideboard.length) payload.sideboard = sideboard;
      return postJson('/api/decks/import', payload);
    });
  });

  // Show loading screen immediately
  var win = createWindow();
  win.loadFile(path.join(__dirname, 'src', 'loading.html'));

  if (isGuestMode()) {
    // Guest mode: connect to remote forge-api, don't start Java
    console.log('[main] Guest mode — connecting to ' + appConfig.remoteUrl);
    pollUntilReady(30, 2000).then(function() {
      win.loadFile(path.join(__dirname, 'src', 'index.html'));
    }).catch(function(err) {
      console.error('[main] Remote forge-api not reachable:', err.message);
      win.loadFile(path.join(__dirname, 'src', 'index.html')); // load anyway, show error in UI
    });
  } else {
    // Local mode: check if forge-api is already up (dev mode: started manually)
    fetchJson('/api/status').then(function(status) {
      if (status.forgeInitialized) {
        win.loadFile(path.join(__dirname, 'src', 'index.html'));
      } else {
        return pollUntilReady().then(function() {
          win.loadFile(path.join(__dirname, 'src', 'index.html'));
        });
      }
    }).catch(function() {
      startForgeApi();
      pollUntilReady().then(function() {
        win.loadFile(path.join(__dirname, 'src', 'index.html'));
      }).catch(function(err) {
        console.error('[main] Forge API failed to start:', err.message);
      });
    });
  }

});

app.on('window-all-closed', function() {
  if (forgeProcess) forgeProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function() {
  if (mainWindow === null) createWindow();
});
