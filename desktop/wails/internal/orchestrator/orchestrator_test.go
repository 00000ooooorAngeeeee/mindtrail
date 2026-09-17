package orchestrator

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// stubEnv 有状态 stub：mysqld / backend 启动后对应就绪探测才返回 true（模拟进程就绪）。
type stubEnv struct {
	calls     []string
	dbUp      bool
	backendUp bool
	files     map[string]string // 运行态文件内容（pidfile）
}

func (s *stubEnv) deps() Deps {
	if s.files == nil {
		s.files = map[string]string{}
	}
	return Deps{
		Exists: func(p string) bool {
			if filepath.Base(p) == RunStateName {
				_, ok := s.files[p]
				return ok
			}
			return false
		},
		RemoveAll: func(p string) error {
			s.calls = append(s.calls, "remove:"+filepath.Base(p))
			return nil
		},
		MkdirAll: func(p string) error {
			s.calls = append(s.calls, "mkdir:"+filepath.Base(p))
			return nil
		},
		ReadFile: func(p string) (string, error) {
			v, ok := s.files[p]
			if !ok {
				return "", os.ErrNotExist
			}
			return v, nil
		},
		WriteFile: func(p, data string) error {
			s.files[p] = data
			s.calls = append(s.calls, "write:"+filepath.Base(p))
			return nil
		},
		RemoveFile: func(p string) error {
			delete(s.files, p)
			s.calls = append(s.calls, "unlink:"+filepath.Base(p))
			return nil
		},
		Run: func(name string, args ...string) error {
			s.calls = append(s.calls, "run:"+filepath.Base(name)+":"+strings.Join(args, " "))
			return nil
		},
		Start: func(name string, env []string, args ...string) (int, error) {
			s.calls = append(s.calls, "start:"+filepath.Base(name)+":"+strings.Join(args, " "))
			switch filepath.Base(name) {
			case "mysqld.exe":
				s.dbUp = true
			case "trailmind-backend.exe":
				s.backendUp = true
			}
			return 4242, nil
		},
		Kill: func(pid int) { s.calls = append(s.calls, "kill") },
		TcpProbe: func(port int) bool {
			switch port {
			case DefaultDbPort:
				return s.dbUp
			case DefaultBackendPort:
				return s.backendUp
			}
			return false
		},
		DbReady:      func(binDir string, port int) bool { return s.dbUp },
		HttpHealth:   func(url string) bool { return true },
		PostShutdown: func(url string) { s.calls = append(s.calls, "shutdown:"+url) },
		Sleep:        func(time.Duration) {},
	}
}

func fastShell(d Deps) *Shell {
	s := New(d)
	s.DbReadyTimeout = 20 * time.Millisecond
	s.BackendReadyTimeout = 20 * time.Millisecond
	s.PollInterval = time.Millisecond
	return s
}

// —— 纯函数：路径 ——

func TestResolvePaths(t *testing.T) {
	if got := ResolveDataDir("C:\\Users\\x\\AppData\\Roaming"); got != filepath.Join("C:\\Users\\x\\AppData\\Roaming", "TrailMind", "db") {
		t.Fatalf("ResolveDataDir = %q", got)
	}
	if got := ResolvePortableDbDir("D:\\app"); got != filepath.Join("D:\\app", "mysql") {
		t.Fatalf("ResolvePortableDbDir = %q", got)
	}
	if got := ResolveDbBinDir("D:\\app"); got != filepath.Join("D:\\app", "mysql", "bin") {
		t.Fatalf("ResolveDbBinDir = %q", got)
	}
	if got := ResolveBackendExe("D:\\app"); got != filepath.Join("D:\\app", "trailmind-backend", "trailmind-backend.exe") {
		t.Fatalf("ResolveBackendExe = %q", got)
	}
}

// —— 纯函数：命令构造 ——

func TestBuildInitArgs(t *testing.T) {
	got := strings.Join(BuildInitArgs("C:\\d\\db", "D:\\app\\mysql"), "|")
	want := "--initialize-insecure|--basedir=D:\\app\\mysql|--datadir=C:\\d\\db|--mysqlx=OFF|--skip-networking=off"
	if got != want {
		t.Fatalf("BuildInitArgs = %q, want %q", got, want)
	}
}

