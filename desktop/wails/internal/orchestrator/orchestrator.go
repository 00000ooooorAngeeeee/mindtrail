// Package orchestrator 实现壳的进程编排（specs 自包含打包 Phase 3 / 设计文档 §3、§4.4、§6）。
// 按序：起 mariadb（13306）→ 起 trailmind-backend.exe（注入 DB env）→ 开窗加载 17860 → 关窗后反序停 backend + mariadb。
// 生命周期逻辑移植自 Phase 2 desktop/main/mariadb-process.js 与 Phase 1 desktop/main/backend-process.js（本包为其可执行规格）。
// 关键动作经 Deps 注入，便于单测用 stub 进程覆盖启停顺序与超时分支（设计 §9）。
package orchestrator

import (
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// —— 常量（与 Phase 2 mariadb-process.js / Phase 1 backend-process.js 同源）——
const (
	DefaultMariadbPort = 13306
	DefaultBackendPort = 17860
	DefaultBindAddress = "127.0.0.1"
	AppDirName         = "TrailMind"
	DbDirName          = "db"
	MariadbDirName     = "mariadb"
	BackendDirName     = "trailmind-backend"
	BackendExeName     = "trailmind-backend.exe"
)

// —— 纯函数：路径 ——

// ResolveDataDir 数据目录 %APPDATA%\TrailMind\db。
func ResolveDataDir(appDataRoot string) string {
	return filepath.Join(appDataRoot, AppDirName, DbDirName)
}

// ResolveMariadbBinDir 便携 MariaDB bin 目录 %APPDIR%\mariadb\bin。
func ResolveMariadbBinDir(appDir string) string {
	return filepath.Join(appDir, MariadbDirName, "bin")
}

// ResolveBackendExe 后端 app-image 可执行文件 %APPDIR%\trailmind-backend\trailmind-backend.exe。
func ResolveBackendExe(appDir string) string {
	return filepath.Join(appDir, BackendDirName, BackendExeName)
}

// —— 纯函数：命令构造 ——

// BuildInitArgs mariadb-install-db 初始化参数。
func BuildInitArgs(dataDir string) []string {
	return []string{"--datadir", dataDir}
}

// BuildStartArgs mariadbd 启动参数：固定端口 + 仅回环 + 显式开启 TCP。
func BuildStartArgs(dataDir string, port int) []string {
	return []string{"--port", fmt.Sprint(port), "--bind-address", DefaultBindAddress, "--datadir", dataDir, "--skip-networking=off"}
}

// BuildShutdownArgs mysqladmin 优雅关闭参数（-u root：否则 mysqladmin 用当前 OS 用户名，root 无密码场景会 Access denied）。
func BuildShutdownArgs(port int) []string {
	return []string{"-u", "root", "--port", fmt.Sprint(port), "shutdown"}
}

// BuildPingArgs mysqladmin 就绪探测参数（同上 -u root）。
func BuildPingArgs(port int) []string {
	return []string{"-u", "root", "--port", fmt.Sprint(port), "ping"}
}

// BuildBackendEnv 后端 DB 环境变量：连 bundled mariadb（root 无密码，仅回环，威胁模型本机隔离）。
func BuildBackendEnv(mariadbPort int) []string {
	return []string{
		"DB_HOST=" + DefaultBindAddress,
		fmt.Sprintf("DB_PORT=%d", mariadbPort),
		"DB_USER=root",
		"DB_PASS=",
	}
}

// —— 纯函数：决策 ——

// InitDecision 初始化决策结果。
type InitDecision struct {
	Action string // init | cleanup-and-init | skip
	Reason string
}

// DecideInit 数据目录是否存在 × mysql 系统库是否已建（初始化完成标记）。
func DecideInit(dataDirExists, mysqlDirExists bool) InitDecision {
	if !dataDirExists {
		return InitDecision{"init", "数据目录不存在，首次初始化"}
	}
	if !mysqlDirExists {
		return InitDecision{"cleanup-and-init", "检测到半初始化数据目录（缺 mysql 系统库），清理后重建"}
	}
	return InitDecision{"skip", "数据目录已初始化"}
}

// PortDecision 端口占用决策结果。
type PortDecision struct {
	Action string // start | error
	Reason string
}

// DecidePort 端口被占则报错（§8：不静默换端口，避免多实例）。
func DecidePort(portInUse bool, port int) PortDecision {
	if portInUse {
		return PortDecision{"error", fmt.Sprintf("端口 %d 被占用，请先关闭占用程序", port)}
	}
	return PortDecision{"start", ""}
}

// ParseMysqladminPing 识别 mysqladmin ping 输出（'mysqld is alive'）。
func ParseMysqladminPing(out string) bool {
	return strings.Contains(out, "mysqld is alive")
}

// —— 依赖注入（关键动作可注入 stub，便于单测）——
type Deps struct {
	Exists       func(path string) bool
	RemoveAll    func(path string) error
	MkdirAll     func(path string) error                                 // 建目录（install-db 前确保父目录存在）
	Run          func(name string, args ...string) error                  // 一次性命令（install-db / mysqladmin）
	Start        func(name string, env []string, args ...string) (int, error) // 常驻进程
	Kill         func(pid int)                                            // 强杀兜底
	TcpProbe     func(port int) bool                                      // TCP 端口探测
	HttpHealth   func(url string) bool                                    // 后端 /api/v1/health 探测
	PostShutdown func(url string)                                         // 后端 POST /api/v1/shutdown 优雅关闭
	Sleep        func(time.Duration)                                      // 可注入以加速测试
}

// DefaultDeps 返回真实实现。
func DefaultDeps() Deps {
	return Deps{
		Exists: func(p string) bool {
			_, err := os.Stat(p)
			return err == nil
		},
		RemoveAll: os.RemoveAll,
		MkdirAll: func(path string) error {
			return os.MkdirAll(path, 0755)
		},
		Run: func(name string, args ...string) error {
			cmd := exec.Command(name, args...)
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} // 避免控制台窗口一闪而过
			var stderr bytes.Buffer
			cmd.Stdout = io.Discard
			cmd.Stderr = &stderr // 捕获错误输出，失败时并入错误信息
			err := cmd.Run()
			if err != nil {
				return fmt.Errorf("%w: %s", err, stderr.String())
			}
			return nil
		},
		Start: func(name string, env []string, args ...string) (int, error) {
			cmd := exec.Command(name, args...)
			cmd.Env = append(os.Environ(), env...)
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
			// GUI 父进程的 std 句柄为 NULL，jpackage 启动器继承后 JVM 初始化会失败（"Failed to launch JVM"）。
			// 显式给 NUL 设备句柄，让子进程拿到有效 std 句柄。
			cmd.Stdout = io.Discard
			cmd.Stderr = io.Discard
			if err := cmd.Start(); err != nil {
				return 0, err
			}
			return cmd.Process.Pid, nil
		},
		Kill: func(pid int) {
			cmd := exec.Command("taskkill", "/PID", fmt.Sprint(pid), "/T", "/F")
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
			_ = cmd.Run()
		},
		TcpProbe: func(port int) bool {
			conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 500*time.Millisecond)
			if err != nil {
				return false
			}
			_ = conn.Close()
			return true
		},
		HttpHealth: func(url string) bool {
			client := http.Client{Timeout: time.Second}
			resp, err := client.Get(url)
			if err != nil {
				return false
			}
			_ = resp.Body.Close()
			return resp.StatusCode == 200
		},
		PostShutdown: func(url string) {
			_, _ = http.Post(url, "application/json", nil)
		},
		Sleep: time.Sleep,
	}
}

