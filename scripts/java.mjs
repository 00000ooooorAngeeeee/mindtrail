// 解析 JDK 21 路径（build/dev 脚本共用）。MyBatis-Plus 在 Java 25 下无法创建 sqlSessionTemplate，
// 后端构建与运行必须用 JDK 21（见 CHANGELOG 会话 1/7、docs/10 §10 常见坑）。
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

// 纯函数：在候选根目录下找 JDK 21（子目录名 jdk-21* 且含 bin/java.exe），返回完整路径或 null。
export function findJdk21(dirs) {
  for (const root of dirs) {
    if (!root || !existsSync(root)) continue
    let names
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const name of names) {
      if (!/^jdk-21/i.test(name)) continue
      const home = path.join(root, name)
      if (existsSync(path.join(home, 'bin', 'java.exe'))) return home
    }
  }
  return null
}

// 解析 JDK 21 的 JAVA_HOME：已设且为 jdk-21 则直接复用，否则扫描 Windows 常见安装位置。
export function resolveJdk21() {
  const env = process.env.JAVA_HOME
  if (env && /(^|[\\/])jdk-21/i.test(env) && existsSync(path.join(env, 'bin', 'java.exe'))) return env

  const roots = []
  const add = (p) => {
    if (p) roots.push(path.join(p, 'Java'), path.join(p, 'Eclipse Adoptium'))
  }
  add(process.env['ProgramFiles'])
  add(process.env['ProgramFiles(x86)'])
  const local = process.env['LOCALAPPDATA']
  if (local) roots.push(path.join(local, 'Programs', 'Eclipse Adoptium'))

  return findJdk21(roots)
}