func TestBuildStartArgs(t *testing.T) {
	got := strings.Join(BuildStartArgs("C:\\d\\db", 13306), "|")
	want := "--port|13306|--bind-address|127.0.0.1|--datadir|C:\\d\\db|--skip-networking=off|--mysqlx=OFF"
	if got != want {
		t.Fatalf("BuildStartArgs = %q, want %q", got, want)
	}
}

func TestBuildAdminArgs(t *testing.T) {
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
	if !ParseMysqladminPing("MYSQLD IS ALIVE\n") {
		t.Fatal("应大小写不敏感")
	}
	if ParseMysqladminPing("connect failed") || ParseMysqladminPing("") {
		t.Fatal("不应误判")
	}
}

// —— 编排：StartDatabase ——

func TestStartDatabaseFreshInit(t *testing.T) {
	st := &stubEnv{}
	if _, err := fastShell(st.deps()).StartDatabase("C:\\Users\\x\\AppData\\Roaming", "D:\\app"); err != nil {
		t.Fatalf("StartDatabase = %v", err)
	}
	got := strings.Join(st.calls, " ")
	if !strings.Contains(got, "run:mysqld.exe:--initialize-insecure") {
		t.Fatalf("缺 initialize-insecure：%q", got)
	}
	if !strings.Contains(got, "start:mysqld.exe:--port 13306") {
		t.Fatalf("缺 mysqld 启动：%q", got)
	}
	// 首次初始化应先确保父目录存在（mysqld 不自建中间目录）
	mkdirIdx := strings.Index(got, "mkdir:")
	initIdx := strings.Index(got, "run:mysqld.exe:--initialize-insecure")
	if mkdirIdx < 0 || mkdirIdx > initIdx {
		t.Fatalf("初始化前应先 mkdir 父目录：%q", got)
	}
}

func TestStartDatabaseSkipInit(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	d.Exists = func(p string) bool { return true } // 数据目录与 mysql 库均已存在
	if _, err := fastShell(d).StartDatabase("r", "a"); err != nil {
		t.Fatalf("StartDatabase = %v", err)
	}
	if strings.Contains(strings.Join(st.calls, " "), "initialize-insecure") {
		t.Fatalf("已初始化不应再跑 initialize：%q", st.calls)
	}
}

func TestStartDatabaseCleanupAndInit(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	d.Exists = func(p string) bool { return filepath.Base(p) == "db" } // 数据目录在，mysql 库缺失
	if _, err := fastShell(d).StartDatabase("r", "a"); err != nil {
		t.Fatalf("StartDatabase = %v", err)
	}
	got := strings.Join(st.calls, " ")
	if !strings.Contains(got, "remove:db") || !strings.Contains(got, "initialize-insecure") {
		t.Fatalf("半初始化应先清理后重建：%q", got)
	}
}

func TestStartDatabasePortOccupied(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	d.TcpProbe = func(port int) bool { return port == DefaultDbPort }
	if _, err := fastShell(d).StartDatabase("r", "a"); err == nil || !strings.Contains(err.Error(), "13306") {
		t.Fatalf("端口占用应报错：%v", err)
	}
	if len(st.calls) != 0 {
		t.Fatalf("端口占用不应有任何动作：%q", st.calls)
	}
}

func TestStartDatabaseTimeout(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	d.DbReady = func(string, int) bool { return false } // 永不就绪
	if _, err := fastShell(d).StartDatabase("r", "a"); err == nil || !strings.Contains(err.Error(), "超时") {
		t.Fatalf("应超时报错：%v", err)
	}
}

