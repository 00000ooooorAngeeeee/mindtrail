// 打包脚本关键逻辑单测（node:test，无第三方依赖）。
// 覆盖纯决策函数：Main-Class 解析、jdeps 模块解析/合并、jlink/jpackage 参数构造、占位 ICO 生成、JDK 目录挑选（docs/08 §6 DoD「关键逻辑补单测」）。
import { test } from 'node:test'
import assert from 'node:assert'
import {
  readMainClass,
  parseModuleDeps,
  mergeModules,
  buildJlinkArgs,
  buildJpackageArgs,
  buildPlaceholderIco,
  preferJdkDir,
  EXTRA_MODULES,
} from '../package-backend.mjs'

test('readMainClass：解析 Spring Boot 3.2+ 的 launch.JarLauncher', () => {
  const mf = 'Manifest-Version: 1.0\nMain-Class: org.springframework.boot.loader.launch.JarLauncher\nStart-Class: com.trailmind.backend.TrailMindApplication\n'
  assert.strictEqual(readMainClass(mf), 'org.springframework.boot.loader.launch.JarLauncher')
})

test('readMainClass：解析 Spring Boot 3.0–3.1 的 loader.JarLauncher（CRLF）', () => {
  const mf = 'Main-Class: org.springframework.boot.loader.JarLauncher\r\n'
  assert.strictEqual(readMainClass(mf), 'org.springframework.boot.loader.JarLauncher')
})

test('readMainClass：缺 Main-Class 抛错', () => {
  assert.throws(() => readMainClass('Manifest-Version: 1.0\nStart-Class: x.y.Z\n'), /Main-Class/)
})

test('parseModuleDeps：解析逗号/换行分隔的模块名', () => {
  assert.deepStrictEqual(parseModuleDeps('java.base,java.sql, jdk.unsupported\njava.naming'), ['java.base', 'java.sql', 'jdk.unsupported', 'java.naming'])
})

test('parseModuleDeps：过滤非 JDK 模块与空白', () => {
  assert.deepStrictEqual(parseModuleDeps('java.base, org.foo, not.module, '), ['java.base'])
})

test('mergeModules：多组去重并排序', () => {
  assert.deepStrictEqual(mergeModules(['java.sql', 'java.base'], ['java.base', 'jdk.unsupported']), ['java.base', 'java.sql', 'jdk.unsupported'])
})

test('EXTRA_MODULES：反射兜底覆盖 MySQL/Java2D/中文 Locale 关键模块', () => {
  assert.ok(EXTRA_MODULES.includes('java.sql'))
  assert.ok(EXTRA_MODULES.includes('java.naming'))
  assert.ok(EXTRA_MODULES.includes('java.desktop'))
  assert.ok(EXTRA_MODULES.includes('jdk.localedata'))
})

test('buildJlinkArgs：含 strip 与 add-modules 顺序稳定', () => {
  const args = buildJlinkArgs({ output: 'C:/t/jre', modules: ['java.base', 'java.sql'] })
  assert.deepStrictEqual(args, ['--strip-debug', '--no-header-files', '--no-man-pages', '--add-modules', 'java.base,java.sql', '--output', 'C:/t/jre'])
})

test('buildJpackageArgs：含 app-image 类型、图标与 server.port', () => {
  const args = buildJpackageArgs({
    dest: 'C:/t', inputDir: 'C:/t/in', name: 'trailmind-backend',
    mainJar: 'trailmind-backend-0.0.1.jar', mainClass: 'org.springframework.boot.loader.launch.JarLauncher',
    runtimeImage: 'C:/t/jre', icon: 'C:/branding/icon.ico', javaOptions: '-Dserver.port=17860',
  })
  assert.deepStrictEqual(args, [
    '--type', 'app-image', '--name', 'trailmind-backend', '--dest', 'C:/t',
    '--input', 'C:/t/in', '--main-jar', 'trailmind-backend-0.0.1.jar',
    '--main-class', 'org.springframework.boot.loader.launch.JarLauncher',
    '--runtime-image', 'C:/t/jre', '--icon', 'C:/branding/icon.ico', '--java-options', '-Dserver.port=17860',
  ])
})

test('buildPlaceholderIco：ICO 头合法（单图 32×32 32bpp）', () => {
  const b = buildPlaceholderIco()
  assert.strictEqual(b.readUInt16LE(0), 0) // reserved
  assert.strictEqual(b.readUInt16LE(2), 1) // type=icon
  assert.strictEqual(b.readUInt16LE(4), 1) // count=1
  assert.strictEqual(b.readUInt8(6), 32) // width
  assert.strictEqual(b.readUInt8(7), 32) // height
  assert.strictEqual(b.readUInt32LE(22), 40) // BITMAPINFOHEADER 大小
  assert.strictEqual(b.length, 6 + 16 + 40 + 32 * 32 * 4 + Math.ceil(32 / 8) * 32)
})

test('buildPlaceholderIco：不同颜色产生不同字节（供图标替换验证）', () => {
  const a = buildPlaceholderIco({ rgb: [255, 0, 0] })
  const b = buildPlaceholderIco({ rgb: [0, 0, 255] })
  assert.notDeepStrictEqual(a, b)
})

test('preferJdkDir：候选含 21 时优先 21', () => {
  const pick = preferJdkDir(['jdk-25', 'jdk-21.0.10', 'jdk-17.0.9'])
  assert.match(pick, /21/)
})

test('preferJdkDir：无 21 回退 17', () => {
  assert.strictEqual(preferJdkDir(['jdk-25', 'jdk-17.0.9']), 'jdk-17.0.9')
})

test('preferJdkDir：低于 17 或无候选返回 null', () => {
  assert.strictEqual(preferJdkDir(['jdk-25']), null)
  assert.strictEqual(preferJdkDir(['jdk-11.0.1']), null)
})
