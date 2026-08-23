//go:build !bindings

package main

// bindingsMode 是否为 Wails 绑定生成模式。普通构建（无 bindings 标签）下恒为 false。
var bindingsMode = false