// 端口已监听但未就绪（TCP 通、ping 不通）也必须等到 ping 就绪——避免初始化期误判可用。
func TestStartDatabaseWaitsForPingNotTcp(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	d.TcpProbe = func(port int) bool { return false } // 端口决策通过
	ready := false
	d.DbReady = func(binDir string, port int) bool {
		if binDir != filepath.Join("a", "mysql", "bin") {
			t.Fatalf("DbReady binDir = %q", binDir)
		}
		ready = true
		return ready
	}
	if _, err := fastShell(d).StartDatabase("r", "a"); err != nil {
		t.Fatalf("StartDatabase = %v", err)
	}
	if !ready {
		t.Fatal("应以 mysqladmin ping 判定就绪")
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
	dbStart := strings.Index(seq, "start:mysqld.exe")
	backendStart := strings.Index(seq, "start:trailmind-backend.exe")
	backendShutdown := strings.Index(seq, "shutdown:http://127.0.0.1:17860/api/v1/shutdown")
	dbShutdown := strings.Index(seq, "run:mysqladmin.exe:-u root --port 13306 shutdown")
	if !(0 <= dbStart && dbStart < backendStart && backendStart < backendShutdown && backendShutdown < dbShutdown) {
		t.Fatalf("启停顺序错误：%q", seq)
	}
}

func TestRunBackendFailStopsDatabase(t *testing.T) {
	st := &stubEnv{}
	st.backendUp = true // 17860 已被占（模拟残留/冲突），数据库端口正常
	if err := fastShell(st.deps()).Run("r", "a", func() error { return nil }); err == nil {
		t.Fatal("Run 应返回错误")
	}
	seq := strings.Join(st.calls, " ")
	if !strings.Contains(seq, "start:mysqld.exe") || !strings.Contains(seq, "run:mysqladmin.exe:-u root --port 13306 shutdown") {
		t.Fatalf("backend 失败应清理数据库：%q", seq)
	}
	if strings.Contains(seq, "start:trailmind-backend.exe") {
		t.Fatalf("端口被占不应拉起 backend：%q", seq)
	}
}

// —— 运行态：孤儿进程清理 ——

func TestRunStateRoundTrip(t *testing.T) {
	in := RunState{DbPid: 11, BackendPid: 22}
	got, ok := ParseRunState(MarshalRunState(in))
	if !ok || got != in {
		t.Fatalf("ParseRunState = %+v, ok=%v", got, ok)
	}
	if _, ok := ParseRunState(""); ok {
		t.Fatal("空内容应视为无记录")
	}
	if _, ok := ParseRunState("{ 非法"); ok {
		t.Fatal("非法 JSON 应视为无记录")
	}
	if _, ok := ParseRunState(`{"dbPid":0,"backendPid":0}`); ok {
		t.Fatal("全 0 pid 应视为无记录")
	}
}

func TestCleanupStaleNoFile(t *testing.T) {
	st := &stubEnv{}
	fastShell(st.deps()).CleanupStale("C:\\appdata", "D:\\app")
	if len(st.calls) != 0 {
		t.Fatalf("无运行态文件不应有任何动作：%q", st.calls)
	}
}

// 强杀遗留：上次记录的 db + backend pid 都要被停掉，且运行态文件被删除。
func TestCleanupStaleStopsRecordedProcesses(t *testing.T) {
	st := &stubEnv{}
	d := st.deps()
	p := ResolveRunStatePath("C:\\appdata")
	st.files[p] = MarshalRunState(RunState{DbPid: 111, BackendPid: 222})
	fastShell(d).CleanupStale("C:\\appdata", "D:\\app")

	seq := strings.Join(st.calls, " ")
	backendShutdown := strings.Index(seq, "shutdown:http://127.0.0.1:17860/api/v1/shutdown")
	dbShutdown := strings.Index(seq, "run:mysqladmin.exe:-u root --port 13306 shutdown")
	unlink := strings.Index(seq, "unlink:"+RunStateName)
	if !(0 <= backendShutdown && backendShutdown < dbShutdown) {
		t.Fatalf("应先停后端再停数据库：%q", seq)
	}
	if unlink < 0 {
		t.Fatalf("清理后应删除运行态文件：%q", seq)
	}
	if _, ok := st.files[p]; ok {
		t.Fatal("运行态文件应已删除")
	}
}

// 正常收尾（关窗）后不留运行态文件——下次启动不会误判为孤儿。
func TestRunClearsRunStateOnNormalExit(t *testing.T) {
	st := &stubEnv{}
	if err := fastShell(st.deps()).Run("C:\\appdata", "D:\\app", func() error { return nil }); err != nil {
		t.Fatalf("Run = %v", err)
	}
	seq := strings.Join(st.calls, " ")
	if !strings.Contains(seq, "write:"+RunStateName) {
		t.Fatalf("启动期应写运行态文件：%q", seq)
	}
	if _, ok := st.files[ResolveRunStatePath("C:\\appdata")]; ok {
		t.Fatal("正常收尾后运行态文件应被删除")
	}
}
