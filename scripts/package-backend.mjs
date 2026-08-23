// 打包后端 app-image（specs 自包含打包 Phase 1 / 设计文档 §4.2、§4.5）。
// 目标：把 fat jar 打包成带 bundled JRE 的 app-image（backend/target/trailmind-backend/），用户无需预装 Java。
// 流程：
//   1) 解压 fat jar（BOOT-INF/classes + BOOT-INF/lib + META-INF/MANIFEST.MF）供 jdeps 分析（fat jar 嵌套 lib，jdeps 不自动展开）；
//   2) 读 MANIFEST.MF 的 Main-Class（Spring Boot 3.2+ 为 org.springframework.boot.loader.launch.JarLauncher）；
//   3) jdeps --print-module-deps 计算所需 JDK 模块，合并反射/SPI 兜底模块（EXTRA_MODULES）；
//   4) jlink 生成最小 JRE（backend/target/jre，--strip-debug --no-header-files --no-man-pages）；
//   5) jpackage --type app-image 产出 app-image（bundled JRE + 图标 branding/icon.ico）。
// 图标约定：改 branding/icon.ico 后重跑本脚本即替换 exe 图标；图标缺失时自动生成占位（buildPlaceholderIco）。
// 前置：backend/target/trailmind-backend-0.0.1.jar 已由 `npm run build`（mvn package）产出；本机装 JDK 21（jdeps/jlink/jpackage）。
// 用法：node scripts/package-backend.mjs
import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = path.join(ROOT, 'backend')
const TARGET = path.join(BACKEND, 'target')
const JAR = path.join(TARGET, 'trailmind-backend-0.0.1.jar')
const EXPLODED = path.join(TARGET, 'exploded')
const JRE = path.join(TARGET, 'jre')
const JPACKAGE_INPUT = path.join(TARGET, 'jpackage-input')
const APP_IMAGE = path.join(TARGET, 'trailmind-backend')
const ICON = path.join(ROOT, 'branding', 'icon.ico')

const APP_NAME = 'trailmind-backend'
const MAIN_JAR = 'trailmind-backend-0.0.1.jar'
const JAVA_VERSION = '21'

// jdeps 静态分析可能遗漏的「反射/SPI 动态加载」模块（Spring Boot + MySQL Connector/J + JGit + Java2D PNG）。
// 若冷启仍报 ClassNotFoundException，在此补充后重跑 jlink（设计文档 §10 风险表）。
export const EXTRA_MODULES = [
  'java.sql',           // HikariCP 反射加载 com.mysql.cj.jdbc.Driver（DriverManager/Connection）
  'java.naming',        // MySQL Connector/J 与 Spring 的 JNDI 反射
  'java.management',    // Spring Boot / Logback JMX
  'jdk.unsupported',    // sun.misc.Unsafe（若干依赖库反射）
  'jdk.crypto.ec',      // TLS 椭圆曲线（MySQL SSL / 未来 HTTPS）
  'java.security.jgss', // MySQL GSS/Kerberos 认证
  'java.desktop',       // MindmapPngRenderer 的 Java2D PNG 整图导出
  'java.logging',       // JUL（JGit / Logback 桥）
  'jdk.localedata',     // 中文 Locale 数据（日期/数字格式化，SPI 不随 requires 传递）
  'java.net.http',      // HttpClient（Spring 部分路径可选）
]

// —— 纯函数（单测覆盖：scripts/test/package-backend.test.mjs）——

// 从 MANIFEST.MF 文本解析 Main-Class。
// Spring Boot 3.2+ 为 org.springframework.boot.loader.launch.JarLauncher；3.0–3.1 为 org.springframework.boot.loader.JarLauncher。
export function readMainClass(manifestText) {
  const m = /^Main-Class:\s*(\S+)\s*$/m.exec(manifestText)
  if (!m) throw new Error('MANIFEST.MF 缺少 Main-Class 属性')
  return m[1]
}

// 解析 `jdeps --print-module-deps` 输出（逗号/空白分隔模块名）为数组，仅保留 JDK 模块。
export function parseModuleDeps(stdout) {
  return [...new Set(String(stdout).split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^(java\.|jdk\.|javafx\.)/.test(s)))]
}

// 合并多组模块为去重、排序列表（jlink 会再补传递 requires 的模块，故只需根集 + 反射兜底）。
export function mergeModules(...groups) {
  return [...new Set(groups.flat().map((s) => s.trim()).filter(Boolean))].sort()
}

// 构造 jlink 参数（不依赖具体 jdeps/jlink 可执行路径，便于单测）。
export function buildJlinkArgs({ output, modules }) {
  return ['--strip-debug', '--no-header-files', '--no-man-pages', '--add-modules', modules.join(','), '--output', output]
}

