// JDK 21 解析纯函数单测（node:test，无第三方依赖）。
// 覆盖 findJdk21 的目录名匹配与 bin/java.exe 存在性判定（docs/08 §6 DoD「关键逻辑补单测」）。
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findJdk21 } from '../java.mjs'

// 造一个临时根目录，内含若干「假 JDK」子目录（name 为目录名，hasJava 决定是否放 bin/java.exe）。
function makeFakeJdkRoot(entries) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'trailmind-jdk-'))
  for (const [name, hasJava] of entries) {
    const dir = path.join(root, name, 'bin')
    mkdirSync(dir, { recursive: true })
    if (hasJava) writeFileSync(path.join(dir, 'java.exe'), '')
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('findJdk21：命中 jdk-21 子目录并返回其路径', () => {
  const { root, cleanup } = makeFakeJdkRoot([
    ['jdk-21.0.10', true],
    ['jdk-25', true],
  ])
  try {
    assert.strictEqual(findJdk21([root]), path.join(root, 'jdk-21.0.10'))
  } finally {
    cleanup()
  }
})

test('findJdk21：跳过 jdk-25 等非 21 子目录', () => {
  const { root, cleanup } = makeFakeJdkRoot([['jdk-25', true]])
  try {
    assert.strictEqual(findJdk21([root]), null)
  } finally {
    cleanup()
  }
})

test('findJdk21：目录名匹配但缺 bin/java.exe 时跳过', () => {
  const { root, cleanup } = makeFakeJdkRoot([['jdk-21.0.10', false]])
  try {
    assert.strictEqual(findJdk21([root]), null)
  } finally {
    cleanup()
  }
})

test('findJdk21：空目录或不存在目录返回 null', () => {
  assert.strictEqual(findJdk21([]), null)
  assert.strictEqual(findJdk21(['不存在的路径']), null)
})
