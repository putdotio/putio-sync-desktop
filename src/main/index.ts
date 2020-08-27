import { app, Menu, Tray, net } from 'electron'
import * as path from 'path'
import { spawn } from 'child_process'
import * as getPort from 'get-port'

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit()
}

declare var __static: string
const iconPath = path.join(__static, 'img', 'IconTemplate.png')
const host = '127.0.0.1'

function createMenu (syncStatus: string) {
  return Menu.buildFromTemplate([
    { label: syncStatus, id: 'syncStatus', enabled: false },
    { label: 'Quit', role: 'quit' }
  ])
}

app.on('ready', () => {
  const tray = new Tray(iconPath)
  tray.setContextMenu(createMenu('Starting to sync...'))
  getPort({ host: host }).then(port => {
    const ls = spawn(path.join(__static, 'bin', 'putio-sync'), ['-repeat', '10s', '-server', host + ':' + port], { stdio: ['ignore', 'ignore', 'pipe'] })
    ls.stderr.on('data', (data) => { console.log(String(data).trim()) })
    ls.on('close', (code) => { console.log(`child process exited with code ${code}`) })
    setInterval(() => {
      const statusURL = `http://${host}:${port}/status`
      const request = net.request(statusURL)
      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          return
        }
        response.on('data', (chunk) => {
          let parsed = null
          try {
            parsed = JSON.parse(String(chunk))
          } catch (e) {
            return
          }
          tray.setContextMenu(createMenu(parsed.status))
        })
      }).on('error', (error) => {
        console.log(`ERROR: ${error}`)
      }).end()
    }, 1000)
  })
})
