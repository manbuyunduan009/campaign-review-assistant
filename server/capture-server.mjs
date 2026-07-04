import cors from 'cors'
import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'

const app = express()
const port = Number(process.env.CAPTURE_PORT || 4317)

app.use(cors({ origin: true }))
app.use(express.json({ limit: '20mb' }))

function ensureReviewUrl(value) {
  let parsed

  try {
    parsed = new URL(value)
  } catch {
    throw new Error('请输入有效的 http 或 https 页面 URL')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('仅支持 http 或 https 页面 URL')
  }

  return parsed.toString()
}

async function launchBrowser() {
  const attempts = [
    () => chromium.launch({ channel: 'chrome', headless: true }),
    () => chromium.launch({ channel: 'msedge', headless: true }),
    () =>
      chromium.launch({
        executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        headless: true,
      }),
    () =>
      chromium.launch({
        executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        headless: true,
      }),
  ]

  let lastError

  for (const attempt of attempts) {
    try {
      return await attempt()
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(`无法启动本机 Chrome 或 Edge：${lastError?.message || '未知错误'}`)
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

const supportedExtensions = new Set([
  '.md',
  '.txt',
  '.html',
  '.htm',
  '.pdf',
  '.docx',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
])

const readableTextExtensions = new Set(['.md', '.txt', '.html', '.htm'])
const previewImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const imageMimeTypes = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

app.post('/api/search-folder', async (request, response) => {
  try {
    const folderPath = String(request.body?.folderPath || '').trim()
    const query = String(request.body?.query || '').trim()

    if (!folderPath) {
      throw new Error('请输入资料文件夹路径')
    }

    const root = path.resolve(folderPath)
    const stats = await fs.stat(root)

    if (!stats.isDirectory()) {
      throw new Error('路径不是文件夹')
    }

    const files = await collectFiles(root, 4, 240)
    const queryTokens = tokenize(query)
    const results = []

    for (const file of files) {
      const ext = path.extname(file).toLowerCase()
      const name = path.basename(file)
      const relativePath = path.relative(root, file)
      let snippet = ''
      let textScore = 0

      if (readableTextExtensions.has(ext)) {
        const content = await readSmallTextFile(file)
        snippet = makeSnippet(content, queryTokens)
        textScore = scoreText(content, queryTokens)
      }

      const nameScore = scoreText(`${name} ${relativePath}`, queryTokens)
      const score = queryTokens.length ? nameScore * 2 + textScore : 1

      if (!queryTokens.length || score > 0) {
        results.push({
          path: file,
          relativePath,
          name,
          ext,
          type: classifyAsset(ext),
          score,
          snippet,
        })
      }
    }

    results.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))

    response.json({
      ok: true,
      root,
      total: files.length,
      results: results.slice(0, 80),
    })
  } catch (error) {
    response.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : '资料搜索失败',
    })
  }
})

app.post('/api/asset-preview', async (request, response) => {
  try {
    const filePath = String(request.body?.path || '').trim()

    if (!filePath) {
      throw new Error('请输入要预览的资料路径')
    }

    const resolvedPath = path.resolve(filePath)
    const stats = await fs.stat(resolvedPath)

    if (!stats.isFile()) {
      throw new Error('资料路径不是文件')
    }

    const ext = path.extname(resolvedPath).toLowerCase()
    const name = path.basename(resolvedPath)

    if (!supportedExtensions.has(ext)) {
      throw new Error('暂不支持预览该文件类型')
    }

    if (readableTextExtensions.has(ext)) {
      const content = await readSmallTextFile(resolvedPath)

      response.json({
        ok: true,
        path: resolvedPath,
        name,
        ext,
        type: classifyAsset(ext),
        content: content.slice(0, 20000),
      })
      return
    }

    if (previewImageExtensions.has(ext)) {
      if (stats.size > 8 * 1024 * 1024) {
        throw new Error('图片超过 8MB，请先压缩后再预览')
      }

      const buffer = await fs.readFile(resolvedPath)
      const mimeType = imageMimeTypes.get(ext) || 'application/octet-stream'

      response.json({
        ok: true,
        path: resolvedPath,
        name,
        ext,
        type: classifyAsset(ext),
        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
      })
      return
    }

    response.json({
      ok: true,
      path: resolvedPath,
      name,
      ext,
      type: classifyAsset(ext),
      message: '该文档类型已被搜索命中，但当前版本暂不直接解析预览内容',
    })
  } catch (error) {
    response.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : '资料预览失败',
    })
  }
})

