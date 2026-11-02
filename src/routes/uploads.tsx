import { createFileRoute } from '@tanstack/react-router'
import {
  CheckIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  ShirtIcon,
  Trash2Icon,
  UploadIcon,
  UserRoundIcon,
  XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/common/EmptyState'
import { Field } from '@/components/common/FormSection'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  addUploadAssets,
  assetToGalleryItem,
  clearUploadLibrary,
  deleteUploadAsset,
  fileToAsset,
  loadUploadLibrary,
  type UploadKind,
  type UploadedAsset,
  updateUploadAsset,
  UPLOAD_COSTUME_CATEGORIES,
  UPLOAD_PORTRAIT_CATEGORIES,
} from '@/lib/uploadLibrary'
import { useStudio } from '@/store/studioStore'

export const Route = createFileRoute('/uploads')({
  staticData: { title: '我的上传素材' },
  component: UploadsPage,
})

type KindFilter = 'all' | UploadKind

const KIND_META: Record<UploadKind, { label: string; icon: typeof UserRoundIcon; accept: string }> = {
  portrait: { label: '人脸人像', icon: UserRoundIcon, accept: 'image/*' },
  costume: { label: '服装图', icon: ShirtIcon, accept: 'image/*' },
}

function UploadsPage() {
  const { togglePortrait, toggleCostume } = useStudio()

  const [assets, setAssets] = useState<UploadedAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState(false)

  const [editing, setEditing] = useState<UploadedAsset | null>(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editTags, setEditTags] = useState('')
  const [editKeywords, setEditKeywords] = useState('')

  const portraitInputRef = useRef<HTMLInputElement | null>(null)
  const costumeInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let active = true
    loadUploadLibrary().then((list) => {
      if (!active) return
      setAssets(list)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  const categories = useMemo(() => {
    const pool =
      kindFilter === 'all' ? assets : assets.filter((a) => a.kind === kindFilter)
    return [...new Set(pool.map((a) => a.category).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'zh-CN')
    )
  }, [assets, kindFilter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assets.filter((a) => {
      if (kindFilter !== 'all' && a.kind !== kindFilter) return false
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false
      if (q) {
        const haystack = [a.name, a.keywords, a.category, ...a.tags].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [assets, kindFilter, categoryFilter, query])

  const counts = useMemo(
    () => ({
      portrait: assets.filter((a) => a.kind === 'portrait').length,
      costume: assets.filter((a) => a.kind === 'costume').length,
    }),
    [assets]
  )

  const handleFiles = useCallback(
    async (files: File[], kind: UploadKind) => {
      const images = files.filter((f) => f.type.startsWith('image/'))
      if (!images.length) {
        toast.error('请选择图片文件')
        return
      }
      setBusy(true)
      const added: UploadedAsset[] = []
      try {
        for (const file of images) {
          const payload = await fileToAsset(file, kind)
          added.push({
            ...payload,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
          })
        }
        const next = await addUploadAssets(added)
        setAssets(next)
        toast.success(`已上传 ${added.length} 张${KIND_META[kind].label}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '上传失败')
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const handleDelete = async (asset: UploadedAsset) => {
    const next = await deleteUploadAsset(asset.id)
    setAssets(next)
    toast.success(`已删除「${asset.name}」`)
  }

  const handleClearAll = async () => {
    await clearUploadLibrary()
    setAssets([])
    toast.success('已清空全部上传素材')
  }

  const openEditor = (asset: UploadedAsset) => {
    setEditing(asset)
    setEditName(asset.name)
    setEditCategory(asset.category)
    setEditTags(asset.tags.join('、'))
    setEditKeywords(asset.keywords)
  }

  const saveEditor = async () => {
    if (!editing) return
    const name = editName.trim()
    if (!name) {
      toast.error('名称不能为空')
      return
    }
    const tags = editTags
      .split(/[、,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    const next = await updateUploadAsset(editing.id, {
      name,
      category: editCategory,
      tags,
      keywords: editKeywords.trim(),
    })
    setAssets(next)
    setEditing(null)
    toast.success('已保存素材配置')
  }

  const addToRecipe = (asset: UploadedAsset) => {
    const item = assetToGalleryItem(asset)
    if (asset.kind === 'portrait') {
      togglePortrait(item.portrait)
    } else {
      toggleCostume(item.costume)
    }
  }

  const uploadZone = (kind: UploadKind) => {
    const Icon = KIND_META[kind].icon
    const inputRef = kind === 'portrait' ? portraitInputRef : costumeInputRef
    const isPortrait = kind === 'portrait'
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          void handleFiles(Array.from(e.dataTransfer.files || []), kind)
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-[22px] border-2 border-dashed p-6 text-center transition-colors',
          isDragging ? 'border-primary bg-primary/5' : 'border-border/60 bg-muted/40'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={KIND_META[kind].accept}
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(Array.from(e.target.files || []), kind)
            e.target.value = ''
          }}
        />
        <div className="flex size-11 items-center justify-center rounded-full bg-background text-primary">
          {busy ? <LoaderCircleIcon className="size-5 animate-spin motion-reduce:animate-none" /> : <Icon className="size-5" />}
        </div>
        <div>
          <div className="text-sm font-semibold">
            上传{KIND_META[kind].label}
            {isPortrait ? '（人脸 / 人像参考）' : '（服装 / 穿搭参考）'}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            拖拽图片到此处，或点击下方按钮批量选择（PNG / JPG / WebP）
          </div>
        </div>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <UploadIcon className="size-3.5" />
          选择{KIND_META[kind].label}
        </Button>
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="我的上传素材"
        description="上传自定义人脸人像图与服装图，配置名称、分类与检索词后可复用于角色配方"
        actions={
          assets.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={handleClearAll}>
              <Trash2Icon className="size-3.5" />
              清空素材库
            </Button>
          ) : undefined
        }
      />

      {/* 双上传区 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {uploadZone('portrait')}
        {uploadZone('costume')}
      </div>

      {/* 素材库 */}
      <div className="mt-4 space-y-3">
        <div className="grid gap-3 rounded-[22px] bg-muted p-4 md:grid-cols-[1fr_200px_auto]">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索素材名称、标签或检索词…"
              className="bg-background pl-9"
            />
          </div>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full bg-background">
              <SelectValue placeholder="全部分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              setQuery('')
              setCategoryFilter('all')
              setKindFilter('all')
            }}
          >
            <RotateCcwIcon className="size-3.5" />
            重置
          </Button>
        </div>

        {/* 类型筛选药丸 */}
        <div className="flex flex-wrap gap-2">
          {([
            ['all', `全部 (${assets.length})`],
            ['portrait', `人脸人像 (${counts.portrait})`],
            ['costume', `服装图 (${counts.costume})`],
          ] as [KindFilter, string][]).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                setKindFilter(kind)
                setCategoryFilter('all')
              }}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                kindFilter === kind
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="rounded-[22px] bg-muted p-10 text-center text-sm text-muted-foreground">
            正在读取素材库…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ImagePlusIcon}
            title={assets.length === 0 ? '还没有上传任何素材' : '没有匹配的素材'}
            description={
              assets.length === 0
                ? '上传人脸人像图与服装图，即可在此配置并复用到角色配方'
                : '试试更换筛选条件或重置'
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filtered.map((asset) => {
              const Icon = KIND_META[asset.kind].icon
              return (
                <div
                  key={asset.id}
                  className="group flex flex-col overflow-hidden rounded-[20px] bg-muted p-2 transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="relative aspect-4/5 overflow-hidden rounded-2xl bg-background">
                    <img
                      src={asset.thumb}
                      alt={asset.name}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                    <span className="absolute top-2 left-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      <Icon className="size-2.5" />
                      {KIND_META[asset.kind].label}
                    </span>
                    {asset.category && asset.category !== '上传' && (
                      <span className="absolute top-2 right-2 rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-900">
                        {asset.category}
                      </span>
                    )}
                    <div className="absolute inset-x-2 bottom-2 flex gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 flex-1 bg-black/75 text-[11px] font-semibold text-white hover:bg-primary"
                        onClick={() => addToRecipe(asset)}
                      >
                        <PlusIcon className="size-3" />
                        加入配方
                      </Button>
                    </div>
                  </div>

                  <div className="px-1.5 pt-2.5 pb-1">
                    <div className="line-clamp-2 min-h-[34px] text-xs leading-snug font-semibold">{asset.name}</div>
                    {asset.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {asset.tags.slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {asset.width}×{asset.height}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          aria-label={`编辑 ${asset.name}`}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                          onClick={() => openEditor(asset)}
                        >
                          <PencilIcon className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除 ${asset.name}`}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleDelete(asset)}
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 素材配置弹窗 */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] w-[95vw] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>配置上传素材</DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              <div className="flex gap-3">
                <img
                  src={editing.thumb}
                  alt={editing.name}
                  className="size-24 shrink-0 rounded-xl bg-muted object-contain"
                />
                <div className="min-w-0 flex-1 space-y-3">
                  <Field label="素材名称" htmlFor="asset-name">
                    <Input
                      id="asset-name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="例如：清冷系长发女主"
                    />
                  </Field>

                  <Field label="分类" htmlFor="asset-category">
                    <Select value={editCategory} onValueChange={setEditCategory}>
                      <SelectTrigger id="asset-category" className="w-full">
                        <SelectValue placeholder="选择分类" />
                      </SelectTrigger>
                      <SelectContent>
                        {(editing.kind === 'portrait'
                          ? UPLOAD_PORTRAIT_CATEGORIES
                          : UPLOAD_COSTUME_CATEGORIES
                        ).map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>

              <Field
                label="标签"
                htmlFor="asset-tags"
                hint="用顿号或逗号分隔，例如：黑色、修身、长发"
              >
                <Input
                  id="asset-tags"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="黑色、修身、长发"
                />
              </Field>

              <Field
                label="检索 / Prompt 关键词"
                htmlFor="asset-keywords"
                hint="用于生成角色的英文提示词，例如：elegant woman, black dress"
              >
                <Textarea
                  id="asset-keywords"
                  value={editKeywords}
                  onChange={(e) => setEditKeywords(e.target.value)}
                  placeholder="elegant woman, black dress, long hair"
                  className="min-h-[80px] font-mono text-xs"
                />
              </Field>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {editing.width} × {editing.height} · {(editing.bytes / 1024).toFixed(0)} KB
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    <XIcon className="size-3.5" />
                    取消
                  </Button>
                  <Button size="sm" onClick={saveEditor}>
                    <CheckIcon className="size-3.5" />
                    保存
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
