// Package orchestrator 实现壳的进程编排（specs 自包含打包 Phase 3/4 / 设计文档 §3、§4.4、§6）。
// 按序：初始化并启动便携 MySQL（13306）→ 起 trailmind-backend.exe（注入 DB env）→ 开窗加载 17860 →
// 关窗后反序停 backend + MySQL。
//
// 数据库选型变更（2026-08-24）：原捆绑 MariaDB 因**不支持 MySQL 的 `WITH PARSER ngram` 全文解析器**
// 而无法建表（schema.sql/搜索依赖 ngram，见设计文档 §10 风险表）。现改捆绑 **MySQL 8.4 LTS 便携版**，
// 从而零改动保留 FULLTEXT(ngram) 与全部后端测试、以及 N3 搜索性能契约。
//
// 关键动作经 Deps 注入，便于单测用 stub 进程覆盖启停顺序与超时分支（设计 §9）。
package orchestrator

import (
	"bytes"
	"encoding/json"
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

// —— 常量 ——
const (
	// DefaultDbPort 便携数据库端口：避开系统 MySQL/MariaDB 默认 3306，且固定端口便于错误定位。
	DefaultDbPort = 13306
	// DefaultBackendPort 后端 REST 端口。
	DefaultBackendPort = 17860
	// DefaultBindAddress 仅回环绑定（安全边界 N6）。
	DefaultBindAddress = "127.0.0.1"
	// AppDirName %APPDATA% 下的应用目录名。
	AppDirName = "TrailMind"
	// DbDirName 数据目录名（%APPDATA%\TrailMind\db）。
	DbDirName = "db"
	// PortableDbDirName 便携数据库在发布产物中的目录名（%APPDIR%\mysql）。
	PortableDbDirName = "mysql"
	// BackendDirName 后端 app-image 在发布产物中的目录名。
	BackendDirName = "trailmind-backend"
	// BackendExeName 后端可执行文件名。
	BackendExeName = "trailmind-backend.exe"
)

// exeDbInit 初始化数据目录的数据库服务程序（MySQL：mysqld --initialize-insecure，等价 MariaDB 的 mariadb-install-db）。
const exeDbInit = "mysqld.exe"

// exeDbServer 常驻数据库服务程序。
const exeDbServer = "mysqld.exe"

// exeDbAdmin 管理命令（ping / shutdown）。
const exeDbAdmin = "mysqladmin.exe"

// RunStateName 运行态文件名（%APPDATA%\TrailMind\run.json）：记录本次拉起的子进程 pid，
// 供下次启动清理孤儿进程（壳被强杀/崩溃时 Run() 的清理路径不会执行，见 CleanupStale）。
const RunStateName = "run.json"

// —— 纯函数：路径 ——

// ResolveDataDir 数据目录 %APPDATA%\TrailMind\db。
func ResolveDataDir(appDataRoot string) string {
	return filepath.Join(appDataRoot, AppDirName, DbDirName)
}

// ResolvePortableDbDir 便携数据库根目录 %APPDIR%\mysql（由打包脚本组装，§4.6 步骤 7）。
func ResolvePortableDbDir(appDir string) string {
	return filepath.Join(appDir, PortableDbDirName)
}

// ResolveDbBinDir 便携数据库 bin 目录 %APPDIR%\mysql\bin。
func ResolveDbBinDir(appDir string) string {
	return filepath.Join(ResolvePortableDbDir(appDir), "bin")
}

// ResolveBackendExe 后端 app-image 可执行文件 %APPDIR%\trailmind-backend\trailmind-backend.exe。
func ResolveBackendExe(appDir string) string {
	return filepath.Join(appDir, BackendDirName, BackendExeName)
}

// ResolveRunStatePath 运行态文件路径 %APPDATA%\TrailMind\run.json。
func ResolveRunStatePath(appDataRoot string) string {
	return filepath.Join(appDataRoot, AppDirName, RunStateName)
}

// —— 运行态（孤儿进程清理）——

// RunState 上次运行记录的子进程 pid（0 = 未启动）。
type RunState struct {
	DbPid      int `json:"dbPid"`
	BackendPid int `json:"backendPid"`
}

// ParseRunState 解析运行态 JSON；空内容或非法 JSON 返回零值 + false（视为无记录，不阻断启动）。
func ParseRunState(data string) (RunState, bool) {
	if strings.TrimSpace(data) == "" {
		return RunState{}, false
	}
	var st RunState
	if err := json.Unmarshal([]byte(data), &st); err != nil {
		return RunState{}, false
	}
	if st.DbPid == 0 && st.BackendPid == 0 {
		return RunState{}, false
	}
	return st, true
}

// MarshalRunState 序列化运行态（写入 pidfile 用）。
func MarshalRunState(st RunState) string {
	b, err := json.Marshal(st)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// CleanupStale 清理上次运行遗留的子进程（壳被强杀/崩溃时 Run() 的正常清理路径不会执行）。
// 顺序与 Run 的收尾一致：先停后端（优雅 shutdown + kill 兜底），再停数据库。
func (s *Shell) CleanupStale(appDataRoot, appDir string) {
	path := ResolveRunStatePath(appDataRoot)
	if !s.d.Exists(path) {
		return
	}
	data, err := s.d.ReadFile(path)
	if err != nil {
		return
	}
	st, ok := ParseRunState(data)
	if !ok {
		_ = s.d.RemoveFile(path)
		return
	}
	if st.BackendPid != 0 {
		s.StopBackend(st.BackendPid)
	}
	if st.DbPid != 0 {
		s.StopDatabase(appDir, st.DbPid)
	}
	_ = s.d.RemoveFile(path)
}

// writeRunState 记录本次拉起的子进程 pid（启动期写、正常收尾时删）。
func (s *Shell) writeRunState(appDataRoot string, st RunState) {
	p := ResolveRunStatePath(appDataRoot)
	if err := s.d.MkdirAll(filepath.Dir(p)); err != nil {
		return
	}
	_ = s.d.WriteFile(p, MarshalRunState(st))
}

// clearRunState 正常收尾后删除运行态文件。
func (s *Shell) clearRunState(appDataRoot string) {
	_ = s.d.RemoveFile(ResolveRunStatePath(appDataRoot))
}

// —— 纯函数：命令构造 ——

// BuildInitArgs mysqld 首运行初始化参数（等价 MariaDB 的 mariadb-install-db）。
// 要点：
//   - --initialize-insecure：建系统表 + root 空密码（单用户桌面工具，仅回环，威胁模型本机隔离）；
//   - --basedir：强制用便携目录的 share（错误消息/字符集），避免误读机器上已装的 MySQL；
//   - --mysqlx=OFF --skip-networking=off：只要经典协议，不额外开 X Protocol 端口（33060）。
func BuildInitArgs(dataDir, portableDbDir string) []string {
	return []string{
		"--initialize-insecure",
		"--basedir=" + portableDbDir,
		"--datadir=" + dataDir,
		"--mysqlx=OFF",
		"--skip-networking=off",
	}
}

// BuildStartArgs mysqld 启动参数：固定端口 + 仅回环 + 显式开启 TCP。
func BuildStartArgs(dataDir string, port int) []string {
	return []string{
		"--port", fmt.Sprint(port),
		"--bind-address", DefaultBindAddress,
		"--datadir", dataDir,
		"--skip-networking=off",
		"--mysqlx=OFF", // 不占 X Protocol 端口
	}
}

// BuildShutdownArgs mysqladmin 优雅关闭参数（-u root：否则 mysqladmin 用当前 OS 用户名，root 无密码场景会 Access denied）。
func BuildShutdownArgs(port int) []string {
	return []string{"-u", "root", "--port", fmt.Sprint(port), "shutdown"}
}

// BuildPingArgs mysqladmin 就绪探测参数（同上 -u root）。
func BuildPingArgs(port int) []string {
	return []string{"-u", "root", "--port", fmt.Sprint(port), "ping"}
}

// BuildBackendEnv 后端 DB 环境变量：连 bundled MySQL（root 无密码，仅回环）。
func BuildBackendEnv(dbPort int) []string {
	return []string{
		"DB_HOST=" + DefaultBindAddress,
		fmt.Sprintf("DB_PORT=%d", dbPort),
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
	return strings.Contains(strings.ToLower(out), "mysqld is alive")
}

// —— 依赖注入（关键动作可注入 stub，便于单测）——
type Deps struct {
	Exists       func(path string) bool
	RemoveAll    func(path string) error
	MkdirAll     func(path string) error                                      // 建目录（初始化前确保父目录存在）
	ReadFile     func(path string) (string, error)                            // 读运行态文件（孤儿清理）
	WriteFile    func(path string, data string) error                         // 写运行态文件（pidfile）
	RemoveFile   func(path string) error                                      // 删运行态文件
	Run          func(name string, args ...string) error                      // 一次性命令（mysqld --initialize / mysqladmin）
	Start        func(name string, env []string, args ...string) (int, error) // 常驻进程
	Kill         func(pid int)                                                // 强杀兜底
	TcpProbe     func(port int) bool                                          // TCP 端口探测（端口占用判定用）
	DbReady      func(binDir string, port int) bool                           // 数据库就绪探测（mysqladmin ping）
	HttpHealth   func(url string) bool                                        // 后端 /api/v1/health 探测
	PostShutdown func(url string)                                             // 后端 POST /api/v1/shutdown 优雅关闭
	Sleep        func(time.Duration)                                          // 可注入以加速测试
}

// runQuiet 执行一次性命令并丢弃输出（HideWindow 避免控制台窗口一闪而过）。
func runQuiet(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	var stderr bytes.Buffer
	cmd.Stdout = io.Discard
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%w: %s", err, stderr.String())
	}
	return nil
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
		ReadFile: func(path string) (string, error) {
			b, err := os.ReadFile(path)
			return string(b), err
		},
		WriteFile: func(path, data string) error {
			return os.WriteFile(path, []byte(data), 0644)
		},
		RemoveFile: func(path string) error {
			err := os.Remove(path)
			if os.IsNotExist(err) {
				return nil
			}
			return err
		},
		Run: runQuiet,
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
		// 数据库就绪：mysqladmin ping 返回 'mysqld is alive'（TCP 端口通不等于可服务——初始化期端口已监听但拒绝查询）。
		DbReady: func(binDir string, port int) bool {
			cmd := exec.Command(filepath.Join(binDir, exeDbAdmin), BuildPingArgs(port)...)
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
			out, _ := cmd.CombinedOutput()
			return ParseMysqladminPing(string(out))
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
	DbReadyTimeout      time.Duration // 默认 60s（--initialize-insecure 首运行需建系统表）
	BackendReadyTimeout time.Duration // 默认 60s
	PollInterval        time.Duration // 默认 500ms
}

func New(d Deps) *Shell {
	return &Shell{
		d:                   d,
		DbReadyTimeout:      60 * time.Second,
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

// StartDatabase §6：端口决策 → 初始化（必要时清理重建）→ 拉起 mysqld → 就绪等待（mysqladmin ping）。
// 返回数据库进程 pid。
func (s *Shell) StartDatabase(appDataRoot, appDir string) (int, error) {
	dataDir := ResolveDataDir(appDataRoot)
	portableDir := ResolvePortableDbDir(appDir)
	binDir := ResolveDbBinDir(appDir)

	if dec := DecidePort(s.d.TcpProbe(DefaultDbPort), DefaultDbPort); dec.Action == "error" {
		return 0, fmt.Errorf("%s", dec.Reason)
	}

	dec := DecideInit(s.d.Exists(dataDir), s.d.Exists(filepath.Join(dataDir, "mysql")))
	if dec.Action == "cleanup-and-init" {
		if err := s.d.RemoveAll(dataDir); err != nil {
			return 0, err
		}
	}
	if dec.Action != "skip" {
		// mysqld --initialize-insecure 不会自建 datadir 的中间目录。
		if err := s.d.MkdirAll(filepath.Dir(dataDir)); err != nil {
			return 0, err
		}
		if err := s.d.Run(filepath.Join(binDir, exeDbInit), BuildInitArgs(dataDir, portableDir)...); err != nil {
			return 0, fmt.Errorf("mysqld 初始化失败: %w", err)
		}
	}

	pid, err := s.d.Start(filepath.Join(binDir, exeDbServer), nil, BuildStartArgs(dataDir, DefaultDbPort)...)
	if err != nil {
		return 0, err
	}
	if !s.waitFor(func() bool { return s.d.DbReady(binDir, DefaultDbPort) }, s.DbReadyTimeout, s.PollInterval) {
		return pid, fmt.Errorf("数据库启动超时")
	}
	return pid, nil
}

// StartBackend §6：拉起 trailmind-backend.exe（注入 DB env 指向 bundled MySQL）→ 健康等待（≤60s）。
func (s *Shell) StartBackend(appDir string) (int, error) {
	exe := ResolveBackendExe(appDir)
	if dec := DecidePort(s.d.TcpProbe(DefaultBackendPort), DefaultBackendPort); dec.Action == "error" {
		return 0, fmt.Errorf("%s", dec.Reason)
	}
	pid, err := s.d.Start(exe, BuildBackendEnv(DefaultDbPort))
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

// StopDatabase mysqladmin shutdown（优雅）→ 等待 → 强杀兜底。
func (s *Shell) StopDatabase(appDir string, pid int) {
	_ = s.d.Run(filepath.Join(ResolveDbBinDir(appDir), exeDbAdmin), BuildShutdownArgs(DefaultDbPort)...)
	s.d.Sleep(2 * time.Second)
	s.d.Kill(pid)
}

// Run 完整启停编排：起数据库 → 起 backend → 开窗（阻塞至关闭）→ 停 backend → 停数据库。
// 任一步失败均按「已启动的逆序」清理，保证不残留进程（§6 崩溃兜底）。
// 启动前先清理上次遗留（壳被强杀/崩溃时本函数的收尾不会执行）；本次拉起的 pid 写入运行态文件，
// 正常收尾后删除——下次启动据此判断是否存在孤儿。
func (s *Shell) Run(appDataRoot, appDir string, openWindow func() error) error {
	s.CleanupStale(appDataRoot, appDir)

	dbPid, err := s.StartDatabase(appDataRoot, appDir)
	if err != nil {
		return err
	}
	s.writeRunState(appDataRoot, RunState{DbPid: dbPid})

	backendPid, err := s.StartBackend(appDir)
	if err != nil {
		s.StopDatabase(appDir, dbPid)
		s.clearRunState(appDataRoot)
		return err
	}
	s.writeRunState(appDataRoot, RunState{DbPid: dbPid, BackendPid: backendPid})

	winErr := openWindow()
	s.StopBackend(backendPid)
	s.StopDatabase(appDir, dbPid)
	s.clearRunState(appDataRoot)
	return winErr
}