app.post('/api/capture', async (request, response) => {
  const startedAt = Date.now()
  let browser

  try {
    const targetUrl = ensureReviewUrl(request.body?.url)
    const viewport = request.body?.viewport || {}
    const width = Number(viewport.width || 390)
    const height = Number(viewport.height || 844)
    const waitMs = Math.min(Math.max(Number(request.body?.waitMs || 5000), 0), 20000)

    browser = await launchBrowser()

    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    })
    const page = await context.newPage()

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(waitMs)

    const screenshot = await page.screenshot({
      fullPage: true,
      type: 'png',
    })
    const meta = await collectPageMeta(page)

    await context.close()

    response.json({
      ok: true,
      image: screenshot.toString('base64'),
      meta: {
        ...meta,
        capturedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
      },
    })
  } catch (error) {
    response.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : '截图失败',
    })
  } finally {
    if (browser) {
      await browser.close()
    }
  }
})

app.post('/api/ocr', async (request, response) => {
  const startedAt = Date.now()
  let worker

  try {
    const images = Array.isArray(request.body?.images) ? request.body.images.slice(0, 2) : []
    const language = String(request.body?.language || 'chi_sim+eng')

    if (!images.length) {
      throw new Error('请先上传设计稿或采集页面截图')
    }

    worker = await createWorker(language)

    const results = []

    for (const image of images) {
      const id = String(image?.id || `image-${results.length + 1}`)
      const label = String(image?.label || id)
      const buffer = await preprocessOcrImage(decodeImageData(image?.image))
      const result = await worker.recognize(buffer)

      results.push({
        id,
        label,
        text: String(result.data?.text || '').trim(),
        confidence: Number(result.data?.confidence || 0),
      })
    }

    response.json({
      ok: true,
      results,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    response.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : 'OCR 识别失败',
    })
  } finally {
    if (worker) {
      await worker.terminate()
    }
  }
})

