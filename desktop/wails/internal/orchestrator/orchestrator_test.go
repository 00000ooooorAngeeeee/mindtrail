package orchestrator

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// stubEnv 有状态 stub：mariadbd / backend 启动后对应端口探测才返回 true（模拟进程就绪）。
type stubEnv struct {
	calls     []string
	mariadbUp bool
	backendUp bool
}

func (s *stubEnv) deps() Deps {
	return Deps{
		Exists: func(p string) bool { return false },
		RemoveAll: func(p string) error {
			s.calls = append(s.calls, "remove:"+filepath.Base(p))
			return nil
		},
		MkdirAll: func(p string) error {
			s.calls = append(s.calls, "mkdir:"+filepath.Base(p))
			return nil
		},
		Run: func(name string, args ...string) error {
			s.calls = append(s.calls, "run:"+filepath.Base(name)+":"+strings.Join(args, " "))
			return nil
		},
		Start: func(name string, env []string, args ...string) (int, error) {
			s.calls = append(s.calls, "start:"+filepath.Base(name)+":"+strings.Join(args, " "))
			switch filepath.Base(name) {
			case "mariadbd.exe":
				s.mariadbUp = true
			case "trailmind-backend.exe":
				s.backendUp = true
			}
			return 4242, nil
		},
		Kill: func(pid int) { s.calls = append(s.calls, "kill") },
		TcpProbe: func(port int) bool {
			switch port {
			case DefaultMariadbPort:
				return s.mariadbUp
			case DefaultBackendPort:
				return s.backendUp
			}
			return false
		},
		HttpHealth:   func(url string) bool { return true },
		PostShutdown: func(url string) { s.calls = append(s.calls, "shutdown:"+url) },
		Sleep:        func(time.Duration) {},
	}
}

func fastShell(d Deps) *Shell {
	s := New(d)
	s.MariadbReadyTimeout = 20 * time.Millisecond
	s.BackendReadyTimeout = 20 * time.Millisecond
	s.PollInterval = time.Millisecond
	return s
}

// —— 纯函数：路径 ——

func TestResolvePaths(t *testing.T) {
	if got := ResolveDataDir("C:\\Users\\x\\AppData\\Roaming"); got != filepath.Join("C:\\Users\\x\\AppData\\Roaming", "TrailMind", "db") {
		t.Fatalf("ResolveDataDir = %q", got)
	}
	if got := ResolveMariadbBinDir("D:\\app"); got != filepath.Join("D:\\app", "mariadb", "bin") {
		t.Fatalf("ResolveMariadbBinDir = %q", got)
	}
	if got := ResolveBackendExe("D:\\app"); got != filepath.Join("D:\\app", "trailmind-backend", "trailmind-backend.exe") {
		t.Fatalf("ResolveBackendExe = %q", got)
	}
}

// —— 纯函数：命令构造 ——

func TestBuildMariadbArgs(t *testing.T) {
	if got := strings.Join(BuildInitArgs("C:\\d\\db"), "|"); got != "--datadir|C:\\d\\db" {
		t.Fatalf("BuildInitArgs = %q", got)
	}
	want := "--port|13306|--bind-address|127.0.0.1|--datadir|C:\\d\\db|--skip-networking=off"
	if got := strings.Join(BuildStartArgs("C:\\d\\db", 13306), "|"); got != want {
		t.Fatalf("BuildStartArgs = %q", got)
	}
	if got := strings.Join(BuildShutdownArgs(13306), "|"); got != "-u|root|--port|13306|shutdown" {
		t.Fatalf("BuildShutdownArgs = %q", got)
	}
	if got := strings.Join(BuildPingArgs(13306), "|"); got != "-u|root|--port|13306|ping" {
		t.Fatalf("BuildPingArgs = %q", got)
	}
}

func TestBuildBackendEnv(t *testing.T) {
	joined := strings.Join(BuildBackendEnv(13306), ";")
	for _, kv := range []string{"DB_HOST=127.0.0.1", "DB_PORT=13306", "DB_USER=root", "DB_PASS="} {
		if !strings.Contains(joined, kv) {
			t.Fatalf("BuildBackendEnv 缺 %q：%q", kv, joined)
		}
	}
}

// —— 纯函数：决策 ——

func TestDecideInit(t *testing.T) {
	cases := []struct {
		dataExists, mysqlExists bool
		wantAction              string
	}{
		{false, false, "init"},
		{true, false, "cleanup-and-init"},
		{true, true, "skip"},
	}
	for _, c := range cases {
		if got := DecideInit(c.dataExists, c.mysqlExists).Action; got != c.wantAction {
			t.Fatalf("DecideInit(%v,%v) = %q, want %q", c.dataExists, c.mysqlExists, got, c.wantAction)
		}
	}
}

func TestDecidePort(t *testing.T) {
	if DecidePort(false, 13306).Action != "start" {
		t.Fatal("DecidePort(false) 应为 start")
	}
	if d := DecidePort(true, 13306); d.Action != "error" || !strings.Contains(d.Reason, "13306") {
		t.Fatalf("DecidePort(true) = %+v", d)
	}
}

func TestParseMysqladminPing(t *testing.T) {
	if !ParseMysqladminPing("mysqld is alive") {
		t.Fatal("应识别 is alive")
	}
	if ParseMysqladminPing("connect failed") || ParseMysqladminPing("") {
		t.Fatal("不应误判")
	}
}

// —— 编排：StartMariadb ——

