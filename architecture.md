# 🏗️ ARCHITEKTUR-DOKUMENTATION

## 📊 ÜBERSICHT

Diese Dokumentation erklärt die **neue modulare Architektur** des Media Managers.

**Ziel:** Saubere Trennung, einfache Erweiterung, bessere Performance

---

## 📁 DATEI-STRUKTUR

```
video-manager/
│
├── main.js              ✅ BACKEND - Electron IPC
├── preload.js           ✅ Bridge (unverändert)
├── package.json         ✅ Config (unverändert)
│
├── index.html           🔨 ROUTER - Lädt Views
├── state.js             ✅ STATE - Zentraler Datenspeicher
│
├── grid-view.html       ✅ GRID - Visuelle Ansicht
├── detail-view.html     🔨 DETAIL - Tabellen-Ansicht
│
└── style.css            🔨 Basis-Styles (optional)
```

**Legende:**
- ✅ = Erstellt und fertig
- 🔨 = Musst du noch erstellen

---

## 🎯 WARUM DIESE STRUKTUR?

### **Problem vorher:**
```
❌ Alles in einer 1500-Zeilen index.html
❌ Grid + Detail vermischt
❌ State überall verstreut
❌ Schwer zu debuggen
❌ Neue Features = Chaos
```

### **Lösung jetzt:**
```
✅ Jede View in eigener Datei
✅ Zentraler State (eine Quelle)
✅ Klare Verantwortlichkeiten
✅ Einfach zu erweitern
✅ Event-basierte Kommunikation
```

---

## 📄 DATEI 1: `state.js`

### **ZWECK**
Zentraler Datenspeicher, den ALLE Views teilen

### **WARUM WICHTIG?**
- **Persistenz**: Daten bleiben beim View-Wechsel erhalten
- **"Wo war ich?"**: Scroll-Position, Video-Zeit wird gespeichert
- **Single Source of Truth**: Nur ein Ort für Daten = keine Duplikate

### **HAUPTFUNKTIONEN**

#### **Items Management**
```javascript
state.setItems(items)              // Speichert alle Media-Items
state.getItems()                   // Holt alle Items
state.getItemsForFolder('Urlaub')  // Nur Items in diesem Ordner
state.getFolderStructure()         // Ordner-Baum
```

#### **Navigation**
```javascript
state.setCurrentFolder('Urlaub/2024')  // Wechselt Ordner
state.getCurrentFolder()               // Aktueller Ordner
state.navigateUp()                     // Ein Ordner hoch
state.navigateInto('Sommer')           // In Unterordner
```

#### **Collapse/Expand**
```javascript
state.collapseFolder('Urlaub/2024')    // Ordner einklappen
state.expandFolder('Urlaub/2024')      // Ordner aufklappen
state.isFolderCollapsed('...')         // Ist eingeklappt?
state.toggleFolderCollapse('...')      // Toggle
```

#### **Video State**
```javascript
state.saveVideoState(path, time, playing)  // Video-Position speichern
state.getVideoState(path)                  // Position laden
// → Wenn User zurückkommt, spielt Video weiter wo aufgehört
```

#### **Scroll-Position**
```javascript
state.saveScrollPosition('grid', 500)  // Speichert Scroll
state.getScrollPosition('grid')        // Lädt Scroll
// → Grid merkt sich wo du warst
```

#### **Filter & Sort**
```javascript
state.setFilter('showVideos', true)
state.setSortBy('created-desc')
state.applyFiltersAndSort(items)  // Wendet an
```

#### **Events**
```javascript
state.on('items-changed', () => { ... })
state.on('folder-changed', () => { ... })
state.on('folder-collapsed', () => { ... })
// → Views reagieren automatisch auf Änderungen
```

### **DATEN-STRUKTUR**

```javascript
State = {
  items: [
    {
      type: 'video',           // oder 'image'
      path: 'C:/Videos/movie.mp4',
      name: 'movie.mp4',
      folder: 'Urlaub/2024',   // Relativer Pfad
      created: 1234567890,     // Timestamp
      modified: 1234567890,
      size: 1024000,           // Bytes
      duration: 120.5,         // Sekunden
      format: 'mp4',
      needsTranscode: false,
      transcoded: false,
      transcodePath: null,
      tags: ['Urlaub'],
      collapsed: false,        // Für Ordner
      depth: 2
    }
  ],
  
  rootPath: 'C:/Videos',
  currentFolder: 'Urlaub/2024',
  
  collapsedFolders: Set(['Urlaub/2023']),
  
  scrollPositions: {
    grid: 0,
    detail: 0
  },
  
  videoPlaybackStates: Map<path, {currentTime, wasPlaying}>
}
```