app.post('/api/check-actions', async (request, response) => {
  const startedAt = Date.now()
  let browser

  try {
    const targetUrl = ensureReviewUrl(request.body?.url)
    const expectations = Array.from(
      new Set(
        (Array.isArray(request.body?.expectations) ? request.body.expectations : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    ).slice(0, 10)
    const waitMs = Math.min(Math.max(Number(request.body?.waitMs || 3000), 0), 12000)

    if (!expectations.length) {
      throw new Error('请先粘贴需求或 UE 功能描述')
    }

    browser = await launchBrowser()

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    })
    const results = []

    for (const term of expectations) {
      const page = await context.newPage()
      const dialogs = []

      page.on('dialog', async (dialog) => {
        dialogs.push({ type: dialog.type(), message: dialog.message() })
        await dialog.dismiss()
      })

      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.waitForTimeout(waitMs)

        const beforeUrl = page.url()
        const beforeText = await page.evaluate(() => document.body.innerText.slice(0, 6000))
        const meta = await collectPageMeta(page)
        const beforeImage = await captureActionImage(page)
        const candidate = meta.interactiveElements.find((element) =>
          matchesTerm(`${element.text} ${element.href} ${element.selector}`, term),
        )

        if (!candidate) {
          results.push({
            term,
            status: 'warning',
            title: `未找到功能入口：${term}`,
            evidence: '页面可点击元素中没有匹配入口',
            failureReason: '页面可点击元素没有包含该功能词或常见别名',
            beforeUrl,
            afterUrl: beforeUrl,
            beforeImage,
            afterImage: beforeImage,
            changed: false,
            urlChanged: false,
            textChanged: false,
            popupOpened: false,
            dialogs,
            matchedElement: null,
          })
          await page.close()
          continue
        }

        const popupPromise = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)
        const clicked = await clickMatchedElement(page, term)

        if (!clicked) {
          results.push({
            term,
            status: 'warning',
            title: `${term}点测失败`,
            evidence: `${candidate.text || candidate.href || candidate.selector}；找到候选入口，但点击脚本未命中实际 DOM`,
            failureReason: '找到候选入口，但点击脚本未命中实际 DOM',
            beforeUrl,
            afterUrl: beforeUrl,
            beforeImage,
            afterImage: beforeImage,
            changed: false,
            urlChanged: false,
            textChanged: false,
            popupOpened: false,
            dialogs,
            matchedElement: candidate,
          })
          await page.close()
          continue
        }

        const popup = await popupPromise

        if (popup) {
          await popup.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined)
        }

        await page.waitForTimeout(1200)

        const afterUrl = popup ? popup.url() : page.url()
        const afterText = await page.evaluate(() => document.body.innerText.slice(0, 6000)).catch(() => '')
        const afterImage = await captureActionImage(popup || page)
        const urlChanged = beforeUrl !== afterUrl
        const textChanged = normalizeForMatch(beforeText) !== normalizeForMatch(afterText)
        const changed =
          urlChanged ||
          dialogs.length > 0 ||
          Boolean(popup) ||
          textChanged
        const failureReason = changed
          ? ''
          : candidate.href
            ? '入口有 href，但点击后未检测到 URL、弹窗或页面文本变化，需人工复核'
            : '点击后未检测到 URL、弹窗或页面文本变化'

        results.push({
          term,
          status: changed ? 'passed' : 'manual',
          title: `${term}入口点测`,
          evidence: [
            candidate.text || candidate.href || candidate.selector,
            candidate.href ? `href: ${candidate.href}` : '无显式 href',
            changed ? `点测后有变化：${afterUrl}` : failureReason,
            dialogs.length ? `弹窗：${dialogs.map((dialog) => dialog.message).join(' / ')}` : '',
          ]
            .filter(Boolean)
            .join('；'),
          failureReason,
          beforeUrl,
          afterUrl,
          beforeImage,
          afterImage,
          changed,
          urlChanged,
          textChanged,
          popupOpened: Boolean(popup),
          dialogs,
          matchedElement: candidate,
        })

        if (popup) {
          await popup.close().catch(() => undefined)
        }
      } catch (error) {
        results.push({
          term,
          status: 'warning',
          title: `${term}点测失败`,
          evidence: error instanceof Error ? error.message : '未知错误',
          failureReason: error instanceof Error ? error.message : '未知错误',
          beforeUrl: page.url(),
          afterUrl: page.url(),
          beforeImage: await captureActionImage(page).catch(() => ''),
          afterImage: '',
          changed: false,
          urlChanged: false,
          textChanged: false,
          popupOpened: false,
          dialogs,
          matchedElement: null,
        })
      } finally {
        await page.close().catch(() => undefined)
      }
    }

    await context.close()

    response.json({
      ok: true,
      results,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    response.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : '功能点测失败',
    })
  } finally {
    if (browser) {
      await browser.close()
    }
  }
})

app.listen(port, '127.0.0.1', () => {
  console.log(`capture api listening on http://127.0.0.1:${port}`)
})

