const { app, BrowserWindow } = require('electron');
const { menubar } = require('menubar');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}

const mb = menubar({"dir": "src"});

mb.on('ready', () => {
	console.log('Menubar app is ready.');
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