// —— 编排 ——

type Shell struct {
	d                   Deps
	MariadbReadyTimeout time.Duration // 默认 30s（§6）
	BackendReadyTimeout time.Duration // 默认 60s（§6）
	PollInterval        time.Duration // 默认 500ms
}

func New(d Deps) *Shell {
	return &Shell{
		d:                   d,
		MariadbReadyTimeout: 30 * time.Second,
		BackendReadyTimeout: 60 * time.Second,
		PollInterval:        500 * time.Millisecond,
	}
}

func (s *Shell) waitFor(check func() bool, timeout, interval time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if check() {
			return true
		}
		s.d.Sleep(interval)
	}
	return false
}

// StartMariadb §6：端口决策 → 初始化（必要时清理重建）→ 拉起 mariadbd → 就绪等待（≤30s）。
func (s *Shell) StartMariadb(appDataRoot, appDir string) (int, error) {
	dataDir := ResolveDataDir(appDataRoot)
	binDir := ResolveMariadbBinDir(appDir)

	if dec := DecidePort(s.d.TcpProbe(DefaultMariadbPort), DefaultMariadbPort); dec.Action == "error" {
		return 0, fmt.Errorf("%s", dec.Reason)
	}

	dec := DecideInit(s.d.Exists(dataDir), s.d.Exists(filepath.Join(dataDir, "mysql")))
	if dec.Action == "cleanup-and-init" {
		if err := s.d.RemoveAll(dataDir); err != nil {
			return 0, err
		}
	}
	if dec.Action != "skip" {
		// mariadb-install-db 要求 --datadir 的父目录已存在（不会自建中间目录）
		if err := s.d.MkdirAll(filepath.Dir(dataDir)); err != nil {
			return 0, err
		}
		if err := s.d.Run(filepath.Join(binDir, "mariadb-install-db.exe"), BuildInitArgs(dataDir)...); err != nil {
			return 0, fmt.Errorf("mariadb-install-db 初始化失败: %w", err)
		}
	}

	pid, err := s.d.Start(filepath.Join(binDir, "mariadbd.exe"), nil, BuildStartArgs(dataDir, DefaultMariadbPort)...)
	if err != nil {
		return 0, err
	}
	if !s.waitFor(func() bool { return s.d.TcpProbe(DefaultMariadbPort) }, s.MariadbReadyTimeout, s.PollInterval) {
		return pid, fmt.Errorf("mariadb 启动超时")
	}
	return pid, nil
}

