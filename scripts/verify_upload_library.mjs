/**
 * 上传素材核心逻辑验证脚本（Node 环境，模拟浏览器 API）
 * 覆盖：makeThumbnail 尺寸缩放、fileToAsset 元数据提取、
 *       addUploadAssets / updateUploadAsset / deleteUploadAsset 持久化语义、
 *       assetToGalleryItem 到图库条目的映射。
 */
import assert from 'node:assert/strict'

// ---------- 最小 IndexedDB / FileReader / Image / Canvas 模拟 ----------
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
                  // 真实 IndexedDB 在事务提交后触发 oncomplete
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
globalThis.FileReader = class {
  readAsDataURL(file) {
    this.result = file.__dataUrl
    this.onload?.()
  }
}
globalThis.Image = class {
  set src(v) {
    this._src = v
    // 从 data URL 头部解析出测试图片尺寸
    const m = /^data:image\/[^;]+;base64,/.exec(v)
    if (m && globalThis.__TEST_DIM) {
      this.width = globalThis.__TEST_DIM[0]
      this.height = globalThis.__TEST_DIM[1]
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
  createElement() {
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage() {},
      }),
      toDataURL: (type) => `data:${type};base64,THUMB`,
    }
  },
}
// Node 22 已内置 crypto.randomUUID，无需覆盖

const mod = await import('../src/lib/uploadLibrary.ts')

// ---------- 1. makeThumbnail 缩放 ----------
globalThis.__TEST_DIM = [800, 1000]
const thumb = await mod.makeThumbnail('data:image/png;base64,AAA')
assert.equal(thumb.width, 800, '原始宽度应保持')
assert.equal(thumb.height, 1000, '原始高度应保持')
assert.ok(thumb.thumb.startsWith('data:image/jpeg'), '缩略图应为 JPEG 以控制体积')

// 大图应被缩放到 512 长边
globalThis.__TEST_DIM = [2048, 1024]
const scaled = await mod.makeThumbnail('data:image/png;base64,AAA')
assert.equal(scaled.width, 2048, '原始宽度记录不变')
assert.ok(scaled.thumb.length > 0, '缩略图非空')

// ---------- 2. fileToAsset 元数据 ----------
globalThis.__TEST_DIM = [640, 480]
const payload = await mod.fileToAsset(
  { name: 'my-portrait.png', size: 12345, type: 'image/png', __dataUrl: 'data:image/png;base64,AAA' },
  'portrait'
)
assert.equal(payload.kind, 'portrait')
assert.equal(payload.name, 'my-portrait', '文件名应去掉扩展名')
assert.equal(payload.width, 640)
assert.equal(payload.height, 480)
assert.equal(payload.bytes, 12345)
assert.equal(payload.category, '上传')
assert.deepEqual(payload.tags, [])

// 非图片应被拒绝
await assert.rejects(
  () => mod.fileToAsset({ name: 'x.txt', size: 1, type: 'text/plain', __dataUrl: 'data:text/plain;base64,AA' }, 'portrait'),
  /不是图片文件/
)

// ---------- 3. 持久化 CRUD ----------
const asset = {
  id: 'asset-1',
  kind: 'portrait',
  name: '清冷系长发女主',
  category: '上传',
  tags: [],
  keywords: '',
  url: 'data:image/png;base64,ORIG',
  thumb: 'data:image/jpeg;base64,THUMB',
  width: 800,
  height: 1000,
  bytes: 999,
  createdAt: 1,
}

let list = await mod.addUploadAssets([asset])
assert.equal(list.length, 1, '新增后应有 1 条')
assert.equal(list[0].id, 'asset-1')

list = await mod.addUploadAssets([{ ...asset, id: 'asset-2', kind: 'costume', name: '红裙' }])
assert.equal(list.length, 2, '批量新增后应有 2 条')
assert.equal(list[0].id, 'asset-2', '新素材应排在最前')

// 重新加载验证落盘
let reloaded = await mod.loadUploadLibrary()
assert.equal(reloaded.length, 2, '重新加载后应有 2 条')
assert.equal(reloaded[0].id, 'asset-2')

list = await mod.updateUploadAsset('asset-1', {
  name: '改名后的女主',
  category: '正脸参考',
  tags: ['长发', '清冷'],
  keywords: 'elegant woman, long hair',
})
const updated = list.find((x) => x.id === 'asset-1')
assert.equal(updated.name, '改名后的女主')
assert.equal(updated.category, '正脸参考')
assert.deepEqual(updated.tags, ['长发', '清冷'])
assert.equal(updated.keywords, 'elegant woman, long hair')
assert.equal(updated.url, asset.url, '元数据更新不应改动图片数据')

list = await mod.deleteUploadAsset('asset-1')
assert.equal(list.length, 1)
assert.equal(list[0].id, 'asset-2')

list = await mod.clearUploadLibrary()
assert.equal(list.length, 0)
assert.equal((await mod.loadUploadLibrary()).length, 0, '清空后重新加载应为空')

// ---------- 4. assetToGalleryItem 映射 ----------
const p = mod.assetToGalleryItem(updated)
assert.equal(p.portrait.source, 'upload')
assert.equal(p.portrait.分区, '正脸参考')
assert.equal(p.portrait.发型名称, '改名后的女主')
assert.equal(p.portrait.标题, '改名后的女主')
assert.equal(p.portrait.缩略图, updated.thumb)
assert.equal(p.portrait.原图, updated.url)
assert.equal(p.portrait.宽, 800)
assert.equal(p.portrait.热门, false)

const costumeAsset = {
  ...updated,
  kind: 'costume',
  category: '连衣裙',
  tags: ['红色'],
  keywords: 'red dress',
}
const c = mod.assetToGalleryItem(costumeAsset)
assert.equal(c.costume.分类, '连衣裙')
assert.equal(c.costume.服装名称, '改名后的女主')
assert.deepEqual(c.costume.标签, ['红色'])
assert.equal(c.costume.关键词, 'red dress')
assert.equal(c.costume.预览图, costumeAsset.thumb)

// ---------- 5. 脏数据容错 ----------
stores.set('pose_atlas_upload_library_v1', [
  { id: 'x', kind: 'bogus', name: '脏数据' },
  { id: 'y', kind: 'portrait', name: '无标签' },
  null,
])
const dirty = await mod.loadUploadLibrary()
assert.equal(dirty.length, 1, '非法 kind 与 null 应被过滤')
assert.equal(dirty[0].id, 'y')
assert.deepEqual(dirty[0].tags, [], '缺失 tags 应补空数组')
assert.equal(dirty[0].thumb, dirty[0].url, '缺失 thumb 应回退到 url')

console.log('✓ 全部 5 组断言通过')
console.log('  · 缩略图生成与尺寸记录')
console.log('  · fileToAsset 元数据提取与非图片拒绝')
console.log('  · IndexedDB 持久化 CRUD（新增/更新/删除/清空/重载）')
console.log('  · assetToGalleryItem 到 PortraitItem / CostumeItem 映射')
console.log('  · 脏数据容错')