async function collectPageMeta(page) {
  return page.evaluate(() => {
    function cleanText(value) {
      return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180)
    }

    function elementBox(element) {
      const rect = element.getBoundingClientRect()

      return {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }

    function isVisible(element) {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)

      return (
        rect.width > 1 &&
        rect.height > 1 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0.05
      )
    }

    function cssPath(element) {
      const id = element.id ? `#${element.id}` : ''
      const className =
        typeof element.className === 'string'
          ? element.className
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((item) => `.${item}`)
              .join('')
          : ''

      return `${element.tagName.toLowerCase()}${id}${className}`
    }

    function getElementText(element) {
      return cleanText(
        element.innerText ||
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.getAttribute('value') ||
          element.getAttribute('alt'),
      )
    }

    function getHref(element) {
      return cleanText(
        element.href ||
          element.getAttribute('href') ||
          element.getAttribute('data-url') ||
          element.getAttribute('data-href') ||
          '',
      )
    }

    function backgroundUrls(backgroundImage) {
      if (!backgroundImage || backgroundImage === 'none') return []

      return Array.from(backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g))
        .map((match) => match[1])
        .filter(Boolean)
        .slice(0, 4)
    }

    const interactiveElements = Array.from(
      document.querySelectorAll(
        'a, button, input[type="button"], input[type="submit"], [role="button"], [onclick], [data-url], [data-href]',
      ),
    )
      .filter(isVisible)
      .slice(0, 140)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: cleanText(element.getAttribute('role')),
        text: getElementText(element),
        href: getHref(element),
        hasClickHandler: Boolean(element.getAttribute('onclick')),
        selector: cssPath(element),
        box: elementBox(element),
      }))

    const images = Array.from(document.querySelectorAll('img'))
      .filter(isVisible)
      .slice(0, 140)
      .map((element) => ({
        src: cleanText(element.currentSrc || element.src),
        alt: cleanText(element.alt || element.getAttribute('aria-label')),
        selector: cssPath(element),
        box: elementBox(element),
      }))

    const backgroundImages = Array.from(document.querySelectorAll('body, body *'))
      .filter(isVisible)
      .flatMap((element) => {
        const urls = backgroundUrls(window.getComputedStyle(element).backgroundImage)

        if (!urls.length) return []

        return [
          {
            urls: urls.map((url) => cleanText(url)),
            text: getElementText(element),
            selector: cssPath(element),
            box: elementBox(element),
          },
        ]
      })
      .slice(0, 140)

    return {
      title: document.title,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      textSample: document.body.innerText.slice(0, 20000),
      interactiveElements,
      images,
      backgroundImages,
    }
  })
}

async function captureActionImage(page) {
  const screenshot = await page.screenshot({
    fullPage: false,
    type: 'jpeg',
    quality: 54,
  })

  return `data:image/jpeg;base64,${screenshot.toString('base64')}`
}

async function clickMatchedElement(page, term) {
  return page.evaluate((expectedTerm) => {
    function cleanText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim()
    }

    function normalize(value) {
      return cleanText(value)
        .replace(/[：:]\s*/g, '')
        .replace(/\s+/g, '')
        .replace(/[，。、“”‘’！!？?；;,.()[\]【】<>《》\-—_]/g, '')
        .toLowerCase()
    }

    function aliases(value) {
      const map = {
        下载游戏: ['download', 'client', 'game'],
        立即下载: ['download', 'client', 'game'],
        预约: ['reserve', 'reservation', 'booking', 'appointment', 'service-navigation'],
        立即预约: ['reserve', 'reservation', 'booking', 'appointment', 'service-navigation'],
        购票: ['ticket', 'buy', 'order'],
        查看详情: ['detail', 'info', 'more'],
        查看更多: ['more', 'list'],
        导航: ['navigation', 'nav', 'service-navigation'],
        服务导航: ['navigation', 'nav', 'service-navigation'],
        登录: ['login', 'signin'],
        分享: ['share'],
        关闭: ['close'],
        返回: ['back'],
        领取: ['receive', 'reward', 'gift'],
        兑换: ['exchange'],
        抽奖: ['lottery', 'draw'],
      }

      return map[value] || []
    }

    function includesLoose(value, termValue) {
      const source = normalize(value)
      const target = normalize(termValue)

      if (!source || !target) return false
      if (source.includes(target)) return true

      let position = -1

      return Array.from(target).every((character) => {
        position = source.indexOf(character, position + 1)
        return position >= 0
      })
    }

    function matches(value, termValue) {
      return [termValue, ...aliases(termValue)].some((candidate) => includesLoose(value, candidate))
    }

    function isVisible(element) {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)

      return (
        rect.width > 1 &&
        rect.height > 1 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0.05
      )
    }

    const elements = Array.from(
      document.querySelectorAll(
        'a, button, input[type="button"], input[type="submit"], [role="button"], [onclick], [data-url], [data-href]',
      ),
    ).filter(isVisible)
    const target = elements.find((element) =>
      matches(
        [
          element.innerText,
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
          element.getAttribute('href'),
          element.getAttribute('data-url'),
          element.getAttribute('data-href'),
          element.className,
        ].join(' '),
        expectedTerm,
      ),
    )

    if (!target) return false

    target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' })
    target.click()

    return true
  }, term)
}

