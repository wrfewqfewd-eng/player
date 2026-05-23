/**
 * APP STATE MANAGER
 *
 * Zentraler, reaktiver Datenspeicher für alle Views.
 *
 * appendMediaItems(chunk) — fügt Items hinzu OHNE komplettes Re-Render
 * setMediaItems(all)      — ersetzt alle Items (löst vollständiges Re-Render aus)
 */

class AppState {
  constructor() {
    this.config = {
      videoExtensions: new Set(['mp4','m4v','mkv','avi','mov','wmv','flv','webm']),
      imageExtensions: new Set(['jpg','jpeg','png','gif','webp','bmp','tiff','tif']),
      grid: {
        defaultColumns: 5,
        folderStackThreshold: 5
      }
    };

    this.mediaItems = [];
    this.rootPath = null;
    this.jsonFilePath = null;
    this.scanStats = null;

    this.currentFolderPath = '';
    this.collapsedFolderPaths = new Set();

    this.scrollPositions = { grid: 0, detail: 0, scan: 0 };
    this.videoPlaybackStates = new Map();
    this.selectedItemPaths = new Set();

    this.activeFilters = {
      showVideos: true, showImages: true,
      showTranscoded: true, showOriginals: true,
      searchQuery: ''
    };
    this.activeSortKey = 'created-desc';

    this._listeners = {};

    console.log('[STATE] Initialisiert');
  }

  static getInstance() {
    if (!AppState._instance) {
      AppState._instance = new AppState();
    }
    return AppState._instance;
  }

  // ============================================================
  // MEDIA-ITEMS — CHUNK-LOADING
  // ============================================================

  appendMediaItems(rawChunk) {
    const normalized = rawChunk.map(raw => this._normalizeItem(raw));
    this.mediaItems.push(...normalized);
    this._emit('items-chunk-added', normalized);
  }

  setMediaItems(rawItems) {
    console.log(`[STATE] setMediaItems: ${rawItems.length} Items`);
    this.mediaItems = rawItems.map(raw => this._normalizeItem(raw));
    this._emit('items-changed', this.mediaItems);
  }

  setItems(rawItems) { return this.setMediaItems(rawItems); }

  getMediaItems() { return this.mediaItems; }
  getItems() { return this.mediaItems; }

  finalizeLoading() {
    console.log(`[STATE] finalizeLoading: ${this.mediaItems.length} Items gesamt`);
    this._emit('items-changed', this.mediaItems);
  }

  clearMediaItems() {
    this.mediaItems = [];
    this._emit('items-cleared');
  }

  getItemsForFolder(folderPath = '') {
    if (folderPath === '') return this.mediaItems;
    return this.mediaItems.filter(
      i => i.folderPath === folderPath || i.folderPath.startsWith(folderPath + '/')
    );
  }

  getFolderStructure() {
    const folders = {};
    for (const item of this.mediaItems) {
      if (!item.folderPath) continue;
      const parts = item.folderPath.split('/');
      let cur = '';
      for (const part of parts) {
        cur = cur ? `${cur}/${part}` : part;
        folders[cur] = (folders[cur] || 0) + 1;
      }
    }
    return folders;
  }

  // ============================================================
  // ROOT & JSON-DATEI
  // ============================================================
  setRootPath(p) { this.rootPath = p; this._emit('root-changed', p); }
  getRootPath() { return this.rootPath; }
  getRootFolderName() {
    if (!this.rootPath) return 'Kein Ordner';
    return this.rootPath.split(/[/\\]/).pop();
  }

  setJsonFilePath(p) { this.jsonFilePath = p; this._emit('json-file-changed', p); }
  getJsonFilePath() { return this.jsonFilePath; }

  setScanStats(stats) { this.scanStats = stats; this._emit('scan-stats-changed', stats); }
  getScanStats() { return this.scanStats; }

  // ============================================================
  // NAVIGATION
  // ============================================================
  setCurrentFolderPath(p) { this.currentFolderPath = p; this._emit('folder-changed', p); }
  setCurrentFolder(p) { return this.setCurrentFolderPath(p); }
  getCurrentFolderPath() { return this.currentFolderPath; }
  getCurrentFolder() { return this.currentFolderPath; }

  navigateUp() {
    const parts = this.currentFolderPath.split('/');
    parts.pop();
    const p = parts.join('/');
    this.setCurrentFolderPath(p);
    return p;
  }

  navigateInto(name) {
    const p = this.currentFolderPath ? `${this.currentFolderPath}/${name}` : name;
    this.setCurrentFolderPath(p);
    return p;
  }

  // ============================================================
  // ORDNER EIN-/AUSKLAPPEN
  // ============================================================
  collapseFolder(p) { this.collapsedFolderPaths.add(p); this._emit('folder-collapsed', p); }
  expandFolder(p) { this.collapsedFolderPaths.delete(p); this._emit('folder-expanded', p); }
  isFolderCollapsed(p) { return this.collapsedFolderPaths.has(p); }
  toggleFolderCollapse(p) { this.isFolderCollapsed(p) ? this.expandFolder(p) : this.collapseFolder(p); }

  // ============================================================
  // SCROLL-POSITIONEN
  // ============================================================
  saveScrollPosition(view, pos) { this.scrollPositions[view] = pos; }
  getScrollPosition(view) { return this.scrollPositions[view] || 0; }

