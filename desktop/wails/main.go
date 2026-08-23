package main

import (
	"embed"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"trailmind-shell/internal/orchestrator"
)

//go:embed all:frontend
var assets embed.FS

// appDir 返回壳 exe 所在目录（%APPDIR%）。release 组装后 mariadb/ 与 trailmind-backend/ 与之同级（设计 §4.6 步骤 7）。
func appDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

// runWindow 打开壳窗口：内嵌重定向页 → 立即跳转后端同源前端 http://127.0.0.1:17860（设计 §4.4）。
func runWindow(app *App) error {
	return wails.Run(&options.App{
		Title:  "思迹 TrailMind",
		Width:  1280,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
	})
}

func main() {
	app := NewApp()

	if bindingsMode {
		// 绑定生成模式：不起进程、不开窗（App.Run 生成绑定后退出）。
		if err := runWindow(app); err != nil {
			println("Error:", err.Error())
		}
		return
	}

	shell := orchestrator.New(orchestrator.DefaultDeps())
	// 完整编排（设计 §3、§6）：起 mariadb（13306）→ 起 backend（注入 DB env）→ 开窗加载 17860 →
	// 关窗后反序停 backend（优雅 shutdown + kill 兜底）→ 停 mariadb（mysqladmin shutdown + kill 兜底）。
	err := shell.Run(os.Getenv("APPDATA"), appDir(), func() error {
		return runWindow(app)
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
