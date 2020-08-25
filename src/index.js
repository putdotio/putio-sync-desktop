const path = require('path')
const { app, Menu, Tray, net } = require('electron')
const { spawn } = require('child_process');
const getPort = require('get-port');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit()
}

// TODO maybe use __dirname instead of path.resolve()
const appPath = app.getAppPath()
const iconPath = path.join(appPath, 'img', 'IconTemplate.png')
const host = '127.0.0.1'
let port = null
let tray = null
let menu = null

function createMenu(syncStatus) {
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
      try {
        var parsed = JSON.parse(chunk)
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
  const ls = spawn(path.join(appPath, 'bin', 'putio-sync'), ['-repeat', '10s', '-server', host + ':' + port], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  ls.stderr.on('data', (data) => {
    console.log(String(data).trim())
  });

  ls.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
  });
})

