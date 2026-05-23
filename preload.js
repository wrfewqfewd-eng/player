const { contextBridge, ipcRenderer } = require('electron');

console.log('[PRELOAD] Wird geladen...');

const INVOKE_CHANNELS = [
  'select-json-file',
  'select-folder',
  'prepare-media-cache',
  'request-next-chunk',
  'abort-load-session',
  'get-system-status',
  'start-system-monitor',
  'stop-system-monitor',
  'show-in-explorer',
  'open-with-potplayer',
  'scan-media',
  'abort-scan',
  'transcode-video',
  'update-item',
  'add-tag',
  'remove-tag'
];

const LISTEN_CHANNELS = [
  'system-status-update',
  'scan-progress',
  'scan-progress-update',
  'duration-progress',
  'transcode-progress'
];

contextBridge.exposeInMainWorld('electron', {

  invoke: async (channel, ...args) => {
    if (!INVOKE_CHANNELS.includes(channel)) {
      throw new Error(`[PRELOAD] Nicht erlaubter Kanal: "${channel}"`);
    }
    try {
      return await ipcRenderer.invoke(channel, ...args);
    } catch (error) {
      console.error(`[PRELOAD] invoke("${channel}") Fehler:`, error.message);
      throw error;
    }
  },

  on: (channel, callback) => {
    if (!LISTEN_CHANNELS.includes(channel)) {
      console.error(`[PRELOAD] Nicht erlaubter Listen-Kanal: "${channel}"`);
      return;
    }
    ipcRenderer.on(channel, (event, data) => callback(data));
  },

  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  }

});

console.log(`[PRELOAD] Bereit · ${INVOKE_CHANNELS.length} invoke · ${LISTEN_CHANNELS.length} listen`);