import { app, Menu, Tray, net, shell, dialog, BrowserWindow } from 'electron'
import * as path from 'path'
import { spawn, spawnSync } from 'child_process'
import * as getPort from 'get-port'
import * as log from 'electron-log'
import * as os from 'os'
import * as fs from 'fs'
import settings from 'electron-settings'
import { autoUpdater } from 'electron-updater'
import * as Sentry from '@sentry/electron'
import * as querystring from 'querystring'
import PutioAPI from '@putdotio/api-client'

const isProduction = process.env.NODE_ENV === 'production'

// We initialize Sentry plugin first to capture all exceptions.
const sentryDsn = process.env.ELECTRON_WEBPACK_APP_SENTRY_DSN
if (sentryDsn) {
  log.info('Initializing Sentry') // This log is here to ensure that Sentry DSN is set by Webpack on build correctly.
  Sentry.init({ dsn: sentryDsn, debug: !isProduction })
} else {
  // Hooking to unhandledRejection event prevents Sentry from collecting them.
  // Maybe this is a bug or I didn't understand how it works :(
  process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason)
  })
}

// quitApp must be called instead of app.quit() to allow Sentry to flush queued events before exit.
async function quitApp () {
  if (sentryDsn) await Sentry.close(2000)
  app.quit()
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  quitApp()
}

declare var __static: string
const iconPath = path.join(__static, 'img', process.platform === 'win32' ? 'tray-icon.ico' : 'tray-icon.png')
const host = '127.0.0.1'
const logPath = log.transports.file.getFile().path
const binPath = path.join(__static, 'bin')
const exitCodeConfigError = 10
const exitCodeAuthenticationError = 11
const oauthClientID = 4865
const authParams = {
  response_type: 'token',
  client_id: oauthClientID,
  client_name: os.hostname(),
  redirect_uri: 'http://localhost',
  isolated: true,
  popup: true
}
const authURL = `https://api.put.io/v2/oauth2/authenticate?${querystring.stringify(authParams)}`
const exe = os.platform() === 'win32' ? 'putio-sync.exe' : 'putio-sync'
const configPath = String(spawnSync(path.join(binPath, exe), ['-print-config-path']).stdout).trim()
const API = new PutioAPI({ clientID: oauthClientID })

var isLoginWindowOpen = false
var pendingUpdate = false

log.info(`Starting putio-sync-desktop version: ${app.getVersion()}`)
log.info(`Settings file: ${settings.file()}`)

async function openConfig () {
  // shell.openPath does not work if target does not exist
  fs.closeSync(fs.openSync(configPath, 'a'))
  await shell.openPath(configPath)
}

function onAutoLaunchClick (menuItem: any) {
  app.setLoginItemSettings({ openAtLogin: menuItem.checked })
}

function createMenu (syncStatus: string) {
  return Menu.buildFromTemplate([
    { label: 'Go to put.io', click: () => { shell.openExternal('https://put.io') } },
    { label: syncStatus, id: 'syncStatus', enabled: false },
    { label: 'Launch on startup', id: 'autoLaunch', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: onAutoLaunchClick },
    { label: 'Open log file', click: () => { shell.openPath(logPath) } },
    { label: 'Logout', click: async () => { await settings.unset('token'); quitApp() } },
    { label: 'Quit', click: quitApp }
  ])
}

function onAppReady () {
  if (isProduction && !settings.getSync('setAutoLaunch')) {
    log.info('First run of the application. Setting app to launch on login.')
    app.setLoginItemSettings({ openAtLogin: true })
    settings.set('setAutoLaunch', true)
  }

  const tray = new Tray(iconPath)
  tray.setToolTip('Putio Sync')
  tray.setContextMenu(createMenu('Starting to sync...'))
  tray.on('drop-text', async (event, text) => {
    if (!text.startsWith('magnet:')) {
      return
    }
    if (!API.token) {
      return
    }
    API.Transfers.Add({ url: text, saveTo: 0 })
  })

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
          // Menu contains an item that shows the current status of sync operation.
          // Changing MenuItem titles is not allowed. That's why always a new Menu is created.
          tray.setContextMenu(createMenu(parsed.status))
        })
      })
      request.on('error', (error) => {
        log.error(`ERROR: ${error}`)
      })
      request.end()
    }, 1000)

    const env = Object.create(process.env)
    env.PASSWORD = `token/${await settings.get('token')}`
    env.REPEAT = '1m'
    env.SERVER = host + ':' + port
    const child = spawn(path.join(binPath, exe), [], { stdio: ['ignore', 'ignore', 'pipe'], env: env })
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
          quitApp()
          break
        }
        case exitCodeAuthenticationError: {
          isLoginWindowOpen = true
          const window = new BrowserWindow({ title: 'Login to put.io', backgroundColor: '#333333' })
          window.removeMenu()
          var gotToken = false
          window.on('close', async () => {
            await window.webContents.session.clearStorageData()
          })
          window.on('closed', () => {
            isLoginWindowOpen = false
            if (pendingUpdate) {
              autoUpdater.quitAndInstall(true, true)
            } else {
              gotToken ? startApp() : quitApp()
            }
          })
          window.on('page-title-updated', (event) => {
            event.preventDefault()
          })
          window.webContents.on('will-redirect', async (event, url) => {
            if (url.startsWith('http://localhost')) {
              event.preventDefault()
              const parsedHash = new URLSearchParams(url.split('#', 2)[1])
              const token = parsedHash.get('access_token')
              if (token) {
                API.setToken(token)
                await settings.set('token', token)
              }
              gotToken = true
              window.close()
            }
          })
          window.webContents.on('new-window', function (event, url) {
            event.preventDefault()
            shell.openExternal(url)
          })
          window.loadURL(authURL)
          break
        }
        default: {
          quitApp()
        }
      }
    })
  }

  startApp()
  if (isProduction) {
    checkUpdate()
    setInterval(() => {
      checkUpdate()
    }, 10 * 60 * 1000)
  }
}

let checkingUpdate = false
async function checkUpdate () {
  if (checkingUpdate) {
    return
  }
  checkingUpdate = true
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    checkingUpdate = false
  }
}

autoUpdater.logger = log
autoUpdater.on('error', () => { checkingUpdate = false })
autoUpdater.on('update-not-available', () => { checkingUpdate = false })
autoUpdater.on('update-downloaded', () => {
  log.warn('Update downloaded, application will be quit for update.')
  if (isLoginWindowOpen) {
    pendingUpdate = true
  } else {
    autoUpdater.quitAndInstall(true, true)
  }
})
autoUpdater.on('download-progress', (progressObj) => { log.info(`Update download speed: ${(progressObj.bytesPerSecond / 1024).toFixed()} KBps, downloaded: ${progressObj.percent.toFixed(2)} %`) })

// do not quit application when main window is closed
app.on('window-all-closed', () => {})

if (app.requestSingleInstanceLock()) {
  app.on('ready', onAppReady)
  settings.get('token').then((token) => { API.setToken(token as string) })
} else {
  log.warn('An instance of Putio Sync is already running. Quitting this instance.')
  quitApp()
}
