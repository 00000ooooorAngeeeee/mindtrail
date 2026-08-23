//go:build bindings

package main

// bindingsMode 绑定生成模式下为 true：wails build 以 -tags bindings 编译临时二进制并运行，
// 此时 App.Run 仅生成绑定并退出，壳不应启动 mariadb/backend、不应开窗。
var bindingsMode = true
