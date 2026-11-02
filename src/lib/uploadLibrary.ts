import { idbGet, idbSet } from '@/lib/idbStorage'
import type { CostumeItem, PortraitItem } from '@/types/gallery'

/** 上传素材的用途分类：人脸人像 / 服装 */
export type UploadKind = 'portrait' | 'costume'

export interface UploadedAsset {
  id: string
  kind: UploadKind
  /** 用户可编辑的显示名称 */
  name: string
  /** 分类标签（人像：发型分区；服装：服装分类） */
  category: string
  /** 自由标签，用于筛选 */
  tags: string[]
  /** 检索关键词 */
  keywords: string
  /** 原图 Data URL */
  url: string
  /** 缩略图 Data URL（长边 512，体积更小） */
  thumb: string
  width: number
  height: number
  bytes: number
  createdAt: number
}

const LIBRARY_KEY = 'pose_atlas_upload_library_v1'

/** 人像默认分类，与图库的分区命名保持一致 */
export const UPLOAD_PORTRAIT_CATEGORIES = ['上传', '正脸参考', '造型氛围'] as const
/** 服装默认分类 */
export const UPLOAD_COSTUME_CATEGORIES = ['上传', '外套', '上衣', '连衣裙', '裤装', '鞋履', '配饰'] as const

export async function loadUploadLibrary(): Promise<UploadedAsset[]> {
  const list = await idbGet<UploadedAsset[]>(LIBRARY_KEY)
  if (!Array.isArray(list)) return []
  return list
    .filter((x) => x && typeof x.id === 'string' && (x.kind === 'portrait' || x.kind === 'costume'))
    .map((x) => ({
      ...x,
      tags: Array.isArray(x.tags) ? x.tags : [],
      keywords: x.keywords ?? '',
      category: x.category || '上传',
      thumb: x.thumb || x.url,
    }))
}

export async function saveUploadLibrary(list: UploadedAsset[]): Promise<void> {
  await idbSet(LIBRARY_KEY, list)
}

/** 新增素材并持久化，返回落库后的完整列表 */
export async function addUploadAsset(asset: UploadedAsset): Promise<UploadedAsset[]> {
  const list = await loadUploadLibrary()
  const next = [asset, ...list]
  await saveUploadLibrary(next)
  return next
}

/** 批量新增素材，新素材排在最前 */
export async function addUploadAssets(assets: UploadedAsset[]): Promise<UploadedAsset[]> {
  if (!assets.length) return loadUploadLibrary()
  const list = await loadUploadLibrary()
  const next = [...assets, ...list]
  await saveUploadLibrary(next)
  return next
}

/** 按 id 更新素材的元数据（不改动图片数据） */
export async function updateUploadAsset(
  id: string,
  patch: Partial<Pick<UploadedAsset, 'name' | 'category' | 'tags' | 'keywords'>>
): Promise<UploadedAsset[]> {
  const list = await loadUploadLibrary()
  const next = list.map((x) => (x.id === id ? { ...x, ...patch } : x))
  await saveUploadLibrary(next)
  return next
}

/** 删除素材 */
export async function deleteUploadAsset(id: string): Promise<UploadedAsset[]> {
  const list = await loadUploadLibrary()
  const next = list.filter((x) => x.id !== id)
  await saveUploadLibrary(next)
  return next
}

/** 清空全部上传素材 */
export async function clearUploadLibrary(): Promise<UploadedAsset[]> {
  await saveUploadLibrary([])
  return []
}

/** 生成缩略图：长边限制为 maxSide，输出 JPEG 以控制体积 */
export async function makeThumbnail(
  dataUrl: string,
  maxSide = 512
): Promise<{ thumb: string; width: number; height: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('解析图片失败'))
    el.src = dataUrl
  })
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(img, 0, 0, w, h)
  return { thumb: canvas.toDataURL('image/jpeg', 0.82), width: img.width, height: img.height }
}

/** 读取文件为 Data URL，并同时产出缩略图与尺寸信息 */
export async function fileToAsset(
  file: File,
  kind: UploadKind
): Promise<Omit<UploadedAsset, 'id' | 'createdAt'>> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} 不是图片文件`)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`))
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
  const { thumb, width, height } = await makeThumbnail(dataUrl)
  const name = file.name.replace(/\.[^.]+$/, '').trim() || '未命名素材'
  return {
    kind,
    name,
    category: '上传',
    tags: [],
    keywords: '',
    url: dataUrl,
    thumb,
    width,
    height,
    bytes: file.size,
  }
}

/** 把上传素材转换为图库条目，可直接加入角色配方 */
export function assetToGalleryItem(asset: UploadedAsset): {
  portrait: PortraitItem
  costume: CostumeItem
} {
  const base = {
    id: asset.id,
    source: 'upload' as const,
    原图: asset.url,
    缩略图: asset.thumb,
    检索: asset.keywords || asset.name,
  }
  const portrait: PortraitItem = {
    ...base,
    分区: asset.category || '上传',
    发长: '',
    发型名称: asset.name,
    标题: asset.name,
    宽: asset.width,
    高: asset.height,
    字节数: asset.bytes,
    精选: false,
    热门: false,
  }
  const costume: CostumeItem = {
    ...base,
    分类: asset.category || '上传',
    服装名称: asset.name,
    标签: asset.tags,
    关键词: asset.keywords,
    预览图: asset.thumb,
  }
  return { portrait, costume }
}