---

## 📄 DATEI 2: `grid-view.html`

### **ZWECK**
Visuelle Darstellung mit Videos/Bildern

### **FEATURES**

#### **1. Lazy Loading**
```javascript
// Intersection Observer
// → Nur Videos im Viewport werden geladen
// → Spart RAM und CPU
observer.observe(element);
```

#### **2. Ordner-Navigation**
```
🏠 Videos / Urlaub / 2024 / Sommer
      ↑       ↑       ↑       ↑
    Root   Klickbar Klickbar Aktiv
```

#### **3. Video Auto-Play**
```
Im Viewport     → Video spielt (muted)
Hover           → Ton an
Aus Viewport    → Video pausiert
```

#### **4. Fullscreen**
```
Linksklick      → Fullscreen + Ton an
Andere Videos   → Pausieren
Leertaste halten → 2x Speed
Click im Fullscreen → Pause/Play
ESC             → Fullscreen schließen
```

#### **5. Ordner Collapse**
```
Normal:
📁 Urlaub
  └─ 🎬 video1.mp4
  └─ 🎬 video2.mp4
  └─ 🖼️ image1.jpg

Collapsed (Rechtsklick → "Einklappen"):
📁 Urlaub (eingeklappt)
```

#### **6. Context Menu**
```
Rechtsklick →
  ▶️ In PotPlayer öffnen
  📁 Im Explorer zeigen
  ━━━━━━━━━━━━━━━
  📂 Ordner einklappen
  📂 Ordner aufklappen
  ━━━━━━━━━━━━━━━
  ⚙️ Transkodieren
```

#### **7. Folder Label**
```
┌─────────────────┐
│                 │
│  Video Inhalt   │
│                 │
│  [Urlaub]       │ ← Folder Name
└─────────────────┘
```

### **WICHTIGE FUNKTIONEN**

```javascript
// Initialisierung
init()                          // Setup alles
setupEventListeners()           // Events registrieren
setupContextMenu()              // Rechtsklick-Menü
setupFullscreen()               // Fullscreen-Player

// Rendering
render()                        // Rendert Grid neu
groupItemsBySubfolder()         // Gruppiert nach Ordner
renderFolder()                  // Rendert Ordner-Icon
renderItem()                    // Rendert Video/Bild

// Intersection Observer
handleIntersection()            // Video Play/Pause

// Navigation
updateBreadcrumb()              // Ordner-Pfad oben

// Context Menu
showContextMenu()               // Menü anzeigen
handleContextAction()           // Aktion ausführen

// Fullscreen
openFullscreen()                // Video in Fullscreen
closeFullscreen()               // Fullscreen schließen
openImageFullscreen()           // Bild in Fullscreen
```

### **CSS-KLASSEN**

```css
.grid-item                      /* Container */
.grid-item video/img            /* Media-Element */
.folder-label                   /* Ordner-Name unten */
.folder-collapsed               /* Eingeklappter Ordner */
.info-badge                     /* Transcode-Status */
.context-item                   /* Context-Menu-Eintrag */
.fullscreen-overlay             /* Fullscreen-Background */
.speed-indicator                /* "2x Speed" Anzeige */
```

---

## 📄 DATEI 3: `detail-view.html` (musst du erstellen)

### **STRUKTUR**

```html
<div id="detail-container">
  <div id="filters">
    <!-- Filter: Videos, Bilder, etc. -->
  </div>
  
  <table id="detail-table">
    <thead>
      <tr>
        <th>Typ</th>
        <th>Preview</th>
        <th>Name</th>
        <th>Ordner</th>
        <th>Größe</th>
        <th>Datum</th>
        <th>Tags</th>
        <th>Aktionen</th>
      </tr>
    </thead>
    <tbody>
      <!-- Zeilen hier -->
    </tbody>
  </table>
</div>
```

### **UNTERSCHIED ZU GRID**

Grid View:
- ✅ Visuell
- ✅ Ordner-Navigation
- ✅ Videos spielen automatisch

Detail View:
- ✅ Tabellarisch
- ✅ Alle Infos sichtbar
- ✅ Sortierbar
- ✅ Filterbar
- ✅ Keine Ordner-Hierarchie (flach)
- ✅ Ordner als Text-Spalte

