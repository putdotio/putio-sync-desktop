import { app, Menu, Tray, net } from 'electron';
import * as path from 'path';
import { spawn } from 'child_process';
import * as getPort from 'get-port';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit()
}

const iconPath = path.join(app.getAppPath(), 'img', 'IconTemplate.png')
const host = '127.0.0.1'
let port: number = null
let tray: Tray = null
let menu: Menu = null

function createMenu(syncStatus: string) {
  return Menu.buildFromTemplate([
    {label: syncStatus, id: 'syncStatus', enabled: false},
    {label: 'Quit', role: 'quit'},
  ])
}

app.on('ready', () => {
  tray = new Tray(iconPath)
  menu = createMenu('Starting to sync...')
  tray.setContextMenu(menu)
  setInterval(updateStatus, 1000);
})

function updateStatus() {
  if (!port) {
    return
  }
  const statusURL = `http://${host}:${port}/status`
  const request = net.request(statusURL)
  request.on('response', (response) => {
    if (response.statusCode != 200) {
      return
    }
    response.on('data', (chunk) => {
      let parsed = null
      try {
        parsed = JSON.parse(String(chunk))
      } catch(e) {
        return
      }
      menu = createMenu(parsed.status)
      tray.setContextMenu(menu)
    })
  }).on('error', (error) => {
    console.log(`ERROR: ${error}`)
  }).end();
}

getPort({host: host}).then(foundPort => {
  port = foundPort
  const ls = spawn(path.join(app.getAppPath(), 'bin', 'putio-sync'), ['-repeat', '10s', '-server', host + ':' + port], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  ls.stderr.on('data', (data) => {
    console.log(String(data).trim())
  });

  ls.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
  });
})