  // ============================================================
  // VIDEO-WIEDERGABE-STATUS
  // ============================================================
  saveVideoPlaybackState(path, time, playing = false) {
    this.videoPlaybackStates.set(path, { currentTime: time, wasPlaying: playing });
  }
  getVideoPlaybackState(path) { return this.videoPlaybackStates.get(path) || null; }
  saveVideoState(p, t, pl) { return this.saveVideoPlaybackState(p, t, pl); }
  getVideoState(p) { return this.getVideoPlaybackState(p); }

  // ============================================================
  // FILTER & SORTIERUNG
  // ============================================================
  setFilter(name, val) {
    this.activeFilters[name] = val;
    this._emit('filter-changed', this.activeFilters);
  }
  getFilters() { return this.activeFilters; }

  setSortKey(key) { this.activeSortKey = key; this._emit('sort-changed', key); }
  setSortBy(key) { return this.setSortKey(key); }
  getSortKey() { return this.activeSortKey; }
  getSortBy() { return this.activeSortKey; }

  applyFiltersAndSort(items) {
    let r = [...items];
    const f = this.activeFilters;
    if (!f.showVideos)     r = r.filter(i => i.type !== 'video');
    if (!f.showImages)     r = r.filter(i => i.type !== 'image');
    if (!f.showTranscoded) r = r.filter(i => !i.transcoded);
    if (!f.showOriginals)  r = r.filter(i => i.transcoded);
    if (f.searchQuery) {
      const q = f.searchQuery.toLowerCase();
      r = r.filter(i => i.fileName.toLowerCase().includes(q) || (i.folderPath || '').toLowerCase().includes(q));
    }
    return this._sortItems(r, this.activeSortKey);
  }

  // ============================================================
  // STATISTIKEN
  // ============================================================
  getStats() {
    return {
      total: this.mediaItems.length,
      videos: this.mediaItems.filter(i => i.type === 'video').length,
      images: this.mediaItems.filter(i => i.type === 'image').length,
      needsTranscode: this.mediaItems.filter(i => i.needsTranscode && !i.transcoded).length,
      transcoded: this.mediaItems.filter(i => i.transcoded).length,
      folders: Object.keys(this.getFolderStructure()).length
    };
  }

  // ============================================================
  // PRIVATE: NORMALISIERUNG
  // ============================================================
  _normalizeItem(raw) {
    const { videoExtensions, imageExtensions } = this.config;
    const absolutePath = raw.path || raw.fullPath || raw.filePath || '';

    let fileName = raw.name;
    if (!fileName && absolutePath) fileName = absolutePath.split(/[/\\]/).pop();
    fileName = fileName || '';

    const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    let type = (raw.type || '').toString().toLowerCase();

    if (!type || type === 'unknown') {
      type = videoExtensions.has(ext) ? 'video' : imageExtensions.has(ext) ? 'image' : 'unknown';
    } else {
      if (['video-file','vid','movie'].includes(type)) type = 'video';
      if (['image-file','img','picture','photo'].includes(type)) type = 'image';
    }

    let folderPath = raw.folder != null ? String(raw.folder) : '';
    if (!folderPath && this.rootPath && absolutePath) {
      const rl = this.rootPath.toLowerCase();
      const pl = absolutePath.toLowerCase();
      if (pl.startsWith(rl)) {
        const rel = absolutePath.substring(this.rootPath.length).replace(/^[/\\]/, '');
        const parts = rel.split(/[/\\]/);
        parts.pop();
        folderPath = parts.join('/');
      }
    }

    let tags = raw.tags;
    if (!Array.isArray(tags)) tags = tags ? [String(tags)] : [];

    return {
      ...raw,
      path: absolutePath,
      fileName, name: fileName,
      type,
      folderPath, folder: folderPath,
      tags,
      needsTranscode: !!raw.needsTranscode,
      transcoded: !!raw.transcoded,
      transcodePath: raw.transcodePath || null
    };
  }

  // ============================================================
  // PRIVATE: SORTIERUNG
  // ============================================================
  _sortItems(items, key) {
    const s = [...items];
    switch (key) {
      case 'created-desc': return s.sort((a,b) => (b.created||0) - (a.created||0));
      case 'created-asc':  return s.sort((a,b) => (a.created||0) - (b.created||0));
      case 'name-asc':     return s.sort((a,b) => a.fileName.localeCompare(b.fileName));
      case 'name-desc':    return s.sort((a,b) => b.fileName.localeCompare(a.fileName));
      case 'size-desc':    return s.sort((a,b) => (b.size||0) - (a.size||0));
      case 'size-asc':     return s.sort((a,b) => (a.size||0) - (b.size||0));
      default: return s;
    }
  }

  // ============================================================
  // EVENT SYSTEM
  // ============================================================
  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
  }
  off(event, cb) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(f => f !== cb);
  }
  _emit(event, data) {
    (this._listeners[event] || []).forEach(cb => { try { cb(data); } catch(e) { console.error('[STATE] Listener-Fehler:', event, e); } });
  }
  emit(event, data) { return this._emit(event, data); }

  // ============================================================
  // DEBUG
  // ============================================================
  debug() {
    console.log('[STATE]', {
      items: this.mediaItems.length,
      rootPath: this.rootPath,
      jsonFilePath: this.jsonFilePath,
      folder: this.currentFolderPath,
      stats: this.getStats()
    });
  }
}

AppState._instance = null;

if (typeof window !== 'undefined') window.AppState = AppState;