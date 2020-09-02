import { app, Menu, Tray, net, shell, dialog, BrowserWindow } from 'electron'
import * as path from 'path'
import { spawn, spawnSync } from 'child_process'
import * as getPort from 'get-port'
import * as log from 'electron-log'
import * as os from 'os'
import * as fs from 'fs'
import settings from 'electron-settings'
import { autoUpdater } from 'electron-updater'

process.on('unhandledRejection', (reason, p) => {
  log.error('Unhandled Rejection at:', p, 'reason:', reason)
  process.exit(1)
})

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
const exitCodeAuthenticationError = 11
const authURL = 'https://api.put.io/v2/oauth2/authenticate?response_type=token&client_id=4785&redirect_uri=http%3A%2F%2Flocalhost'
const exe = os.platform() === 'win32' ? 'putio-sync.exe' : 'putio-sync'
const configPath = String(spawnSync(path.join(binPath, exe), ['-print-config-path']).stdout).trim()
const isProduction = process.env.NODE_ENV === 'production'
var isLoginWindowOpen = false
var pendingUpdate = false

log.info(`Settings file: ${settings.file()}`)

async function openConfig () {
  // shell.openPath does not work if target does not exist
  fs.closeSync(fs.openSync(configPath, 'a'))
  await shell.openPath(configPath)
}

function onAutoLaunchClick (menuItem: any) {
  console.log(`is auto-launch menu item checked: ${menuItem.checked}`)
  app.setLoginItemSettings({ openAtLogin: menuItem.checked })
}

function createMenu (syncStatus: string) {
  return Menu.buildFromTemplate([
    { label: syncStatus, id: 'syncStatus', enabled: false },
    { label: 'Launch on startup', id: 'autoLaunch', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: onAutoLaunchClick },
    // { label: 'Open config file', click: openConfig },
    { label: 'Open log file', click: () => { shell.openPath(logPath) } },
    { label: 'Logout', click: async () => { await settings.unset('token'); app.quit() } },
    // { label: 'Restart', click: () => { app.relaunc(); app.quit() } },
    { label: 'Quit', role: 'quit' }
  ])
}

// do not quit application when main window is closed
app.on('window-all-closed', () => {})

app.on('ready', () => {
  if (isProduction && !settings.getSync('setAutoLaunch')) {
    log.info('First run of the application. Setting app to launch on login.')
    app.setLoginItemSettings({ openAtLogin: true })
    settings.set('setAutoLaunch', true)
  }

  const tray = new Tray(iconPath)
  tray.setContextMenu(createMenu('Starting to sync...'))

  async function startApp () {
    const port = await getPort({ host: host })
    const timer = setInterval(() => {
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

    const token = await settings.get('token')
    const child = spawn(path.join(binPath, exe), ['-repeat', '1m', '-server', host + ':' + port, '-password', `token/${token}`], { stdio: ['ignore', 'ignore', 'pipe'] })
    app.once('before-quit', () => { child.kill('SIGKILL') })
    var lastStderrLine = ''
    child.stderr.on('data', (data) => {
      lastStderrLine = String(data).trim()
      log.info(lastStderrLine)
    })
    child.on('close', async (code) => {
      log.error(`child process exited with code ${code}`)
      clearInterval(timer)
      switch (code) {
        case exitCodeConfigError: {
          if (!fs.existsSync(configPath)) {
            // Put default config file with some placeholders.
            fs.writeFileSync(configPath, 'username = ""\npassword = ""\n')
          }
          dialog.showMessageBoxSync({
            type: 'error',
            title: 'Error in config',
            message: 'Error in config: ' + lastStderrLine,
            detail: 'Press OK to edit config file. Relaunch the app after editing config.'
          })
          openConfig()
          app.quit()
          break
        }
        case exitCodeAuthenticationError: {
          isLoginWindowOpen = true
          const window = new BrowserWindow()
          window.removeMenu()
          var gotToken = false
          window.on('closed', () => {
            isLoginWindowOpen = false
            if (pendingUpdate) {
              autoUpdater.quitAndInstall(true, true)
            } else {
              gotToken ? startApp() : app.quit()
            }
          })
          await window.webContents.session.clearStorageData()
          window.webContents.on('will-redirect', async (event, url) => {
            if (url.startsWith('http://localhost')) {
              event.preventDefault()
              const parsedHash = new URLSearchParams(url.split('#', 2)[1])
              const token = parsedHash.get('access_token')
              await settings.set('token', token)
              gotToken = true
              window.close()
            }
          })
          window.loadURL(authURL)
          break
        }
        default: {
          app.quit()
        }
      }
    })
  }

  startApp()
  if (isProduction) {
    checkUpdate()
    setTimeout(() => {
      checkUpdate()
    }, 10 * 60 * 1000)
  }
})

let checkingUpdate = false
function checkUpdate () {
  if (checkingUpdate) {
    return
  }
  checkingUpdate = true
  autoUpdater.checkForUpdates()
}

autoUpdater.logger = log
autoUpdater.on('error', (err) => {
  log.error(err === null ? 'unknown updater error' : (err.stack || err).toString())
  checkingUpdate = false
})
autoUpdater.on('checking-for-update', () => { log.info('Checking for update...') })
autoUpdater.on('update-available', () => { log.info('Update available.') })
autoUpdater.on('update-not-available', () => {
  log.info('Current version is up-to-date.')
  checkingUpdate = false
})
autoUpdater.on('update-downloaded', () => {
  log.info('Update downloaded, application will be quit for update.')
  if (isLoginWindowOpen) {
    pendingUpdate = true
  } else {
    autoUpdater.quitAndInstall(true, true)
  }
})
autoUpdater.on('download-progress', (progressObj) => { log.info(`Update download speed: ${(progressObj.bytesPerSecond / 1024).toFixed()} KBps, downloaded: ${progressObj.percent.toFixed(2)} %`) })
