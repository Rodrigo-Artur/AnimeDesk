const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('animeDesk', {
  platform: process.platform,
  desktop: true,
});