func TestStartMariadbFreshInit(t *testing.T) {
	st := &stubEnv{}
	if _, err := fastShell(st.deps()).StartMariadb("C:\\Users\\x\\AppData\\Roaming", "D:\\app"); err != nil {
		t.Fatalf("StartMariadb = %v", err)
	}
	got := strings.Join(st.calls, " ")
	if !strings.Contains(got, "run:mariadb-install-db.exe:--datadir") {
		t.Fatalf("缺 install-db：%q", got)
	}
	if !strings.Contains(got, "start:mariadbd.exe:--port 13306") {
		t.Fatalf("缺 mariadbd 启动：%q", got)
	}
	// 首次初始化应先确保父目录存在（mariadb-install-db 不自建中间目录）
	mkdirIdx := strings.Index(got, "mkdir:")
	installIdx := strings.Index(got, "run:mariadb-install-db.exe")
	if mkdirIdx < 0 || mkdirIdx > installIdx {
		t.Fatalf("install-db 前应先 mkdir 父目录：%q", got)
	}
}

func TestStartMariadbSkipInit(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	d.Exists = func(p string) bool { return true } // 数据目录与 mysql 库均已存在
	if _, err := fastShell(d).StartMariadb("r", "a"); err != nil {
		t.Fatalf("StartMariadb = %v", err)
	}
	if strings.Contains(strings.Join(st.calls, " "), "install-db") {
		t.Fatalf("已初始化不应跑 install-db：%q", st.calls)
	}
}

func TestStartMariadbCleanupAndInit(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	d.Exists = func(p string) bool { return filepath.Base(p) == "db" } // 数据目录在，mysql 库缺失
	if _, err := fastShell(d).StartMariadb("r", "a"); err != nil {
		t.Fatalf("StartMariadb = %v", err)
	}
	got := strings.Join(st.calls, " ")
	if !strings.Contains(got, "remove:db") || !strings.Contains(got, "install-db") {
		t.Fatalf("半初始化应先清理后重建：%q", got)
	}
}

func TestStartMariadbPortOccupied(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	d.TcpProbe = func(port int) bool { return port == DefaultMariadbPort }
	if _, err := fastShell(d).StartMariadb("r", "a"); err == nil || !strings.Contains(err.Error(), "13306") {
		t.Fatalf("端口占用应报错：%v", err)
	}
	if len(st.calls) != 0 {
		t.Fatalf("端口占用不应有任何动作：%q", st.calls)
	}
}

func TestStartMariadbTimeout(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	d.TcpProbe = func(port int) bool { return false } // 永不就绪
	if _, err := fastShell(d).StartMariadb("r", "a"); err == nil || !strings.Contains(err.Error(), "超时") {
		t.Fatalf("应超时报错：%v", err)
	}
}

// —— 编排：StartBackend ——

func TestStartBackend(t *testing.T) {
	st := &stubEnv{}
	if _, err := fastShell(st.deps()).StartBackend("D:\\app"); err != nil {
		t.Fatalf("StartBackend = %v", err)
	}
	if !strings.Contains(strings.Join(st.calls, " "), "start:trailmind-backend.exe:") {
		t.Fatalf("缺 backend 启动：%q", st.calls)
	}
}

func TestStartBackendPortOccupied(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	d.TcpProbe = func(port int) bool { return port == DefaultBackendPort }
	if _, err := fastShell(d).StartBackend("a"); err == nil || !strings.Contains(err.Error(), "17860") {
		t.Fatalf("端口占用应报错：%v", err)
	}
	if len(st.calls) != 0 {
		t.Fatalf("端口占用不应有动作：%q", st.calls)
	}
}

func TestStartBackendTimeout(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	d.HttpHealth = func(url string) bool { return false }
	if _, err := fastShell(d).StartBackend("a"); err == nil || !strings.Contains(err.Error(), "超时") {
		t.Fatalf("应超时报错：%v", err)
	}
}

// —— 编排：Run（启停顺序）——

func TestRunOrdering(t *testing.T) {
	st := &stubEnv{}
	if err := fastShell(st.deps()).Run("r", "a", func() error { return nil }); err != nil {
		t.Fatalf("Run = %v", err)
	}
	seq := strings.Join(st.calls, " ")
	mariadbStart := strings.Index(seq, "start:mariadbd.exe")
	backendStart := strings.Index(seq, "start:trailmind-backend.exe")
	backendShutdown := strings.Index(seq, "shutdown:http://127.0.0.1:17860/api/v1/shutdown")
	mariadbShutdown := strings.Index(seq, "run:mysqladmin.exe:-u root --port 13306 shutdown")
	if !(0 <= mariadbStart && mariadbStart < backendStart && backendStart < backendShutdown && backendShutdown < mariadbShutdown) {
		t.Fatalf("启停顺序错误：%q", seq)
	}
}

func TestRunBackendFailStopsMariadb(t *testing.T) {
	st := &stubEnv{}
	st.backendUp = true // 17860 已被占（模拟残留/冲突），mariadb 端口正常
	if err := fastShell(st.deps()).Run("r", "a", func() error { return nil }); err == nil {
		t.Fatal("Run 应返回错误")
	}
	seq := strings.Join(st.calls, " ")
	if !strings.Contains(seq, "start:mariadbd.exe") || !strings.Contains(seq, "run:mysqladmin.exe:-u root --port 13306 shutdown") {
		t.Fatalf("backend 失败应清理 mariadb：%q", seq)
	}
	if strings.Contains(seq, "start:trailmind-backend.exe") {
		t.Fatalf("端口被占不应拉起 backend：%q", seq)
	}
}