// 构造 jpackage 参数（--type app-image：无需 WiX/签名，产出目录而非安装包）。
export function buildJpackageArgs({ dest, inputDir, name, mainJar, mainClass, runtimeImage, icon, javaOptions }) {
  return [
    '--type', 'app-image',
    '--name', name,
    '--dest', dest,
    '--input', inputDir,
    '--main-jar', mainJar,
    '--main-class', mainClass,
    '--runtime-image', runtimeImage,
    '--icon', icon,
    '--java-options', javaOptions,
  ]
}

// 从候选 JDK 目录名中挑选打包用 JDK（优先 preferred=21，其次 17，回退 null）。
export function preferJdkDir(names, preferred = 21) {
  const major = (n) => {
    const m = /(?:jdk[-\s]*|temurin[-\s]*|msopenjdk[-\s]*|openjdk[-\s]*|zulu[-\s]*)(\d+)/i.exec(n)
    return m ? Number(m[1]) : 0
  }
  const exact = names.filter((n) => major(n) === preferred).sort()
  if (exact.length) return exact[0]
  const lower = names.filter((n) => major(n) >= 17 && major(n) < preferred).sort((a, b) => major(b) - major(a))
  return lower[0] ?? null
}

// 生成占位 ICO（单图 32×32 32bpp BGRA，含 AND 掩码全 0=不透明）。返回 Buffer。
export function buildPlaceholderIco({ size = 32, rgb = [40, 116, 166] } = {}) {
  const [r, g, b] = rgb
  const xorBytes = size * size * 4
  const andBytes = Math.ceil(size / 8) * size // AND 掩码每行 4 字节对齐
  const dibSize = 40 + xorBytes + andBytes
  const buf = Buffer.alloc(6 + 16 + dibSize)
  // ICONDIR
  buf.writeUInt16LE(0, 0) // reserved
  buf.writeUInt16LE(1, 2) // type=icon
  buf.writeUInt16LE(1, 4) // count=1
  // ICONDIRENTRY
  buf.writeUInt8(size, 6) // width（32 直接写 32）
  buf.writeUInt8(size, 7) // height
  buf.writeUInt8(0, 8) // colorCount
  buf.writeUInt8(0, 9) // reserved
  buf.writeUInt16LE(1, 10) // planes
  buf.writeUInt16LE(32, 12) // bitCount
  buf.writeUInt32LE(dibSize, 14) // bytesInRes
  buf.writeUInt32LE(22, 18) // imageOffset
  // BITMAPINFOHEADER
  const p = 22
  buf.writeUInt32LE(40, p + 0) // headerSize
  buf.writeInt32LE(size, p + 4) // width
  buf.writeInt32LE(size * 2, p + 8) // height = XOR + AND
  buf.writeUInt16LE(1, p + 12) // planes
  buf.writeUInt16LE(32, p + 14) // bitCount
  buf.writeUInt32LE(0, p + 16) // compression BI_RGB
  buf.writeUInt32LE(xorBytes, p + 20) // imageSize（XOR 区大小）
  buf.writeInt32LE(0, p + 24) // xPelsPerMeter
  buf.writeInt32LE(0, p + 28) // yPelsPerMeter
  buf.writeUInt32LE(0, p + 32) // clrUsed
  buf.writeUInt32LE(0, p + 36) // clrImportant
  // XOR 像素（自底向上，每像素 BGRA）
  let o = p + 40
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      buf.writeUInt8(b, o)
      buf.writeUInt8(g, o + 1)
      buf.writeUInt8(r, o + 2)
      buf.writeUInt8(255, o + 3)
      o += 4
    }
  }
  // AND 掩码紧随 XOR，Buffer.alloc 已零填充（全 0 = 不透明）
  return buf
}

// —— 编排（环境相关，不做单测）——

