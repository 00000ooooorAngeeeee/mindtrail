// Electron 主进程入口：单实例锁、窗口、后端进程生命周期（04 §6.5、10 §9）。
const { app, BrowserWindow, dialog } = require('electron')
const path = require('path')
const { start, stop } = require('./backend-process')

const BACKEND_PORT = 17860
const DEV_SERVER_URL = process.env.TRAILMIND_DEV_URL || 'http://localhost:5173'
// 开发期后端 jar 路径（打包期由 electron-builder extraResources 携带，路径见 loadBackendJarPath）
const DEV_JAR = path.join(__dirname, '..', '..', 'backend', 'target', 'trailmind-backend-0.0.1.jar')

let mainWindow = null
let backend = null // { child, healthy }
let quitting = false

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 第二实例：不重复拉后端，直接退出交给已有实例
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // 后端启动遮罩：健康等待期间窗口先显示该 splash，就绪后再切到前端
  const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(
    '<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fff;color:#444"><h2>正在启动后端…</h2></body>',
  )}`

  function loadBackendJarPath() {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'backend', 'trailmind-backend-0.0.1.jar')
    }
    return DEV_JAR
  }

  function loadFrontend() {
    if (app.isPackaged) {
      mainWindow.loadFile(path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html'))
    } else {
      mainWindow.loadURL(DEV_SERVER_URL)
    }
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 600,
      title: '思迹 TrailMind',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    mainWindow.loadURL(SPLASH)
  }

  app.whenReady().then(async () => {
    createWindow()
    try {
      backend = await start({ jarPath: loadBackendJarPath(), port: BACKEND_PORT })
      // 健康等待超时但进程已拉起：仍加载前端，前端会显示「后端未连接」态
    } catch (err) {
      dialog.showErrorBox('思迹 TrailMind 启动失败', err.message)
      app.quit()
      return
    }
    loadFrontend()
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    if (!backend) return
    event.preventDefault()
    quitting = true
    stop(backend).finally(() => app.exit(0))
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
