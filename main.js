const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

let mainWindow = null;
let activeLoadSession = null;
let monitorInterval = null;
let activeScanSession = null;

const CONFIG = {
  CHUNK_SIZE: 50,
  RAM_PAUSE_THRESHOLD_MB: 300,
  RAM_RESUME_THRESHOLD_MB: 500
};

const VIDEO_EXT = new Set(['mp4','m4v','mkv','avi','mov','wmv','flv','webm','ts','m2ts','vob','ogv','3gp','divx']);
const IMAGE_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','tiff','tif','heic','heif','avif','svg','ico']);
const NEEDS_TRANSCODE_EXT = new Set(['mkv','avi','mov','wmv','flv','ts','m2ts','vob','divx','3gp']);
const SKIP_DIRS = new Set([
  'node_modules','$recycle.bin','system volume information',
  'windows','program files','program files (x86)',
  '.git','.svn','__pycache__','appdata','temp','tmp'
]);

function log(action, details = '') {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}] [MAIN] ${action}${details ? ' · ' + details : ''}`);
}

function sendToRenderer(channel, data) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
  } catch { }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// FENSTER
// ============================================================
function createWindow() {
  log('CREATE_WINDOW');
  mainWindow = new BrowserWindow({
    width: 1800, height: 1000, minWidth: 1000, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#0a0a0a',
    title: 'Media Manager'
  });
  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (activeLoadSession) activeLoadSession.aborted = true;
    if (activeScanSession) activeScanSession.aborted = true;
    stopMonitor();
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });

// ============================================================
// IPC: ORDNER AUSWÄHLEN
// ============================================================
ipcMain.handle('select-folder', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (r.canceled) return null;
    return r.filePaths[0];
  } catch { return null; }
});

// ============================================================
// IPC: JSON-DATEI AUSWÄHLEN (Loader-Tab)
// ============================================================
ipcMain.handle('select-json-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'media_data.json auswählen',
      properties: ['openFile'],
      filters: [{ name: 'JSON Daten', extensions: ['json'] }, { name: 'Alle Dateien', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths.length) return null;
    log('select-json-file', result.filePaths[0]);
    return result.filePaths[0];
  } catch (e) { log('ERROR select-json-file', e.message); return null; }
});

// ============================================================
// IPC: SCANNER — ORDNER REKURSIV SCANNEN
//
// mode='update'  Neue Dateien zur vorhandenen JSON hinzufügen
// mode='full'    Alles neu scannen, vorhandene JSON überschreiben
//
// Sendet während des Scans 'scan-progress' Events mit:
//   phase: 'start' | 'scanning' | 'writing' | 'done' | 'aborted' | 'error'
//   scannedFiles, scannedFolders, newFiles, currentPath/currentFolder
// ============================================================
ipcMain.handle('scan-media', async (event, { folderPath, jsonPath, mode = 'update' }) => {
  log('scan-media', `mode=${mode} · ${folderPath}`);

  if (!folderPath) return { success: false, error: 'Kein Ordner angegeben.' };
  if (!fs.existsSync(folderPath)) return { success: false, error: `Ordner nicht gefunden:\n${folderPath}` };

  // Laufenden Scan sauber abbrechen
  if (activeScanSession) {
    activeScanSession.aborted = true;
    await sleep(150);
  }

  const targetJson = jsonPath || path.join(folderPath, 'media_data.json');

  // Im Update-Modus vorhandene Einträge einlesen
  let existingItems = [];
  const existingPathSet = new Set();

  if (mode === 'update' && fs.existsSync(targetJson)) {
    try {
      const raw = fs.readFileSync(targetJson, 'utf-8');
      const parsed = JSON.parse(raw);
      existingItems = Array.isArray(parsed) ? parsed : (parsed.items || []);
      existingItems.forEach(i => { if (i.path) existingPathSet.add(path.normalize(i.path)); });
      log('scan-media', `Update: ${existingItems.length} vorhandene Einträge`);
    } catch (e) {
      log('scan-media WARN', `JSON nicht lesbar: ${e.message} → Full-Scan`);
      existingItems = [];
    }
  }

  const session = { aborted: false, folderPath, targetJson };
  activeScanSession = session;

  sendToRenderer('scan-progress', {
    phase: 'start',
    folderPath,
    targetJson,
    mode,
    existingCount: existingItems.length
  });

  let scannedFiles = 0;
  let scannedFolders = 0;
  let newItems = [];
  let lastSend = Date.now();

  try {
    await scanDirRecursive(folderPath, folderPath, session, {
      onFile(item) {
        scannedFiles++;
        if (!existingPathSet.has(item.path)) newItems.push(item);

        const now = Date.now();
        if (now - lastSend > 150 || scannedFiles % 200 === 0) {
          lastSend = now;
          sendToRenderer('scan-progress', {
            phase: 'scanning',
            scannedFiles,
            scannedFolders,
            newFiles: newItems.length,
            currentPath: item.path
          });
        }
      },
      onFolder(folderFullPath) {
        scannedFolders++;
        const now = Date.now();
        if (now - lastSend > 300) {
          lastSend = now;
          sendToRenderer('scan-progress', {
            phase: 'scanning',
            scannedFiles,
            scannedFolders,
            newFiles: newItems.length,
            currentFolder: folderFullPath
          });
        }
      }
    });
  } catch (e) {
    if (session.aborted) {
      sendToRenderer('scan-progress', { phase: 'aborted', scannedFiles, scannedFolders, newFiles: newItems.length });
      activeScanSession = null;
      return { success: false, error: 'Scan abgebrochen.' };
    }
    log('ERROR scan-media', e.message);
    sendToRenderer('scan-progress', { phase: 'error', error: e.message });
    activeScanSession = null;
    return { success: false, error: e.message };
  }

  if (session.aborted) {
    sendToRenderer('scan-progress', { phase: 'aborted', scannedFiles, scannedFolders, newFiles: newItems.length });
    activeScanSession = null;
    return { success: false, error: 'Scan abgebrochen.' };
  }

  // JSON schreiben
  sendToRenderer('scan-progress', { phase: 'writing', scannedFiles, scannedFolders, newFiles: newItems.length });

  const allItems = mode === 'update' ? [...existingItems, ...newItems] : newItems;

  try {
    fs.writeFileSync(targetJson, JSON.stringify(allItems, null, 2), 'utf-8');
    log('scan-media', `Geschrieben: ${allItems.length} Einträge → ${targetJson}`);
  } catch (e) {
    const msg = `Schreibfehler: ${e.message}`;
    log('ERROR scan-media', msg);
    sendToRenderer('scan-progress', { phase: 'error', error: msg });
    activeScanSession = null;
    return { success: false, error: msg };
  }

  activeScanSession = null;

  const result = {
    success: true,
    totalCount: allItems.length,
    newCount: newItems.length,
    scannedFiles,
    scannedFolders,
    targetJson,
    folderPath
  };

  sendToRenderer('scan-progress', { phase: 'done', ...result });
  log('scan-media', `Fertig: ${newItems.length} neu, ${allItems.length} gesamt`);
  return result;
});

// ============================================================
// IPC: SCAN ABBRECHEN
// ============================================================
ipcMain.handle('abort-scan', async () => {
  if (activeScanSession) {
    activeScanSession.aborted = true;
    activeScanSession = null;
    log('abort-scan');
  }
  return { success: true };
});

// ============================================================
// REKURSIVER SCANNER (async, nicht-blockierend durch setImmediate)
// ============================================================
async function scanDirRecursive(dirPath, rootPath, session, callbacks) {
  if (session.aborted) return;

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return; // Kein Zugriff → überspringen
  }

  for (const entry of entries) {
    if (session.aborted) return;

    // Kurz Kontrolle abgeben damit UI-Events verarbeitet werden
    await new Promise(r => setImmediate(r));

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      callbacks.onFolder(fullPath);
      await scanDirRecursive(fullPath, rootPath, session, callbacks);

    } else if (entry.isFile()) {
      const ext = entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';
      if (!VIDEO_EXT.has(ext) && !IMAGE_EXT.has(ext)) continue;

      let stat;
      try { stat = fs.statSync(fullPath); }
      catch { continue; }

      const relFolder = path.relative(rootPath, path.dirname(fullPath)).replace(/\\/g, '/');

      callbacks.onFile({
        path: fullPath,
        name: entry.name,
        type: VIDEO_EXT.has(ext) ? 'video' : 'image',
        folder: relFolder === '.' ? '' : relFolder,
        size: stat.size,
        created: Math.round(stat.birthtimeMs || stat.ctimeMs || 0),
        modified: Math.round(stat.mtimeMs || 0),
        needsTranscode: VIDEO_EXT.has(ext) && NEEDS_TRANSCODE_EXT.has(ext),
        transcoded: false,
        transcodePath: null,
        tags: []
      });
    }
  }
}

// ============================================================
// IPC: JSON VORBEREITEN (Loader-Tab — Chunk-Loading)
// ============================================================
ipcMain.handle('prepare-media-cache', async (event, jsonFilePath) => {
  log('prepare-media-cache', jsonFilePath);
  try {
    if (!jsonFilePath || !fs.existsSync(jsonFilePath)) {
      return { success: false, error: `Datei nicht gefunden:\n${jsonFilePath}` };
    }

    const rootPath = path.dirname(jsonFilePath);
    const fileSizeBytes = fs.statSync(jsonFilePath).size;

    let rawContent;
    try { rawContent = fs.readFileSync(jsonFilePath, 'utf-8'); }
    catch (e) { return { success: false, error: `Lesefehler: ${e.message}` }; }

    let parsed;
    try { parsed = JSON.parse(rawContent); }
    catch (e) { return { success: false, error: `JSON-Fehler: ${e.message}` }; }
    rawContent = null;

    const rawItems = Array.isArray(parsed) ? parsed : (parsed.items || parsed.data || null);
    if (!rawItems || !Array.isArray(rawItems)) {
      return { success: false, error: 'Unbekanntes JSON-Format. Erwartet: Array oder { items: [] }' };
    }

    const normalizedItems = [];
    for (const item of rawItems) {
      let p = item.path || item.fullPath || item.filePath || '';
      if (!p) continue;
      if (p.startsWith('file:///')) p = p.substring(8);
      else if (p.startsWith('file://')) p = p.substring(7);
      if (!path.isAbsolute(p)) p = path.join(rootPath, p);
      p = path.normalize(p);
      normalizedItems.push({ ...item, path: p });
    }

    const stats = buildScanStats(normalizedItems, rootPath);
    const totalChunks = Math.ceil(normalizedItems.length / CONFIG.CHUNK_SIZE);

    activeLoadSession = {
      jsonFilePath, rootPath,
      allItems: normalizedItems,
      totalItems: normalizedItems.length,
      totalChunks,
      sentChunks: 0,
      aborted: false
    };

    log('prepare-media-cache', `${normalizedItems.length} Items, ${totalChunks} Chunks`);
    return { success: true, totalItems: normalizedItems.length, totalChunks, chunkSize: CONFIG.CHUNK_SIZE, stats, rootPath, jsonFilePath, fileSizeBytes };
  } catch (error) {
    log('ERROR prepare-media-cache', error.message);
    return { success: false, error: error.message };
  }
});

// ============================================================
// IPC: NÄCHSTEN CHUNK ANFORDERN
// ============================================================
ipcMain.handle('request-next-chunk', async (event, { freeRamMB } = {}) => {
  const session = activeLoadSession;
  if (!session || session.aborted) return { success: false, done: true, reason: 'no-session' };
  if (session.sentChunks >= session.totalChunks) return { success: true, done: true, sentChunks: session.sentChunks, totalChunks: session.totalChunks };

  const actualFreeRam = getFreeRamMB();
  const effective = Math.min(actualFreeRam, freeRamMB || actualFreeRam);
  if (effective < CONFIG.RAM_PAUSE_THRESHOLD_MB) {
    return { success: true, done: false, paused: true, reason: 'low-ram', freeRamMB: Math.round(effective), sentChunks: session.sentChunks, totalChunks: session.totalChunks };
  }

  const start = session.sentChunks * CONFIG.CHUNK_SIZE;
  const batch = session.allItems.slice(start, start + CONFIG.CHUNK_SIZE);
  const validItems = [];
  for (const item of batch) {
    try { if (fs.existsSync(item.path)) validItems.push(item); } catch { }
  }

  session.sentChunks++;
  return { success: true, done: false, paused: false, chunkIndex: session.sentChunks, totalChunks: session.totalChunks, items: validItems, freeRamMB: Math.round(actualFreeRam), sentChunks: session.sentChunks };
});

ipcMain.handle('abort-load-session', async () => {
  if (activeLoadSession) { activeLoadSession.aborted = true; activeLoadSession = null; }
  return { success: true };
});

// ============================================================
// IPC: SYSTEM-MONITOR
// ============================================================
ipcMain.handle('get-system-status', async () => getSystemStatus());

ipcMain.handle('start-system-monitor', async (event, intervalMs = 1000) => {
  stopMonitor();
  monitorInterval = setInterval(() => sendToRenderer('system-status-update', getSystemStatus()), Math.max(500, intervalMs));
  return { success: true };
});

ipcMain.handle('stop-system-monitor', async () => { stopMonitor(); return { success: true }; });

function stopMonitor() {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
}

// ============================================================
// IPC: DATEI-OPERATIONEN
// ============================================================
ipcMain.handle('show-in-explorer', async (event, filePath) => {
  try { require('electron').shell.showItemInFolder(filePath); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('open-with-potplayer', async (event, filePath) => {
  const candidates = [
    'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe',
    'C:\\Program Files (x86)\\DAUM\\PotPlayer\\PotPlayerMini.exe',
    'C:\\Program Files\\PotPlayer\\PotPlayerMini64.exe'
  ];
  try {
    const exe = candidates.find(p => fs.existsSync(p));
    if (!exe) return { success: false, error: 'PotPlayer nicht gefunden.' };
    spawn(exe, [filePath], { detached: true, stdio: 'ignore' });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('transcode-video', async (event, filePath) => ({ success: false, error: 'Nicht implementiert.' }));
ipcMain.handle('update-item', async () => ({ success: false, error: 'Nicht implementiert.' }));
ipcMain.handle('add-tag', async () => ({ success: false, error: 'Nicht implementiert.' }));
ipcMain.handle('remove-tag', async () => ({ success: false, error: 'Nicht implementiert.' }));

// ============================================================
// SYSTEM-STATUS
// ============================================================
function getFreeRamMB() { return os.freemem() / 1024 / 1024; }

function getSystemStatus() {
  const freeMB = getFreeRamMB();
  const totalMB = os.totalmem() / 1024 / 1024;
  const usedMB = totalMB - freeMB;
  let diskLatencyMs = null, diskReadSpeedMBs = null;
  const testFile = activeLoadSession?.jsonFilePath;
  if (testFile) {
    try {
      const t0 = process.hrtime.bigint();
      const fd = fs.openSync(testFile, 'r');
      const buf = Buffer.alloc(65536);
      const read = fs.readSync(fd, buf, 0, 65536, 0);
      fs.closeSync(fd);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      diskLatencyMs = Math.round(ms * 10) / 10;
      if (ms > 0) diskReadSpeedMBs = Math.round((read / 1024 / 1024) / (ms / 1000));
    } catch { }
  }
  return {
    ram: { totalMB: Math.round(totalMB), usedMB: Math.round(usedMB), freeMB: Math.round(freeMB), usedPercent: Math.round((usedMB / totalMB) * 100), critical: freeMB < CONFIG.RAM_PAUSE_THRESHOLD_MB, warning: freeMB < CONFIG.RAM_RESUME_THRESHOLD_MB },
    disk: { readSpeedMBs: diskReadSpeedMBs, latencyMs: diskLatencyMs, healthy: diskLatencyMs !== null ? diskLatencyMs < 50 : null },
    loadSession: activeLoadSession ? { active: true, sentChunks: activeLoadSession.sentChunks, totalChunks: activeLoadSession.totalChunks, totalItems: activeLoadSession.totalItems, progressPercent: Math.round((activeLoadSession.sentChunks / activeLoadSession.totalChunks) * 100) } : { active: false },
    scanSession: { active: !!activeScanSession },
    config: { ramPauseThresholdMB: CONFIG.RAM_PAUSE_THRESHOLD_MB, ramResumeThresholdMB: CONFIG.RAM_RESUME_THRESHOLD_MB, chunkSize: CONFIG.CHUNK_SIZE }
  };
}

function buildScanStats(items, rootPath) {
  let videoCount = 0, imageCount = 0, totalBytes = 0;
  const folders = new Set(), subfolders = new Set();
  for (const item of items) {
    const ext = (item.name || item.path || '').split('.').pop().toLowerCase();
    const type = (item.type || '').toLowerCase();
    if (type === 'video' || VIDEO_EXT.has(ext)) videoCount++;
    else if (type === 'image' || IMAGE_EXT.has(ext)) imageCount++;
    if (item.size) totalBytes += item.size;
    const p = item.path || '';
    const rel = p.toLowerCase().startsWith(rootPath.toLowerCase()) ? p.substring(rootPath.length).replace(/^[/\\]/, '') : p;
    const parts = rel.split(/[/\\]/); parts.pop();
    if (parts.length > 0 && parts[0]) { folders.add(parts[0]); if (parts.length > 1) subfolders.add(parts.slice(0, 2).join('/')); }
  }
  return { totalFiles: items.length, videoCount, imageCount, otherCount: items.length - videoCount - imageCount, totalBytes, totalGB: (totalBytes / 1073741824).toFixed(2), folderCount: folders.size, subfolderCount: subfolders.size, rootPath };
}

log('READY', `Chunk-Size: ${CONFIG.CHUNK_SIZE} · RAM-Limit: ${CONFIG.RAM_PAUSE_THRESHOLD_MB} MB`);