### **WICHTIGE FUNKTIONEN**

```javascript
renderTable()                   // Rendert Tabelle
createRow(item)                 // Erstellt Zeile
handleSort(column)              // Sortiert nach Spalte
handleFilter()                  // Filtert Items
showPreview(item)               // Hover-Preview
```

---

## 📄 DATEI 4: `index.html` (Router)

### **ZWECK**
Lädt die Views und zeigt Topbar

### **STRUKTUR**

```html
<div id="topbar">
  <div class="tabs">
    <button onclick="showView('grid')">Grid</button>
    <button onclick="showView('detail')">Detail</button>
  </div>
  
  <div class="controls">
    <button onclick="selectFolder()">Ordner wählen</button>
    <button onclick="scanMedia()">Scannen</button>
  </div>
  
  <div class="info">
    <span id="info-root">Kein Ordner</span>
    <span id="info-count">0 Medien</span>
  </div>
</div>

<iframe id="view-grid" src="grid-view.html"></iframe>
<iframe id="view-detail" src="detail-view.html" style="display:none;"></iframe>
```

### **FUNKTIONEN**

```javascript
selectFolder()    → Ordner-Dialog
scanMedia()       → Backend-Scan
showView(name)    → View wechseln
updateInfo()      → Info-Anzeige
```

---

## 🔄 DATENFLUSS

```
1. USER: Klickt "Ordner wählen"
   ↓
2. index.html: selectFolder()
   ↓
3. main.js: IPC 'select-folder'
   ↓
4. Dialog öffnet sich
   ↓
5. User wählt Ordner
   ↓
6. main.js: Gibt Pfad zurück
   ↓
7. index.html: Speichert in State
   ↓
8. state.setRootPath(path)
   ↓
9. Event 'root-changed' wird ausgelöst
   ↓
10. Views reagieren (wenn nötig)


1. USER: Klickt "Scannen"
   ↓
2. index.html: scanMedia()
   ↓
3. main.js: IPC 'scan-media'
   ↓
4. main.js: Scannt rekursiv
   ↓
5. main.js: Speichert in media_data.json
   ↓
6. main.js: Gibt Items zurück
   ↓
7. index.html: state.setItems(items)
   ↓
8. Event 'items-changed'
   ↓
9. grid-view.html: render()
   ↓
10. Items werden angezeigt
```

---

## 🎓 DESIGN-PRINZIPIEN

### **1. Single Responsibility**
Jede Datei hat EINEN Zweck:
- `main.js` → Backend
- `state.js` → Daten
- `grid-view.html` → Visuelle Darstellung
- `detail-view.html` → Tabelle

### **2. Event-basierte Kommunikation**
Views kommunizieren nicht direkt:
```javascript
// ❌ FALSCH
gridView.updateItems(items);

// ✅ RICHTIG
state.setItems(items);  // Event wird ausgelöst
// Grid-View hört auf Event und updated sich selbst
```

### **3. State als Single Source of Truth**
```javascript
// ❌ FALSCH
let gridItems = [...];
let detailItems = [...];  // Duplikat!

// ✅ RICHTIG
state.items = [...];      // Eine Quelle
// Alle Views lesen daraus
```

### **4. Immutability wo möglich**
```javascript
// ✅ GUT
const items = state.getItems();
const filtered = items.filter(...);  // Original unverändert
```

### **5. Klare Namensgebung**
```javascript
// Funktionen: Verb + Noun
renderItem()
updateBreadcrumb()
handleIntersection()

// Variablen: Noun
currentItems
allVideos
contextMenuItem
```

---

## 🔧 WAS MUSST DU NOCH TUN?

### **1. `detail-view.html` erstellen**

Orientiere dich an `grid-view.html`:

