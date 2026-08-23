package main

import "context"

// App 壳应用：极薄，无 Go↔JS 绑定（业务前端由后端同源服务，壳只负责进程编排 + 开窗）。
type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}