// StartBackend §6：拉起 trailmind-backend.exe（注入 DB env 指向 bundled mariadb）→ 健康等待（≤60s）。
func (s *Shell) StartBackend(appDir string) (int, error) {
	exe := ResolveBackendExe(appDir)
	if dec := DecidePort(s.d.TcpProbe(DefaultBackendPort), DefaultBackendPort); dec.Action == "error" {
		return 0, fmt.Errorf("%s", dec.Reason)
	}
	pid, err := s.d.Start(exe, BuildBackendEnv(DefaultMariadbPort))
	if err != nil {
		return 0, err
	}
	healthURL := fmt.Sprintf("http://127.0.0.1:%d/api/v1/health", DefaultBackendPort)
	if !s.waitFor(func() bool { return s.d.HttpHealth(healthURL) }, s.BackendReadyTimeout, s.PollInterval) {
		return pid, fmt.Errorf("后端启动超时")
	}
	return pid, nil
}

// StopBackend 优雅关闭（POST /api/v1/shutdown）→ 等待 → 强杀兜底。
func (s *Shell) StopBackend(pid int) {
	s.d.PostShutdown(fmt.Sprintf("http://127.0.0.1:%d/api/v1/shutdown", DefaultBackendPort))
	s.d.Sleep(2 * time.Second)
	s.d.Kill(pid)
}

// StopMariadb mysqladmin shutdown（优雅）→ 等待 → 强杀兜底。
func (s *Shell) StopMariadb(appDir string, pid int) {
	binDir := ResolveMariadbBinDir(appDir)
	_ = s.d.Run(filepath.Join(binDir, "mysqladmin.exe"), BuildShutdownArgs(DefaultMariadbPort)...)
	s.d.Sleep(2 * time.Second)
	s.d.Kill(pid)
}

// Run 完整启停编排：起 mariadb → 起 backend → 开窗（阻塞至关闭）→ 停 backend → 停 mariadb。
// 任一步失败均按「已启动的逆序」清理，保证不残留进程（§6 崩溃兜底）。
func (s *Shell) Run(appDataRoot, appDir string, openWindow func() error) error {
	mariadbPid, err := s.StartMariadb(appDataRoot, appDir)
	if err != nil {
		return err
	}
	backendPid, err := s.StartBackend(appDir)
	if err != nil {
		s.StopMariadb(appDir, mariadbPid)
		return err
	}
	winErr := openWindow()
	s.StopBackend(backendPid)
	s.StopMariadb(appDir, mariadbPid)
	return winErr
}