function run(cmd, args, opts = {}) {
  console.log(`\n[package-backend] ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true, ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
  return r
}

// 捕获子进程 stdout 到文件（用文件 fd 而非管道，规避沙箱命名管道 EPERM，见 docs/11 §13）。
function capture(cmd, args, outFile) {
  console.log(`\n[package-backend] ${cmd} ${args.join(' ')}`)
  const fd = openSync(outFile, 'w')
  try {
    const r = spawnSync(cmd, args, { stdio: ['ignore', fd, 'inherit'], windowsHide: true })
    if (r.error) throw r.error
    if (r.status !== 0) process.exit(r.status ?? 1)
  } finally {
    closeSync(fd)
  }
  return readFileSync(outFile, 'utf8')
}

function resolveJdkBin() {
  if (process.env.TRAILMIND_JDK_HOME) return path.join(process.env.TRAILMIND_JDK_HOME, 'bin')
  const bases = ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft', 'C:\\Program Files\\Zulu']
  const found = []
  for (const base of bases) {
    if (!existsSync(base)) continue
    for (const n of readdirSync(base)) {
      const bin = path.join(base, n, 'bin')
      if (/^(jdk|temurin|msopenjdk|zulu)/i.test(n) && existsSync(path.join(bin, 'jlink.exe'))) found.push({ name: n, bin })
    }
  }
  const pick = preferJdkDir(found.map((f) => f.name), Number(JAVA_VERSION))
  if (pick) return found.find((f) => f.name === pick).bin
  if (process.env.JAVA_HOME) return path.join(process.env.JAVA_HOME, 'bin')
  throw new Error('未找到 JDK 21（含 jlink）：请安装 JDK 21 或设 TRAILMIND_JDK_HOME 指向其根目录')
}

function ensureIcon() {
  if (existsSync(ICON)) return
  mkdirSync(path.dirname(ICON), { recursive: true })
  writeFileSync(ICON, buildPlaceholderIco())
  console.log(`[package-backend] 已生成占位图标 ${path.relative(ROOT, ICON)}（可替换为自定义 ico 后重跑）`)
}

function main() {
  if (!existsSync(JAR)) {
    console.error(`[package-backend] 缺少 ${JAR}，请先运行 npm run build`)
    process.exit(1)
  }

  const bin = resolveJdkBin()
  const jdeps = path.join(bin, 'jdeps.exe')
  const jlink = path.join(bin, 'jlink.exe')
  const jpackage = path.join(bin, 'jpackage.exe')
  const jarTool = path.join(bin, 'jar.exe')
  console.log(`[package-backend] 使用 JDK：${path.dirname(bin)}`)

  // 1) 解压 fat jar 的 BOOT-INF（classes + lib）+ MANIFEST，供 jdeps 分析（fat jar 嵌套 lib jdeps 不自动展开）
  if (existsSync(EXPLODED)) rmSync(EXPLODED, { recursive: true, force: true })
  mkdirSync(EXPLODED, { recursive: true })
  run(jarTool, ['xf', JAR, 'BOOT-INF/classes', 'BOOT-INF/lib', 'META-INF/MANIFEST.MF'], { cwd: EXPLODED })

  // 2) 读 Main-Class（Spring Boot 各版本 loader 类名不同，从 MANIFEST 读取最稳）
  const manifestText = readFileSync(path.join(EXPLODED, 'META-INF', 'MANIFEST.MF'), 'utf8')
  const mainClass = readMainClass(manifestText)
  console.log(`[package-backend] Main-Class = ${mainClass}`)

  // 3) jdeps 分析所需 JDK 模块（递归跟随 classpath 依赖）
  const libDir = path.join(EXPLODED, 'BOOT-INF', 'lib')
  const classPath = readdirSync(libDir).filter((f) => f.endsWith('.jar')).map((f) => path.join(libDir, f)).join(path.delimiter)
  const depsFile = path.join(TARGET, 'jdeps-modules.txt')
  const depsOut = capture(jdeps, [
    '--ignore-missing-deps', '--print-module-deps', '--multi-release', JAVA_VERSION, '--recursive',
    '--class-path', classPath, path.join(EXPLODED, 'BOOT-INF', 'classes'),
  ], depsFile)
  const modules = mergeModules(parseModuleDeps(depsOut), EXTRA_MODULES)
  console.log(`[package-backend] jlink 模块（${modules.length}）：${modules.join(',')}`)

  // 4) jlink 生成最小 JRE
  if (existsSync(JRE)) rmSync(JRE, { recursive: true, force: true })
  run(jlink, buildJlinkArgs({ output: JRE, modules }))

  // 5) jpackage 出 app-image（input 目录只放主 jar，避免把 target 下 jre/exploded 一并打包）
  if (existsSync(JPACKAGE_INPUT)) rmSync(JPACKAGE_INPUT, { recursive: true, force: true })
  mkdirSync(JPACKAGE_INPUT, { recursive: true })
  copyFileSync(JAR, path.join(JPACKAGE_INPUT, MAIN_JAR))
  if (existsSync(APP_IMAGE)) rmSync(APP_IMAGE, { recursive: true, force: true })
  ensureIcon()
  run(jpackage, buildJpackageArgs({
    dest: TARGET,
    inputDir: JPACKAGE_INPUT,
    name: APP_NAME,
    mainJar: MAIN_JAR,
    mainClass,
    runtimeImage: JRE,
    icon: ICON,
    javaOptions: '-Dserver.port=17860',
  }))

  // 清理解压产物
  if (existsSync(EXPLODED)) rmSync(EXPLODED, { recursive: true, force: true })
  console.log(`\n[package-backend] 完成：app-image 位于 ${APP_IMAGE}（bundled JRE，用户无需预装 Java）`)
}

// 仅作为入口脚本时执行（被 import 单测时不触发打包）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
