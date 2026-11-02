/** 解析 @/ 别名与省略扩展名的相对导入，供 Node 直接运行 TS 模块（验证脚本用） */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')

function withExtension(absPath) {
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (fs.existsSync(absPath + ext)) return absPath + ext
  }
  return null
}

export function resolve(specifier, context, nextResolve) {
  // @/ 别名 → src/
  if (specifier.startsWith('@/')) {
    const abs = path.join(ROOT, 'src', specifier.slice(2))
    const resolved = withExtension(abs)
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context)
  }

  // 省略扩展名的相对导入
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !/\.(m?[jt]sx?|json)$/i.test(specifier) &&
    context.parentURL?.startsWith('file:')
  ) {
    const abs = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    const resolved = withExtension(abs)
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context)
  }

  return nextResolve(specifier, context)
}

export function load(url, context, nextLoad) {
  if (url.startsWith('file://') && url.endsWith('.ts')) {
    return nextLoad(url, { ...context, format: 'module-typescript' })
  }
  return nextLoad(url, context)
}