```javascript
// Init
function init() {
  state = parent.AppState.getInstance();
  setupEventListeners();
  render();
}

// Event Listeners
function setupEventListeners() {
  state.on('items-changed', render);
  state.on('filter-changed', render);
  state.on('sort-changed', render);
}

// Render
function render() {
  const items = state.getItems();
  const filtered = state.applyFiltersAndSort(items);
  
  const tbody = document.querySelector('tbody');
  tbody.innerHTML = '';
  
  filtered.forEach(item => {
    const row = createRow(item);
    tbody.appendChild(row);
  });
}

// Row erstellen
function createRow(item) {
  const tr = document.createElement('tr');
  
  tr.innerHTML = `
    <td>${getIcon(item.type)}</td>
    <td><img src="file:///${item.path}" width="60"></td>
    <td>${item.name}</td>
    <td>${item.folder || '-'}</td>
    <td>${formatBytes(item.size)}</td>
    <td>${formatDate(item.created)}</td>
    <td>${item.tags.join(', ')}</td>
    <td>
      <button onclick="openInExplorer('${item.path}')">📁</button>
      <button onclick="playInPotPlayer('${item.path}')">▶️</button>
    </td>
  `;
  
  // Context Menu
  tr.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, item);
  });
  
  return tr;
}
```

### **2. `index.html` vervollständigen**

```html
<!-- WICHTIG: State laden -->
<script src="state.js"></script>

<script>
const state = AppState.getInstance();

async function selectFolder() {
  const path = await window.electron.invoke('select-folder');
  if (path) {
    state.setRootPath(path);
    updateInfo();
  }
}

async function scanMedia() {
  const path = state.getRootPath();
  if (!path) return;
  
  const result = await window.electron.invoke('scan-media', path);
  
  if (result.success) {
    state.setItems(result.items);
    updateInfo();
  }
}

function showView(viewName) {
  // Alle iframes verstecken
  document.querySelectorAll('iframe').forEach(iframe => {
    iframe.style.display = 'none';
  });
  
  // Gewählten iframe zeigen
  document.getElementById(`view-${viewName}`).style.display = 'block';
}

function updateInfo() {
  const stats = state.getStats();
  
  document.getElementById('info-root').textContent = 
    state.getRootFolderName();
  
  document.getElementById('info-count').textContent = 
    `${stats.total} Medien (${stats.videos} Videos, ${stats.images} Bilder)`;
}
</script>
```

### **3. Styles anpassen**

Du kannst deine vorhandene `style.css` weiterverwenden!

Wichtig nur:
```css
/* object-fit: contain für Aspect Ratio */
.grid-item video,
.grid-item img {
  object-fit: contain;  /* NICHT cover! */
}
```

---

## 🚀 NÄCHSTE SCHRITTE

1. ✅ **Teste die 3 Kern-Dateien**
   - `state.js`
   - `grid-view.html`
   - `main.js` (Backend)

2. 🔨 **Erstelle `index.html`**
   - Topbar
   - View Switching
   - Info-Anzeige

3. 🔨 **Erstelle `detail-view.html`**
   - Tabelle
   - Filter
   - Sort

4. ✨ **Teste Features**
   - Ordner-Navigation
   - Video Fullscreen
   - Context Menu
   - Collapse/Expand

5. 🎯 **Erweitere**
   - Tag-Verwaltung
   - Multi-Select
   - Batch-Operationen

---

## 💡 DEBUGGING-TIPPS

### **Console Logging**
Alle wichtigen Aktionen werden geloggt:
```
[STATE] Initialized
[GRID] Initialisiere...
[GRID] Render Start
[GRID] Zeige 150 Items
[GRID] Render Complete
```

### **State Debug**
```javascript
// In Browser Console:
state.debug();

// Output:
{
  items: 150,
  rootPath: 'C:/Videos',
  currentFolder: 'Urlaub/2024',
  collapsedFolders: ['Urlaub/2023'],
  stats: { ... }
}
```

### **Event Debugging**
```javascript
// Alle Events loggen
state.on('items-changed', () => console.log('Items changed'));
state.on('folder-changed', () => console.log('Folder changed'));
```

---

## 📚 ZUSAMMENFASSUNG

### **Kern-Architektur:**
```
Backend (main.js)
    ↕
State (state.js)    ← Single Source of Truth
    ↕
Views (grid-view.html, detail-view.html)
```

### **Vorteile:**
✅ Wartbar
✅ Erweiterbar
✅ Debuggbar
✅ Performant
✅ Testbar

### **Nächste Features:**
- Tag-Verwaltung (`tags-view.html`)
- Multi-Select
- Batch-Operationen
- Favoriten
- Playlisten

---

## 🎯 FRAGEN?

Schau in die Dateien:
- `state.js` → Alle Helper-Funktionen dokumentiert
- `grid-view.html` → Vollständig kommentiert
- Dieser Guide → Alles erklärt

**Bei Problemen:**
1. Console checken (Logging)
2. `state.debug()` aufrufen
3. Events prüfen