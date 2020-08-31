import { app, Menu, Tray, net, shell, dialog } from 'electron'
import * as path from 'path'
import { spawn, spawnSync } from 'child_process'
import * as getPort from 'get-port'
import * as log from 'electron-log'
import * as os from 'os'
import * as fs from 'fs'

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit()
}

declare var __static: string
const iconPath = path.join(__static, 'img', 'IconTemplate.png')
const host = '127.0.0.1'
const logPath = log.transports.file.getFile().path
const binPath = path.join(__static, 'bin')
const exitCodeConfigError = 10
var exe = 'putio-sync'
if (os.platform() === 'win32') {
  exe += '.exe'
}
const configPath = String(spawnSync(path.join(binPath, exe), ['-print-config-path']).stdout).trim()

async function openConfig () {
  fs.closeSync(fs.openSync(configPath, 'a'))
  await shell.openPath(configPath)
}

function restartApp () {
  app.relaunch()
  app.exit()
}

function createMenu (syncStatus: string) {
  return Menu.buildFromTemplate([
    { label: syncStatus, id: 'syncStatus', enabled: false },
    { label: 'Open config file', click: openConfig },
    { label: 'Open log file', click: () => { shell.openPath(logPath) } },
    { label: 'Restart', click: restartApp },
    { label: 'Quit', role: 'quit' }
  ])
}

app.on('ready', () => {
  const tray = new Tray(iconPath)
  tray.setContextMenu(createMenu('Starting to sync...'))
  getPort({ host: host }).then(port => {
    const child = spawn(path.join(binPath, exe), ['-repeat', '1m', '-server', host + ':' + port], { stdio: ['ignore', 'pipe', 'pipe'] })
    var stdout = ''
    child.stdout.on('data', (data) => { stdout += String(data) })
    child.stderr.on('data', (data) => { log.info(String(data).trim()) })
    child.on('close', (code) => {
      log.error(`child process exited with code ${code}`)
      if (code === exitCodeConfigError) {
        if (!fs.existsSync(configPath)) {
          // Put default config file with some placeholders.
          fs.writeFileSync(configPath, 'username = ""\npassword = ""\n')
        }
        dialog.showMessageBoxSync({
          type: 'error',
          title: 'Error in config',
          message: 'Error in config: ' + stdout.trim(),
          detail: 'Press OK to edit config file. Relaunch the app after editing config.'
        })
        openConfig()
        app.quit()
      }
    })
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
      })
      request.on('error', (error) => {
        log.error(`ERROR: ${error}`)
      })
      request.end()
    }, 1000)
  })
})
