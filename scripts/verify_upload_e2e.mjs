/**
 * 端到端上传链路验证：真实 PNG 文件 → fileToAsset → 落库 → 图库条目
 * 使用真实测试图片文件（纯 Python 生成的合法 PNG），验证尺寸解析与体积统计。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const IMGDIR = path.resolve(ROOT, '..', 'testimgs')

// ---------- IndexedDB mock ----------
const stores = new Map()
globalThis.indexedDB = {
  open() {
    const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null }
    setTimeout(() => {
      const db = {
        objectStoreNames: { contains: () => true },
        transaction() {
          const tx = {
            objectStore() {
              return {
                get(key) {
                  const r = { onsuccess: null, onerror: null, result: stores.get(key) }
                  setTimeout(() => r.onsuccess?.(), 0)
                  return r
                },
                put(value, key) {
                  stores.set(key, value)
                  setTimeout(() => tx.oncomplete?.(), 0)
                  return {}
                },
              }
            },
            oncomplete: null,
            onerror: null,
          }
          return tx
        },
      }
      req.result = db
      req.onsuccess?.()
    }, 0)
    return req
  },
}

// ---------- 真实 PNG 尺寸解析（读取 IHDR chunk） ----------
function pngSize(filePath) {
  const buf = fs.readFileSync(filePath)
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG magic')
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  return { w, h, bytes: buf.length }
}

globalThis.FileReader = class {
  readAsDataURL(file) {
    this.result = `data:image/png;base64,${file.__base64}`
    this.onload?.()
  }
}
globalThis.Image = class {
  set src(v) {
    this._src = v
    const dims = globalThis.__TEST_DIM
    if (dims) {
      this.width = dims.w
      this.height = dims.h
      setTimeout(() => this.onload?.(), 0)
    } else {
      setTimeout(() => this.onerror?.(), 0)
    }
  }
  get src() {
    return this._src
  }
}
globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
    toDataURL: (type) => `data:${type};base64,THUMBNAIL`,
  }),
}

const mod = await import('../src/lib/uploadLibrary.ts')

// ---------- 读取真实测试图片 ----------
const cases = [
  { file: 'portrait_test.png', kind: 'portrait', expectW: 800, expectH: 1000 },
  { file: 'costume_test.png', kind: 'costume', expectW: 700, expectH: 900 },
]

for (const c of cases) {
  const fp = path.join(IMGDIR, c.file)
  assert.ok(fs.existsSync(fp), `测试图片存在: ${c.file}`)
  const { w, h, bytes } = pngSize(fp)
  assert.equal(w, c.expectW, `${c.file} 宽度解析正确`)
  assert.equal(h, c.expectH, `${c.file} 高度解析正确`)

  globalThis.__TEST_DIM = { w, h }
  const base64 = fs.readFileSync(fp).toString('base64')
  const file = {
    name: c.file,
    size: bytes,
    type: 'image/png',
    __base64: base64,
  }

  const payload = await mod.fileToAsset(file, c.kind)
  assert.equal(payload.kind, c.kind)
  assert.equal(payload.name, c.file.replace(/\.[^.]+$/, ''), '名称去掉扩展名')
  assert.equal(payload.width, w, `${c.file} 宽��写入正确`)
  assert.equal(payload.height, h, `${c.file} 高度写入正确`)
  assert.equal(payload.bytes, bytes, `${c.file} 体积统计正确`)
  assert.ok(payload.url.startsWith('data:image/png;base64,'), '原图为 PNG Data URL')
  assert.ok(payload.thumb.startsWith('data:image/jpeg'), '缩略图为 JPEG')
  console.log(`✓ ${c.file} → ${c.kind}: ${payload.width}×${payload.height}, ${payload.bytes}B, 原图 ${payload.url.length} 字符`)
}

// ---------- 落库 + 图库集成 ----------
globalThis.__TEST_DIM = { w: 800, h: 1000 }
const p = await mod.fileToAsset(
  { name: 'portrait_test.png', size: 6238, type: 'image/png', __base64: 'AAA' },
  'portrait'
)
const c2 = await mod.fileToAsset(
  { name: 'costume_test.png', size: 5912, type: 'image/png', __base64: 'BBB' },
  'costume'
)

let lib = await mod.addUploadAssets([
  { ...p, id: 'u-portrait', createdAt: 1 },
  { ...c2, id: 'u-costume', createdAt: 2 },
])
assert.equal(lib.length, 2)

const reloaded = await mod.loadUploadLibrary()
const portraitAsset = reloaded.find((x) => x.id === 'u-portrait')
const costumeAsset = reloaded.find((x) => x.id === 'u-costume')
assert.ok(portraitAsset, '人像素材已持久化')
assert.ok(costumeAsset, '服装素材已持久化')

// 模拟 portraits.tsx / costumes.tsx 的集成逻辑
const galleryPortraits = reloaded
  .filter((a) => a.kind === 'portrait')
  .map((a) => mod.assetToGalleryItem(a).portrait)
const galleryCostumes = reloaded
  .filter((a) => a.kind === 'costume')
  .map((a) => mod.assetToGalleryItem(a).costume)

assert.equal(galleryPortraits.length, 1, '人像库应合并 1 条上传素材')
assert.equal(galleryCostumes.length, 1, '服装库应合并 1 条上传素材')
assert.equal(galleryPortraits[0].分区, '上传')
assert.equal(galleryCostumes[0].分类, '上传')

// Data URL 不能带 / 前缀 —— referenceImageUrl 必须原样返回
const { referenceImageUrl } = await import('../src/lib/recipeImages.ts')
assert.equal(
  referenceImageUrl(galleryPortraits[0].缩略图),
  galleryPortraits[0].缩略图,
  'Data URL 不得加 / 前缀'
)
assert.equal(
  referenceImageUrl(galleryPortraits[0].原图),
  galleryPortraits[0].原图,
  '原图 Data URL 原样透传'
)
// 内置图库路径仍应加 / 前缀
assert.equal(referenceImageUrl('thumbs/portrait/x.webp'), '/thumbs/portrait/x.webp', '内置路径保持 / 前缀')

console.log('✓ 图库集成验证通过（上传素材可被图库页读取并正确渲染路径）')