function decodeImageData(value) {
  const source = String(value || '')
  const match = source.match(/^data:image\/(?:png|jpeg|jpg|webp);base64,(.+)$/)
  const base64 = match?.[1] || source

  if (!base64) {
    throw new Error('图片数据为空')
  }

  return Buffer.from(base64, 'base64')
}

async function preprocessOcrImage(buffer) {
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width || 0
  const scale = width && width < 1600 ? Math.min(4, Math.max(2, Math.ceil(1600 / width))) : 1

  return sharp(buffer)
    .resize({
      width: width ? Math.round(width * scale) : undefined,
      withoutEnlargement: false,
    })
    .grayscale()
    .normalise()
    .sharpen()
    .threshold(170)
    .png()
    .toBuffer()
}

function matchesTerm(value, term) {
  return [term, ...termAliases(term)].some((candidate) => includesLoose(value, candidate))
}

function termAliases(term) {
  const aliases = {
    下载游戏: ['download', 'client', 'game'],
    立即下载: ['download', 'client', 'game'],
    预约: ['reserve', 'reservation', 'booking', 'appointment', 'service-navigation'],
    立即预约: ['reserve', 'reservation', 'booking', 'appointment', 'service-navigation'],
    购票: ['ticket', 'buy', 'order'],
    查看详情: ['detail', 'info', 'more'],
    查看更多: ['more', 'list'],
    导航: ['navigation', 'nav', 'service-navigation'],
    服务导航: ['navigation', 'nav', 'service-navigation'],
    登录: ['login', 'signin'],
    分享: ['share'],
    关闭: ['close'],
    返回: ['back'],
    领取: ['receive', 'reward', 'gift'],
    兑换: ['exchange'],
    抽奖: ['lottery', 'draw'],
  }

  return aliases[term] || []
}

function includesLoose(value, term) {
  const source = normalizeForMatch(value)
  const target = normalizeForMatch(term)

  if (!source || !target) return false
  if (source.includes(target)) return true

  let position = -1

  return Array.from(target).every((character) => {
    position = source.indexOf(character, position + 1)
    return position >= 0
  })
}

function normalizeForMatch(value) {
  return String(value || '')
    .replace(/[：:]\s*/g, '')
    .replace(/\s+/g, '')
    .replace(/[，。、“”‘’！!？?；;,.()[\]【】<>《》\-—_]/g, '')
    .toLowerCase()
}

async function collectFiles(root, maxDepth, limit) {
  const results = []

  async function walk(current, depth) {
    if (depth > maxDepth || results.length >= limit) return

    const entries = await fs.readdir(current, { withFileTypes: true })

    for (const entry of entries) {
      if (results.length >= limit) return
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue

      const entryPath = path.join(current, entry.name)

      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1)
      } else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
        results.push(entryPath)
      }
    }
  }

  await walk(root, 0)

  return results
}

async function readSmallTextFile(file) {
  const stats = await fs.stat(file)

  if (stats.size > 1_000_000) return ''

  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return ''
  }
}

function tokenize(value) {
  return Array.from(
    new Set(
      value
        .split(/[\s,，。;；:：|/\\]+/)
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 2),
    ),
  )
}

function scoreText(value, tokens) {
  if (!tokens.length) return 1

  const lower = value.toLowerCase()

  return tokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0)
}

function makeSnippet(content, tokens) {
  if (!content) return ''

  const compact = content.replace(/\s+/g, ' ').trim()
  const lower = compact.toLowerCase()
  const index = tokens.map((token) => lower.indexOf(token)).find((position) => position >= 0) ?? 0
  const start = Math.max(0, index - 50)

  return compact.slice(start, start + 180)
}

function classifyAsset(ext) {
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return 'image'
  if (['.md', '.txt', '.html', '.htm'].includes(ext)) return 'text'
  if (['.pdf', '.docx', '.xlsx'].includes(ext)) return 'document'

  return 'file'
}
