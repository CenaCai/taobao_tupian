import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

// 本地缺失的素材（尤其是体积庞大的 img/ 原图）从远程仓库按需回源，
// 命中后写入本地缓存，避免重复下载 1 GB 素材。
// 可通过环境变量控制：
//   REMOTE_ASSET_BASE  指定远程源（默认本仓库 main 分支）
//   REMOTE_ASSET_OFF=1 禁用回源，缺失素材一律返回 404
const REMOTE_RAW_BASE =
  process.env.REMOTE_ASSET_BASE ||
  'https://raw.githubusercontent.com/CenaCai/taobao_tupian/main'
const REMOTE_ASSET_ENABLED = process.env.REMOTE_ASSET_OFF !== '1'

const inflight = new Map<string, Promise<Buffer | null>>()

// 注意：Node 内置 fetch(undici) 在本机代理环境下会连接超时，
// 原生 https.get 直连可用，因此回源走 https 模块。
function httpsGet(url: string, redirects = 3): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 30000 }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume()
        resolve(httpsGet(new URL(res.headers.location, url).toString(), redirects - 1))
        return
      }
      if (status !== 200) {
        res.resume()
        resolve(null)
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', () => resolve(null))
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
  })
}

async function fetchRemoteAsset(urlPath: string): Promise<Buffer | null> {
  if (!REMOTE_ASSET_ENABLED) return null
  const existing = inflight.get(urlPath)
  if (existing) return existing
  const task = (async () => {
    try {
      return await httpsGet(`${REMOTE_RAW_BASE}${urlPath}`)
    } finally {
      inflight.delete(urlPath)
    }
  })()
  inflight.set(urlPath, task)
  return task
}

// 开发与预览时：
// 1. 直接挂载仓库根目录下的 data/、thumbs/、img/，避免拷贝 6.8 GB 素材
// 2. 提供 /api/proxy 同源转发接口，解决 DashScope (Qwen) / 火山方舟 (Doubao) 官方接口的浏览器 CORS 限制
function localAssetsAndProxyPlugin(): Plugin {
  const rootDir = import.meta.dirname
  const prefixes = ['/data/', '/thumbs/', '/img/', '/og-cover.jpg', '/robots.txt', '/sitemap.xml']

  const handleProxy = async (req: any, res: any) => {
    try {
      const targetUrl = req.headers['x-target-url'] as string | undefined
      if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: { message: 'Missing or invalid x-target-url header' } }))
        return
      }

      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const rawBody = Buffer.concat(chunks)

      const forwardHeaders: Record<string, string> = {}
      const contentType = req.headers['content-type']
      if (contentType) forwardHeaders['Content-Type'] = contentType
      const auth = req.headers['authorization']
      if (auth) forwardHeaders['Authorization'] = auth
      const googKey = req.headers['x-goog-api-key']
      if (googKey) forwardHeaders['x-goog-api-key'] = googKey as string
      const dashAsync = req.headers['x-dashscope-async']
      if (dashAsync) forwardHeaders['X-DashScope-Async'] = dashAsync as string

      const upstream = await fetch(targetUrl, {
        method: req.method || 'POST',
        headers: forwardHeaders,
        body: rawBody.length > 0 ? rawBody : undefined,
      })

      res.statusCode = upstream.status
      const upType = upstream.headers.get('content-type') || 'application/json; charset=utf-8'
      res.setHeader('Content-Type', upType)
      const ab = await upstream.arrayBuffer()
      res.end(Buffer.from(ab))
    } catch (err: any) {
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: { message: err?.message || 'Proxy request failed' } }))
    }
  }

  const serve = async (req: any, res: any, next: any) => {
    const rawUrl = (req.url || '').split('?')[0]
    if (rawUrl === '/api/proxy') {
      void handleProxy(req, res)
      return
    }
    const decoded = decodeURIComponent(rawUrl)
    if (!prefixes.some((p) => decoded === p || decoded.startsWith(p))) {
      return next()
    }
    const filePath = path.join(rootDir, decoded)
    if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // 本地缺失：优先从远程仓库回源（写回本地缓存），失败再返回明确错误。
      const ext = path.extname(decoded).toLowerCase()
      const remote = await fetchRemoteAsset(decoded)
      if (remote) {
        if (filePath.startsWith(rootDir)) {
          try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true })
            fs.writeFileSync(filePath, remote)
          } catch {
            // 缓存写入失败不影响本次响应
          }
        }
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
        res.setHeader('Cache-Control', 'public, max-age=3600')
        res.end(remote)
        return
      }
      // 回源失败：不要落到 SPA 回退（会返回 index.html，导致 res.json() 报
      // "Unexpected token '<'"）。按资源类型给出明确的错误响应。
      if (ext === '.json') {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(
          JSON.stringify({
            error: `本地与远程均缺少数据文件 ${decoded}`,
            hint: '请先同步仓库中的 data/ 目录后重试',
          })
        )
        return
      }
      // 图片等二进制素材：返回 404，避免把 HTML 当作图片渲染
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`Missing asset: ${decoded}`)
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    fs.createReadStream(filePath).pipe(res)
  }

  return {
    name: 'local-assets-and-proxy-plugin',
    configureServer(server) {
      server.middlewares.use(serve)
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve)
    },
  }
}

// 本地 ComfyUI 同源代理：浏览器请求 /comfy/* → ComfyUI（默认 Desktop 端口 8000）
// 这样无需修改 ComfyUI 的 --enable-cors-header 白名单。可用环境变量 COMFYUI_URL 指定其他地址。
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8000'
const comfyProxy = {
  '/comfy': {
    target: COMFYUI_URL,
    changeOrigin: true,
    ws: true,
    rewrite: (p: string) => p.replace(/^\/comfy/, '') || '/',
    configure: (proxy: any) => {
      // ComfyUI 对带 Origin 的跨源请求做校验，代理转发时去掉浏览器 Origin，按同源请求处理
      proxy.on('proxyReq', (proxyReq: any) => proxyReq.removeHeader('origin'))
      proxy.on('proxyReqWs', (proxyReq: any) => proxyReq.removeHeader('origin'))
    },
  },
}

export default defineConfig({
  publicDir: false,
  plugins: [
    localAssetsAndProxyPlugin(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'tanstack-vendor', test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: 'ui-vendor', test: /node_modules[\\/](radix-ui|@radix-ui|lucide-react|sonner)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: comfyProxy,
  },
  preview: {
    proxy: comfyProxy,
  },
})
