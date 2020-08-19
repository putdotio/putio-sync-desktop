const path = require('path')
const { app, Menu, Tray } = require('electron')

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit()
}

const iconPath = path.join(__dirname, 'IconTemplate.png')

let tray = null

app.whenReady().then(() => {
  tray = new Tray(iconPath)
  const contextMenu = Menu.buildFromTemplate([
    {label: 'TODO Sync Status', id: 'syncStatus', enabled: false},
    {label: 'Quit', role: 'quit'},
  ])
  tray.setContextMenu(contextMenu)
})
