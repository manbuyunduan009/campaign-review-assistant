import type { ChangeEvent, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Bot,
  Camera,
  ClipboardList,
  Copy,
  Download,
  Eye,
  FileImage,
  FileText,
  FolderOpen,
  Link2,
  Loader2,
  Plus,
  MonitorSmartphone,
  MousePointerClick,
  Paperclip,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  ScanText,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import type { PageType, ReviewIssue } from './types'

const captureEndpoint = 'http://127.0.0.1:4317/api/capture'
const searchFolderEndpoint = 'http://127.0.0.1:4317/api/search-folder'
const assetPreviewEndpoint = 'http://127.0.0.1:4317/api/asset-preview'
const ocrEndpoint = 'http://127.0.0.1:4317/api/ocr'
const actionCheckEndpoint = 'http://127.0.0.1:4317/api/check-actions'
const reviewStateStorageKey = 'campaign-review-assistant:review-state:v1'
const reviewProjectsStorageKey = 'campaign-review-assistant:projects:v1'
const pageTypes: PageType[] = ['网页移动端', '小程序', '游戏内嵌页', '网吧内嵌页']
const knownBusinessTerms = [
  '下载游戏',
  '立即下载',
  '预约',
  '立即预约',
  '购票',
  '查看详情',
  '查看更多',
  '领取',
  '兑换',
  '绑定',
  '登录',
  '分享',
  '返回',
  '关闭',
  '抽奖',
  '报名',
  '导航',
  '公告',
  '活动资讯',
  '演唱会',
  '游园会',
  '服务导航',
  '背景',
  '主视觉',
]
const functionIntentPattern = /点击|按钮|入口|跳转|打开|弹窗|关闭|链接|功能|交互|领取|预约|购票|下载|登录|绑定|分享|抽奖|提交/
const copyIntentPattern = /文案|CMS|业务方|标题|公告|说明|按钮文案|活动资讯/

interface DomBox {
  x: number
  y: number
  width: number
  height: number
}

interface PageElement {
  tag: string
  role: string
  text: string
  href: string
  hasClickHandler: boolean
  selector: string
  box: DomBox
}

interface PageImage {
  src: string
  alt: string
  selector: string
  box: DomBox
}

interface PageBackground {
  urls: string[]
  text: string
  selector: string
  box: DomBox
}

interface CaptureMeta {
  title: string
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  textSample: string
  interactiveElements: PageElement[]
  images: PageImage[]
  backgroundImages: PageBackground[]
  capturedAt: string
  durationMs: number
}

interface CaptureResponse {
  ok: boolean
  image?: string
  meta?: CaptureMeta
  message?: string
}

interface DiffStats {
  width: number
  height: number
  diffPixels: number
  totalPixels: number
  ratio: number
  threshold: number
}

interface CopyCheckItem {
  source: string
  normalized: string
  status: 'matched' | 'missing'
}

interface CopyCheckResult {
  checkedAt: string
  pageTextLength: number
  total: number
  matched: CopyCheckItem[]
  missing: CopyCheckItem[]
  ignored: string[]
}

interface FolderAsset {
  path: string
  relativePath: string
  name: string
  ext: string
  type: 'image' | 'text' | 'document' | 'file'
  score: number
  snippet: string
}

interface FolderSearchResponse {
  ok: boolean
  root?: string
  total?: number
  results?: FolderAsset[]
  message?: string
}

interface FolderAssetPreview {
  ok: boolean
  path?: string
  name?: string
  ext?: string
  type?: FolderAsset['type']
  content?: string
  dataUrl?: string
  message?: string
}

interface OcrItem {
  id: string
  label: string
  text: string
  confidence: number
  originalText?: string
  corrected?: boolean
  correctedAt?: string
}

interface OcrResponse {
  ok: boolean
  results?: OcrItem[]
  durationMs?: number
  message?: string
}

interface ActionCheckItem {
  term: string
  status: 'passed' | 'warning' | 'manual'
  title: string
  evidence: string
  failureReason?: string
  beforeUrl?: string
  afterUrl?: string
  beforeImage?: string
  afterImage?: string
  changed?: boolean
  urlChanged?: boolean
  textChanged?: boolean
  popupOpened?: boolean
  dialogs?: Array<{ type: string; message: string }>
  matchedElement?: PageElement | null
}

interface ActionCheckResponse {
  ok: boolean
  results?: ActionCheckItem[]
  durationMs?: number
  message?: string
}

interface ChatMessage {
  id: number
  role: 'assistant' | 'user'
  text: string
}

type SemanticCategory = 'display' | 'content' | 'function'
type SemanticStatus = 'passed' | 'warning' | 'manual'
type ReviewDecisionStatus = 'auto' | 'passed' | 'needs-change' | 'pending' | 'ignored'

interface SemanticReviewItem {
  id: string
  category: SemanticCategory
  title: string
  source: string
  status: SemanticStatus
  evidence: string
}

interface SemanticReviewSummary {
  total: number
  passed: number
  warning: number
  manual: number
}

interface SemanticReviewResult {
  display: SemanticReviewItem[]
  content: SemanticReviewItem[]
  function: SemanticReviewItem[]
  summary: Record<SemanticCategory, SemanticReviewSummary>
}

interface BuildSemanticReviewInput {
  meta: CaptureMeta | null
  sourceText: string
  ocrText: string
  ocrResults: OcrItem[]
  actionResults: ActionCheckItem[]
  copyResult: CopyCheckResult | null
  diffStats: DiffStats | null
  hasDesign: boolean
  hasActual: boolean
  folderAssets: FolderAsset[]
}

interface ReviewDecision {
  status: ReviewDecisionStatus
  note: string
  updatedAt: string
}

type ReviewDecisionMap = Record<string, ReviewDecision>

interface PersistedReviewState {
  decisions: ReviewDecisionMap
  finalConclusion: string
  projectName?: string
  activeTemplateId?: string
  smartSummary?: string
  pageType?: PageType
  url?: string
  cmsText?: string
  captureMeta?: CaptureMeta | null
  diffStats?: DiffStats | null
  copyResult?: CopyCheckResult | null
  ocrResults?: OcrItem[]
  actionResults?: ActionCheckItem[]
  folderPath?: string
  folderQuery?: string
  folderAssets?: FolderAsset[]
}

interface ReviewProject {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  summary: string
  state: PersistedReviewState
}

interface ReviewTemplate {
  id: string
  title: string
  pageType: PageType
  description: string
  folderQuery: string
  checks: string[]
}

interface MarkdownReportInput {
  pageType: PageType
  url: string
  captureMeta: CaptureMeta | null
  hasDesign: boolean
  diffStats: DiffStats | null
  copyResult: CopyCheckResult | null
  ocrResults: OcrItem[]
  actionResults: ActionCheckItem[]
  folderAssets: FolderAsset[]
  semanticResult: SemanticReviewResult
  reviewDecisions: ReviewDecisionMap
  finalConclusion: string
  smartSummary: string
}

const baseIssues: ReviewIssue[] = [
  {
    id: 1,
    type: '模块',
    title: '页面状态需确认',
    location: '首屏 / 路由',
    severity: '高',
    status: '待确认',
  },
  {
    id: 2,
    type: '文案',
    title: '图片化文案需 OCR',
    location: '页面截图',
    severity: '中',
    status: '未确认',
  },
  {
    id: 3,
    type: '交互',
    title: '功能点击需对照需求/UE',
    location: '需求文档 / UE 描述',
    severity: '中',
    status: '未确认',
  },
]

const reviewTemplates: ReviewTemplate[] = [
  {
    id: 'mobile-campaign',
    title: '网页移动端专题',
    pageType: '网页移动端',
    description: '适合 H5、移动端活动页、预约页和专题页。',
    folderQuery: '移动端 专题 H5 预约 活动 需求 UE 设计稿',
    checks: [
      '首屏主视觉、活动标题、核心 CTA 是否完整展示',
      '右上角下载游戏、分享、返回等固定入口是否符合需求',
      '预约、购票、领取、查看详情等按钮文案是否与 CMS 一致',
      '核心按钮点击后是否跳转、弹窗或状态变化',
      '活动资讯、公告、规则说明是否与业务方文案一致',
      '页面底部兜底入口和适配安全区需人工确认',
    ],
  },
  {
    id: 'mini-program',
    title: '小程序页面',
    pageType: '小程序',
    description: '适合小程序活动页、任务页和承接页。',
    folderQuery: '小程序 活动页 任务 路由 授权 UE 需求',
    checks: [
      '顶部导航、返回、分享能力是否符合小程序规范',
      '登录、授权、订阅消息等状态是否有明确反馈',
      '主要按钮文案、任务状态、领取状态是否与 CMS 一致',
      '跳转路径、弹窗、二次确认流程是否符合 UE 描述',
      '缺省态、已领取、不可领取、活动结束态需人工确认',
    ],
  },
  {
    id: 'game-webview',
    title: '游戏内嵌页',
    pageType: '游戏内嵌页',
    description: '适合游戏 WebView、福利页、任务页和兑换页。',
    folderQuery: '游戏内嵌 WebView 任务 领取 兑换 登录态 UE',
    checks: [
      '页面是否避免依赖浏览器外链能力，返回/关闭入口是否明确',
      '登录态、角色区服、绑定状态是否展示正确',
      '领取、兑换、抽奖、报名等按钮状态是否符合需求',
      '成功、失败、重复领取、资格不足等反馈需人工确认',
      '游戏内跳转、协议唤起、弹窗遮罩是否可点测',
    ],
  },
  {
    id: 'cafe-webview',
    title: '网吧内嵌页',
    pageType: '网吧内嵌页',
    description: '适合网吧客户端、门店权益、扫码和活动承接页。',
    folderQuery: '网吧 内嵌 客户端 权益 扫码 活动 UE',
    checks: [
      '网吧身份、门店、设备环境相关信息是否展示清楚',
      '扫码、领取、登录、下载等入口是否符合客户端限制',
      '权益文案、活动时间、门店说明是否与 CMS 一致',
      '外链跳转、协议唤起、关闭返回流程需人工确认',
      '异常态、无资格、网络失败和活动结束态需人工确认',
    ],
  },
]

function App() {
  const persistedState = useMemo(loadPersistedReviewState, [])
  const persistedProjects = useMemo(loadReviewProjects, [])
  const [projectName, setProjectName] = useState(
    persistedState.projectName || makeDefaultProjectName(persistedState.url || ''),
  )
  const [activeProjectId, setActiveProjectId] = useState('')
  const [activeTemplateId, setActiveTemplateId] = useState(persistedState.activeTemplateId || '')
  const [pageType, setPageType] = useState<PageType>(persistedState.pageType || '网页移动端')
  const [url, setUrl] = useState(
    persistedState.url || 'https://test-zt.xoyo.com/jx3.xoyo.com/p/m/2026/07/20/anniversary/#/',
  )
  const [designPreview, setDesignPreview] = useState('')
  const [actualPreview, setActualPreview] = useState('')
  const [diffPreview, setDiffPreview] = useState('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [isDiffing, setIsDiffing] = useState(false)
  const [isSearchingFolder, setIsSearchingFolder] = useState(false)
  const [isRunningOcr, setIsRunningOcr] = useState(false)
  const [isTestingActions, setIsTestingActions] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const [diffError, setDiffError] = useState('')
  const [copyError, setCopyError] = useState('')
  const [folderError, setFolderError] = useState('')
  const [ocrError, setOcrError] = useState('')
  const [actionError, setActionError] = useState('')
  const [isPreviewingAsset, setIsPreviewingAsset] = useState(false)
  const [captureMeta, setCaptureMeta] = useState<CaptureMeta | null>(persistedState.captureMeta || null)
  const [diffStats, setDiffStats] = useState<DiffStats | null>(persistedState.diffStats || null)
  const [cmsText, setCmsText] = useState(persistedState.cmsText || '')
  const [copyResult, setCopyResult] = useState<CopyCheckResult | null>(persistedState.copyResult || null)
  const [ocrResults, setOcrResults] = useState<OcrItem[]>(persistedState.ocrResults || [])
  const [actionResults, setActionResults] = useState<ActionCheckItem[]>(persistedState.actionResults || [])
  const [folderPath, setFolderPath] = useState(persistedState.folderPath || 'D:\\vscode\\动效\\docs')
  const [folderQuery, setFolderQuery] = useState(persistedState.folderQuery || '周年庆 预约 演唱会')
  const [folderAssets, setFolderAssets] = useState<FolderAsset[]>(persistedState.folderAssets || [])
  const [assetPreview, setAssetPreview] = useState<FolderAssetPreview | null>(null)
  const [projects, setProjects] = useState<ReviewProject[]>(persistedProjects)
  const [chatInput, setChatInput] = useState('')
  const [reviewDecisions, setReviewDecisions] = useState<ReviewDecisionMap>(persistedState.decisions)
  const [finalConclusion, setFinalConclusion] = useState(persistedState.finalConclusion)
  const [smartSummary, setSmartSummary] = useState(persistedState.smartSummary || '')
  const [reportNotice, setReportNotice] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      text: '把页面 URL、资料文件夹地址、CMS 文案、需求或 UE 描述丢给我。我会按展示、内容、功能三部分整理验收线索。',
    },
  ])

  useEffect(() => {
    persistReviewState({
      decisions: reviewDecisions,
      finalConclusion,
      projectName,
      activeTemplateId,
      smartSummary,
      pageType,
      url,
      cmsText,
      captureMeta,
      diffStats,
      copyResult,
      ocrResults,
      actionResults,
      folderPath,
      folderQuery,
      folderAssets,
    })
  }, [
    actionResults,
    activeTemplateId,
    captureMeta,
    cmsText,
    copyResult,
    diffStats,
    finalConclusion,
    folderAssets,
    folderPath,
    folderQuery,
    ocrResults,
    pageType,
    projectName,
    reviewDecisions,
    smartSummary,
    url,
  ])

  const semanticResult = useMemo(
    () =>
      buildSemanticReview({
        meta: captureMeta,
        sourceText: cmsText,
        ocrText: collectOcrText(ocrResults),
        ocrResults,
        actionResults,
        copyResult,
        diffStats,
        hasDesign: Boolean(designPreview),
        hasActual: Boolean(actualPreview),
        folderAssets,
      }),
    [actionResults, captureMeta, cmsText, copyResult, designPreview, diffStats, actualPreview, folderAssets, ocrResults],
  )

  const issues = useMemo(() => {
    const generatedIssues: ReviewIssue[] = []
    const semanticIssueItems = [
      ...semanticResult.display,
      ...semanticResult.content,
      ...semanticResult.function,
    ].filter((item) => shouldShowAsIssue(item, reviewDecisions[item.id]))

    if (diffStats) {
      generatedIssues.push({
        id: 4,
        type: '视觉',
        title: '视觉参考图已生成',
        location: '设计稿 vs 页面截图',
        severity: diffStats.ratio > 0.2 ? '中' : '低',
        status: '待确认',
      })
    }

    if (folderAssets.length) {
      generatedIssues.push({
        id: 6,
        type: '交互',
        title: `已找到 ${folderAssets.length} 个相关资料`,
        location: '本地资料库',
        severity: '低',
        status: '待确认',
      })
    }

    semanticIssueItems.slice(0, 8).forEach((item, index) => {
      generatedIssues.push({
        id: 20 + index,
        type:
          item.category === 'content' ? '文案' : item.category === 'function' ? '交互' : '模块',
        title: item.title,
        location: item.evidence,
        severity: item.category === 'content' || item.category === 'function' ? '高' : '中',
        status: '待确认',
      })
    })

    const baseReviewIssues = baseIssues.filter((issue) => {
      if (issue.type === '模块') return !captureMeta
      if (issue.type === '文案') return !ocrResults.length
      if (issue.type === '交互') return !actionResults.length

      return true
    })

    return [...generatedIssues, ...baseReviewIssues]
  }, [actionResults.length, captureMeta, diffStats, folderAssets.length, ocrResults.length, reviewDecisions, semanticResult])

  const allSemanticItems = useMemo(
    () => [...semanticResult.display, ...semanticResult.content, ...semanticResult.function],
    [semanticResult],
  )
  const decisionStats = useMemo(
    () => summarizeReviewDecisions(allSemanticItems, reviewDecisions),
    [allSemanticItems, reviewDecisions],
  )

  const report = useMemo(
    () =>
      [
        '验收目标：页面展示、页面内容、页面功能三部分辅助检查。',
        `页面类型：${pageType}`,
        `页面 URL：${url || '未填写'}`,
        captureMeta
          ? `页面截图：${captureMeta.title || '无标题'} / ${captureMeta.width} x ${captureMeta.height}`
          : '页面截图：未采集',
        designPreview ? '设计稿：已上传' : '设计稿：未上传',
        diffStats ? '展示一致性：已生成视觉参考图，需人工确认关键模块/入口/背景' : '展示一致性：未生成视觉参考',
        copyResult
          ? `业务文案：匹配 ${copyResult.matched.length} 条，缺失 ${copyResult.missing.length} 条`
          : '业务文案：未对比',
        folderAssets.length
          ? `需求/UE 资料：找到 ${folderAssets.length} 个候选资料`
          : '需求/UE 资料：未搜索',
        ocrResults.length
          ? `图片 OCR：识别 ${ocrResults.length} 张图，文本 ${collectOcrText(ocrResults).length} 字`
          : '图片 OCR：未识别',
        actionResults.length
          ? `功能点测：通过 ${actionResults.filter((item) => item.status === 'passed').length} 项，风险 ${actionResults.filter((item) => item.status === 'warning').length} 项，待确认 ${actionResults.filter((item) => item.status === 'manual').length} 项`
          : '功能点测：未运行',
        `人工确认：通过 ${decisionStats.passed}，需修改 ${decisionStats.needsChange}，待确认 ${decisionStats.pending}，忽略 ${decisionStats.ignored}`,
        finalConclusion.trim() ? `最终结论：${finalConclusion.trim()}` : '最终结论：未填写',
        `展示检查：${formatSemanticSummary(semanticResult.summary.display)}`,
        `内容检查：${formatSemanticSummary(semanticResult.summary.content)}`,
        `功能检查：${formatSemanticSummary(semanticResult.summary.function)}`,
      ].join('\n'),
    [actionResults, captureMeta, copyResult, decisionStats, designPreview, diffStats, finalConclusion, folderAssets.length, ocrResults, pageType, semanticResult, url],
  )

  const markdownReport = useMemo(
    () =>
      buildMarkdownReport({
        pageType,
        url,
        captureMeta,
        hasDesign: Boolean(designPreview),
        diffStats,
        copyResult,
        ocrResults,
        actionResults,
        folderAssets,
        semanticResult,
        reviewDecisions,
        finalConclusion,
        smartSummary,
      }),
    [
      actionResults,
      captureMeta,
      copyResult,
      designPreview,
      diffStats,
      finalConclusion,
      folderAssets,
      ocrResults,
      pageType,
      reviewDecisions,
      semanticResult,
      smartSummary,
      url,
    ],
  )

  function addMessage(role: ChatMessage['role'], text: string) {
    setMessages((current) => [
      ...current,
      {
        id: Date.now() + Math.random(),
        role,
        text,
      },
    ])
  }

  function updateReviewDecisionStatus(itemId: string, status: ReviewDecisionStatus) {
    setReviewDecisions((current) => {
      const existing = current[itemId] || { status: 'auto', note: '', updatedAt: '' }
      const nextDecision = {
        ...existing,
        status,
        updatedAt: new Date().toISOString(),
      }

      return compactReviewDecisions({
        ...current,
        [itemId]: nextDecision,
      })
    })
  }

  function updateReviewDecisionNote(itemId: string, note: string) {
    setReviewDecisions((current) => {
      const existing = current[itemId] || { status: 'auto', note: '', updatedAt: '' }
      const nextDecision = {
        ...existing,
        note,
        updatedAt: new Date().toISOString(),
      }

      return compactReviewDecisions({
        ...current,
        [itemId]: nextDecision,
      })
    })
  }

  function updateOcrText(itemId: string, text: string) {
    setOcrResults((current) =>
      current.map((item) => {
        if (item.id !== itemId) return item

        const originalText = item.originalText ?? item.text
        const corrected = normalizeCopy(text) !== normalizeCopy(originalText)

        return {
          ...item,
          text,
          originalText,
          corrected,
          correctedAt: corrected ? new Date().toISOString() : '',
        }
      }),
    )
    setCopyResult(null)
  }

  function resetOcrText(itemId: string) {
    setOcrResults((current) =>
      current.map((item) => {
        if (item.id !== itemId || item.originalText === undefined) return item

        return {
          ...item,
          text: item.originalText,
          corrected: false,
          correctedAt: '',
        }
      }),
    )
    setCopyResult(null)
  }

  function applyOcrCorrectionsToCopy() {
    setCopyError('')

    try {
      if (!cmsText.trim()) {
        throw new Error('请先粘贴 CMS 文档文案')
      }

      if (!captureMeta?.textSample?.trim()) {
        throw new Error('请先点击自动截图，获取页面 DOM 文本后再对比')
      }

      runCopyComparison(cmsText, getPageComparisonText(captureMeta, collectOcrText(ocrResults)))
      addMessage('assistant', '已使用人工修正后的 OCR 文案重新对比 CMS 文案。')
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : '应用 OCR 修正失败')
    }
  }

  function appendFolderAssetToSource(asset: FolderAsset) {
    const block = [
      `资料：${asset.relativePath}`,
      asset.snippet ? `摘录：${asset.snippet}` : '',
    ].filter(Boolean).join('\n')

    setCmsText((current) => [current.trim(), block].filter(Boolean).join('\n'))
    setCopyResult(null)
    setActionResults([])
    addMessage('assistant', `已把资料候选「${asset.name}」纳入验收输入。`)
  }

  function generateConclusionDraft() {
    const issueItems = allSemanticItems.filter((item) => shouldShowAsIssue(item, reviewDecisions[item.id]))
    const actionRiskCount = actionResults.filter((item) => item.status !== 'passed').length
    const copyMissingCount = copyResult?.missing.length || 0
    const correctedOcrCount = ocrResults.filter((item) => item.corrected).length
    const lines = [
      `验收对象：${pageType}${url ? ` / ${url}` : ''}`,
      captureMeta ? `页面截图：已采集「${captureMeta.title || '无标题'}」` : '页面截图：未采集',
      designPreview ? '展示证据：已上传设计稿，可人工确认关键模块、入口、背景一致性。' : '展示证据：未上传设计稿。',
      copyResult
        ? `内容检查：CMS 文案匹配 ${copyResult.matched.length} 条，疑似缺失 ${copyMissingCount} 条。`
        : '内容检查：尚未运行 CMS 文案对比。',
      ocrResults.length
        ? `OCR 证据：识别 ${ocrResults.length} 张图，人工修正 ${correctedOcrCount} 项。`
        : 'OCR 证据：尚未运行图片 OCR。',
      actionResults.length
        ? `功能点测：通过 ${actionResults.length - actionRiskCount} 项，需复核 ${actionRiskCount} 项。`
        : '功能点测：尚未运行。',
      folderAssets.length ? `资料引用：已命中 ${folderAssets.length} 个本地资料候选。` : '资料引用：尚未搜索本地资料。',
      issueItems.length
        ? `结论建议：当前仍有 ${issueItems.length} 个问题项，建议修正或人工确认后再通过验收。`
        : '结论建议：当前未发现需修改问题，可结合人工复核后通过验收。',
    ]

    setFinalConclusion(lines.join('\n'))
    setReportNotice('结论草稿已生成，可继续人工修改')
  }

  function currentReviewState(): PersistedReviewState {
    return {
      decisions: reviewDecisions,
      finalConclusion,
      projectName,
      activeTemplateId,
      smartSummary,
      pageType,
      url,
      cmsText,
      captureMeta,
      diffStats,
      copyResult,
      ocrResults,
      actionResults,
      folderPath,
      folderQuery,
      folderAssets,
    }
  }

  function applyReviewState(state: PersistedReviewState) {
    setProjectName(state.projectName || makeDefaultProjectName(state.url || ''))
    setActiveTemplateId(state.activeTemplateId || '')
    setSmartSummary(state.smartSummary || '')
    setPageType(pageTypes.includes(state.pageType as PageType) ? (state.pageType as PageType) : '网页移动端')
    setUrl(state.url || '')
    setCmsText(state.cmsText || '')
    setCaptureMeta(state.captureMeta || null)
    setDiffStats(state.diffStats || null)
    setCopyResult(state.copyResult || null)
    setOcrResults(Array.isArray(state.ocrResults) ? state.ocrResults : [])
    setActionResults(Array.isArray(state.actionResults) ? state.actionResults : [])
    setFolderPath(state.folderPath || 'D:\\vscode\\动效\\docs')
    setFolderQuery(state.folderQuery || '')
    setFolderAssets(Array.isArray(state.folderAssets) ? state.folderAssets : [])
    setReviewDecisions(state.decisions || {})
    setFinalConclusion(state.finalConclusion || '')
    setAssetPreview(null)
    setDesignPreview('')
    setActualPreview('')
    setDiffPreview('')
  }

  function saveCurrentProject() {
    const now = new Date().toISOString()
    const state = sanitizeProjectState({
      ...currentReviewState(),
      projectName: projectName.trim() || makeDefaultProjectName(url),
    })
    const project: ReviewProject = {
      id: activeProjectId || createId(),
      name: state.projectName || makeDefaultProjectName(url),
      createdAt: projects.find((item) => item.id === activeProjectId)?.createdAt || now,
      updatedAt: now,
      summary: buildProjectSummary(state, semanticResult),
      state,
    }
    const nextProjects = [project, ...projects.filter((item) => item.id !== project.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 24)

    setProjects(nextProjects)
    setActiveProjectId(project.id)
    persistReviewProjects(nextProjects)
    setReportNotice('验收项目已保存到本机')
  }

  function loadProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId)

    if (!project) return

    applyReviewState(project.state)
    setActiveProjectId(project.id)
    addMessage('assistant', `已载入历史项目「${project.name}」。`)
  }

  function deleteProject(projectId: string) {
    const nextProjects = projects.filter((item) => item.id !== projectId)

    setProjects(nextProjects)
    persistReviewProjects(nextProjects)

    if (activeProjectId === projectId) {
      setActiveProjectId('')
    }

    setReportNotice('历史项目已删除')
  }

  function createNewProject() {
    applyReviewState({
      decisions: {},
      finalConclusion: '',
      projectName: makeDefaultProjectName(''),
      activeTemplateId: '',
      smartSummary: '',
      pageType: '网页移动端',
      url: '',
      cmsText: '',
      captureMeta: null,
      diffStats: null,
      copyResult: null,
      ocrResults: [],
      actionResults: [],
      folderPath: 'D:\\vscode\\动效\\docs',
      folderQuery: '',
      folderAssets: [],
    })
    setActiveProjectId('')
    setMessages([
      {
        id: Date.now(),
        role: 'assistant',
        text: '已新建一个空验收项目。可以先套模板，再粘贴 URL、资料文件夹或 CMS 文案。',
      },
    ])
  }

  function applyReviewTemplate(template: ReviewTemplate) {
    const block = [
      `模板：${template.title}`,
      ...template.checks.map((item) => `- ${item}`),
    ].join('\n')

    setPageType(template.pageType)
    setActiveTemplateId(template.id)
    setFolderQuery(template.folderQuery)
    setCmsText((current) => [current.trim(), block].filter(Boolean).join('\n\n'))
    setCopyResult(null)
    setActionResults([])
    setSmartSummary('')
    addMessage('assistant', `已套用「${template.title}」验收模板，检查项已加入输入区。`)
  }

  async function previewFolderAsset(asset: FolderAsset) {
    setIsPreviewingAsset(true)
    setFolderError('')

    try {
      const response = await fetch(assetPreviewEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: asset.path }),
      })
      const data = (await response.json()) as FolderAssetPreview

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '资料预览失败')
      }

      setAssetPreview(data)
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : '资料预览失败')
    } finally {
      setIsPreviewingAsset(false)
    }
  }

  function usePreviewAsDesign() {
    if (!assetPreview?.dataUrl) return

    setDesignPreview(assetPreview.dataUrl)
    setDiffPreview('')
    setDiffStats(null)
    setOcrResults((current) => current.filter((item) => item.id !== 'design'))
    addMessage('assistant', `已把「${assetPreview.name || '图片资料'}」设为设计稿证据。`)
  }

  function generateSmartSummary() {
    const summary = buildSmartSummary({
      pageType,
      url,
      captureMeta,
      hasDesign: Boolean(designPreview),
      copyResult,
      ocrResults,
      actionResults,
      folderAssets,
      semanticResult,
      reviewDecisions,
    })

    setSmartSummary(summary)
    setReportNotice('智能总结已生成')
  }

  function applySmartSummaryToConclusion() {
    if (!smartSummary.trim()) return

    setFinalConclusion((current) => [smartSummary.trim(), current.trim()].filter(Boolean).join('\n\n'))
    setReportNotice('智能总结已写入最终结论')
  }

  async function copyMarkdownReport() {
    await navigator.clipboard.writeText(markdownReport)
    setReportNotice('Markdown 报告已复制')
  }

  function downloadMarkdownReport() {
    const blob = new Blob([markdownReport], { type: 'text/markdown;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = objectUrl
    link.download = `campaign-review-${formatFileDate(new Date())}.md`
    link.click()
    URL.revokeObjectURL(objectUrl)
    setReportNotice('Markdown 报告已下载')
  }

  function handlePreview(
    event: ChangeEvent<HTMLInputElement>,
    setter: (value: string) => void,
    ocrId: 'design' | 'actual',
  ) {
    const file = event.target.files?.[0]

    if (!file) return

    const reader = new FileReader()

    reader.onload = () => {
      setter(String(reader.result || ''))
      setDiffPreview('')
      setDiffStats(null)
      setOcrResults((current) => current.filter((item) => item.id !== ocrId))
    }
    reader.readAsDataURL(file)
  }

  async function submitChat() {
    const text = chatInput.trim()

    if (!text) return

    setChatInput('')
    addMessage('user', text)

    const nextUrl = extractUrl(text)
    const nextFolder = extractWindowsPath(text)
    const remainingText = stripKnownInputs(text, [nextUrl, nextFolder])
    const nextQuery = remainingText || folderQuery

    if (nextUrl) {
      setUrl(nextUrl)
      addMessage('assistant', `已识别页面 URL：${nextUrl}。我开始自动截图。`)
    }

    if (nextFolder) {
      setFolderPath(nextFolder)
      if (remainingText) {
        setFolderQuery(remainingText)
      }
      addMessage('assistant', `已识别资料文件夹：${nextFolder}。我开始搜索相关设计稿、需求和 UE 资料。`)
      await searchFolder(nextFolder, nextQuery)
    }

    if (remainingText) {
      setCmsText(remainingText)
      setCopyResult(null)
      setActionResults([])
      addMessage('assistant', '已把剩余文本作为 CMS/业务方文案或需求/UE 描述候选。')
    }

    if (nextUrl) {
      await capturePage(nextUrl, remainingText || cmsText)
      return
    }

    if (!nextUrl && !nextFolder && remainingText) {
      if (captureMeta?.textSample) {
        runCopyComparison(remainingText, captureMeta.textSample)
      } else {
        addMessage('assistant', '还没有页面截图文本。请先丢页面 URL，或点击自动截图后我再对比文案。')
      }
    }
  }

  async function capturePage(targetUrl = url, copyText = cmsText) {
    setIsCapturing(true)
    setCaptureError('')

    try {
      const response = await fetch(captureEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          viewport: { width: 390, height: 844 },
          waitMs: 5000,
        }),
      })
      const data = (await response.json()) as CaptureResponse

      if (!response.ok || !data.ok || !data.image) {
        throw new Error(data.message || '截图失败')
      }

      setActualPreview(`data:image/png;base64,${data.image}`)
      setCaptureMeta(data.meta || null)
      setCopyResult(null)
      setOcrResults((current) => current.filter((item) => item.id !== 'actual'))
      setActionResults([])
      setDiffPreview('')
      setDiffStats(null)
      addMessage('assistant', `页面截图已采集：${data.meta?.title || '无标题'}。`)

      if (copyText.trim() && data.meta?.textSample) {
        runCopyComparison(
          copyText,
          getPageComparisonText(
            data.meta,
            collectOcrText(ocrResults.filter((item) => item.id !== 'actual')),
          ),
        )
      }

      return data.meta || null
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : '截图失败')
      return null
    } finally {
      setIsCapturing(false)
    }
  }

  async function generateDiff() {
    setIsDiffing(true)
    setDiffError('')

    try {
      if (!designPreview || !actualPreview) {
        throw new Error('请先上传设计稿截图，并采集或上传实际页面截图')
      }

      const result = await createVisualDiff(designPreview, actualPreview)

      setDiffPreview(result.image)
      setDiffStats(result.stats)
      addMessage('assistant', '视觉参考图已生成。它只用于辅助确认关键模块、入口、背景是否明显不一致。')
    } catch (error) {
      setDiffError(error instanceof Error ? error.message : '生成视觉参考失败')
    } finally {
      setIsDiffing(false)
    }
  }

  function compareCmsCopy() {
    setCopyError('')

    try {
      if (!cmsText.trim()) {
        throw new Error('请先粘贴 CMS 文档文案')
      }

      if (!captureMeta?.textSample?.trim()) {
        throw new Error('请先点击自动截图，获取页面 DOM 文本后再对比')
      }

      runCopyComparison(cmsText, getPageComparisonText(captureMeta, collectOcrText(ocrResults)))
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : '文案对比失败')
    }
  }

  function runCopyComparison(sourceText: string, pageText: string) {
    const result = compareCopy(sourceText, pageText)

    setCopyResult(result)
    addMessage('assistant', `文案对比完成：匹配 ${result.matched.length} 条，缺失 ${result.missing.length} 条。`)

    return result
  }

  async function runImageOcr() {
    setIsRunningOcr(true)
    setOcrError('')

    try {
      const images = [
        designPreview ? { id: 'design', label: '设计稿', image: designPreview } : null,
        actualPreview ? { id: 'actual', label: '页面截图', image: actualPreview } : null,
      ].filter(Boolean)

      if (!images.length) {
        throw new Error('请先上传设计稿或采集页面截图')
      }

      const response = await fetch(ocrEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'chi_sim+eng', images }),
      })
      const data = (await response.json()) as OcrResponse

      if (!response.ok || !data.ok) {
        throw new Error(data.message || 'OCR 识别失败')
      }

      const results = (data.results || []).map((item) => ({
        ...item,
        originalText: item.text,
        corrected: false,
        correctedAt: '',
      }))

      setOcrResults(results)
      addMessage('assistant', `图片 OCR 完成：识别 ${results.length} 张图。`)

      if (cmsText.trim() && captureMeta?.textSample) {
        runCopyComparison(cmsText, getPageComparisonText(captureMeta, collectOcrText(results)))
      }
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : 'OCR 识别失败')
    } finally {
      setIsRunningOcr(false)
    }
  }

  async function runActionCheck() {
    setIsTestingActions(true)
    setActionError('')

    try {
      if (!url.trim()) {
        throw new Error('请先填写页面 URL')
      }

      const expectations = extractFunctionTerms(cmsText)

      if (!expectations.length) {
        throw new Error('请先粘贴需求或 UE 功能描述，例如“购票按钮点击后跳转购票页”')
      }

      const response = await fetch(actionCheckEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, expectations, waitMs: 4000 }),
      })
      const data = (await response.json()) as ActionCheckResponse

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '功能点测失败')
      }

      const results = data.results || []
      const passed = results.filter((item) => item.status === 'passed').length
      const warning = results.filter((item) => item.status === 'warning').length
      const manual = results.filter((item) => item.status === 'manual').length

      setActionResults(results)
      addMessage(
        'assistant',
        `功能点测完成：通过 ${passed} 项，风险 ${warning} 项，待确认 ${manual} 项。`,
      )
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '功能点测失败')
    } finally {
      setIsTestingActions(false)
    }
  }

  async function searchFolder(targetPath = folderPath, query = folderQuery) {
    setIsSearchingFolder(true)
    setFolderError('')

    try {
      const response = await fetch(searchFolderEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: targetPath, query }),
      })
      const data = (await response.json()) as FolderSearchResponse

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '资料搜索失败')
      }

      setFolderAssets(data.results || [])
      addMessage('assistant', `资料搜索完成：扫描 ${data.total || 0} 个文件，命中 ${(data.results || []).length} 个候选资料。`)
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : '资料搜索失败')
    } finally {
      setIsSearchingFolder(false)
    }
  }

  return (
    <main className="min-h-screen bg-canvas text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-ink text-white">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">专题验收助手</h1>
              <p className="text-sm text-muted-foreground">campaign-review-assistant</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">展示</Badge>
            <Badge variant="warning">内容</Badge>
            <Badge variant="outline">功能</Badge>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1440px] gap-4 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <ProjectAndTemplatePanel
            projectName={projectName}
            projects={projects}
            activeProjectId={activeProjectId}
            templates={reviewTemplates}
            activeTemplateId={activeTemplateId}
            onProjectNameChange={setProjectName}
            onSaveProject={saveCurrentProject}
            onLoadProject={loadProject}
            onDeleteProject={deleteProject}
            onNewProject={createNewProject}
            onApplyTemplate={applyReviewTemplate}
          />

          <section className="rounded-md border border-border bg-background shadow-sm">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Bot className="size-4" />
                验收对话
              </div>
            </div>
            <div className="max-h-56 space-y-3 overflow-auto p-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={message.role === 'user' ? 'ml-auto max-w-[78%]' : 'mr-auto max-w-[82%]'}
                >
                  <div
                    className={
                      message.role === 'user'
                        ? 'rounded-md bg-ink px-3 py-2 text-sm text-white'
                        : 'rounded-md border border-border bg-panel px-3 py-2 text-sm'
                    }
                  >
                    {message.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border p-4">
              <Textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="粘贴页面 URL、资料文件夹地址、CMS 文案、需求或 UE 描述..."
                className="min-h-24"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button onClick={submitChat}>
                  <Send />
                  发送
                </Button>
                <Button variant="outline" onClick={() => capturePage()} disabled={isCapturing || !url}>
                  {isCapturing ? <Loader2 className="animate-spin" /> : <Camera />}
                  自动截图
                </Button>
                <Button variant="outline" asChild>
                  <label>
                    <Paperclip />
                    上传设计稿
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(event) => handlePreview(event, setDesignPreview, 'design')}
                    />
                  </label>
                </Button>
                <Button variant="outline" onClick={compareCmsCopy} disabled={!cmsText.trim() || !captureMeta?.textSample}>
                  <FileText />
                  对比文案
                </Button>
                <Button variant="outline" onClick={runImageOcr} disabled={isRunningOcr || (!designPreview && !actualPreview)}>
                  {isRunningOcr ? <Loader2 className="animate-spin" /> : <ScanText />}
                  图片 OCR
                </Button>
                <Button variant="outline" onClick={runActionCheck} disabled={isTestingActions || !url || !cmsText.trim()}>
                  {isTestingActions ? <Loader2 className="animate-spin" /> : <MousePointerClick />}
                  点测功能
                </Button>
                <Button variant="outline" onClick={generateDiff} disabled={isDiffing || !designPreview || !actualPreview}>
                  {isDiffing ? <Loader2 className="animate-spin" /> : <Eye />}
                  视觉参考
                </Button>
              </div>
              <InlineErrors errors={[captureError, copyError, ocrError, actionError, diffError, folderError]} />
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <ReviewGoalCard
              icon={<MonitorSmartphone />}
              title="页面展示"
              desc="设计稿、页面截图、背景图、关键入口和模块是否一致。"
              status={formatGoalStatus(semanticResult.summary.display)}
            />
            <ReviewGoalCard
              icon={<FileText />}
              title="页面内容"
              desc="CMS/业务方文案与页面展示文案是否一致。"
              status={formatGoalStatus(semanticResult.summary.content)}
            />
            <ReviewGoalCard
              icon={<ClipboardList />}
              title="页面功能"
              desc="按钮、跳转、弹窗、状态是否符合需求文档和 UE 描述。"
              status={formatGoalStatus(semanticResult.summary.function)}
            />
          </section>

          <SemanticChecksPanel
            result={semanticResult}
            decisions={reviewDecisions}
            onStatusChange={updateReviewDecisionStatus}
            onNoteChange={updateReviewDecisionNote}
          />

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <EvidencePanel
              designPreview={designPreview}
              actualPreview={actualPreview}
              diffPreview={diffPreview}
              diffStats={diffStats}
              pageType={pageType}
              onPageTypeChange={setPageType}
              url={url}
              onUrlChange={setUrl}
              onDesignUpload={(event) => handlePreview(event, setDesignPreview, 'design')}
              onActualUpload={(event) => handlePreview(event, setActualPreview, 'actual')}
            />
            <ContentAndFolderPanel
              cmsText={cmsText}
              onCmsTextChange={(value) => {
                setCmsText(value)
                setCopyResult(null)
              }}
              copyResult={copyResult}
              ocrResults={ocrResults}
              onOcrTextChange={updateOcrText}
              onOcrReset={resetOcrText}
              onApplyOcrToCopy={applyOcrCorrectionsToCopy}
              actionResults={actionResults}
              folderPath={folderPath}
              folderQuery={folderQuery}
              folderAssets={folderAssets}
              assetPreview={assetPreview}
              isSearchingFolder={isSearchingFolder}
              isPreviewingAsset={isPreviewingAsset}
              onFolderPathChange={setFolderPath}
              onFolderQueryChange={setFolderQuery}
              onSearchFolder={() => searchFolder()}
              onAppendAsset={appendFolderAssetToSource}
              onPreviewAsset={previewFolderAsset}
              onUsePreviewAsDesign={usePreviewAsDesign}
            />
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-md border border-border bg-background p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">问题清单</h2>
              <Badge variant="danger">{issues.length} 项</Badge>
            </div>
            <div className="space-y-2">
              {issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} />
              ))}
            </div>
          </section>

          <section className="rounded-md border border-border bg-background p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">验收摘要</h2>
            </div>
            <ReviewClosureSummary
              semanticResult={semanticResult}
              decisionStats={decisionStats}
              copyResult={copyResult}
              actionResults={actionResults}
              folderAssets={folderAssets}
              ocrResults={ocrResults}
              hasDesign={Boolean(designPreview)}
              hasActual={Boolean(actualPreview)}
              onGenerateConclusion={generateConclusionDraft}
            />
            <SmartSummaryPanel
              summary={smartSummary}
              onGenerate={generateSmartSummary}
              onApplyToConclusion={applySmartSummaryToConclusion}
            />
            <label className="mb-3 block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">最终结论 / 验收备注</span>
              <Textarea
                value={finalConclusion}
                onChange={(event) => setFinalConclusion(event.target.value)}
                placeholder="例如：核心流程通过，往返接驳预约入口需补充后再上线。"
                className="min-h-24 text-xs"
              />
            </label>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={copyMarkdownReport}>
                <Copy />
                复制报告
              </Button>
              <Button variant="outline" onClick={downloadMarkdownReport}>
                <Download />
                下载 Markdown
              </Button>
            </div>
            {reportNotice ? (
              <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {reportNotice}
              </p>
            ) : null}
            <Textarea value={report} readOnly className="min-h-64 font-mono text-xs" />
          </section>
        </aside>
      </section>
    </main>
  )
}

function extractUrl(value: string) {
  return value.match(/https?:\/\/[^\s"'，。]+/)?.[0] || ''
}

function extractWindowsPath(value: string) {
  return (
    value.match(/["“]([a-zA-Z]:\\[^"”<>|]+)["”]/)?.[1]?.trim() ||
    value.match(/[a-zA-Z]:\\[^\s"'<>|]+/)?.[0]?.trim() ||
    ''
  )
}

function stripKnownInputs(value: string, inputs: string[]) {
  return inputs
    .filter(Boolean)
    .reduce((current, input) => current.replace(input, ''), value)
    .trim()
}

function collectOcrText(results: OcrItem[]) {
  return results.map((item) => item.text).filter(Boolean).join('\n')
}

function getPageComparisonText(meta: CaptureMeta | null, ocrText: string) {
  return [meta?.textSample || '', ocrText].filter(Boolean).join('\n')
}

function compactText(value: string) {
  const text = value.replace(/\s+/g, ' ').trim()

  if (text.length <= 120) return text

  return `${text.slice(0, 120)}...`
}

function loadPersistedReviewState(): PersistedReviewState {
  const emptyState = { decisions: {}, finalConclusion: '' }

  if (typeof window === 'undefined') return emptyState

  try {
    const raw = window.localStorage.getItem(reviewStateStorageKey)

    if (!raw) return emptyState

    const parsed = JSON.parse(raw) as Partial<PersistedReviewState>

    return {
      decisions: parsed.decisions || {},
      finalConclusion: String(parsed.finalConclusion || ''),
      projectName: parsed.projectName ? String(parsed.projectName) : undefined,
      activeTemplateId: parsed.activeTemplateId ? String(parsed.activeTemplateId) : undefined,
      smartSummary: parsed.smartSummary ? String(parsed.smartSummary) : undefined,
      pageType: pageTypes.includes(parsed.pageType as PageType) ? (parsed.pageType as PageType) : undefined,
      url: parsed.url ? String(parsed.url) : undefined,
      cmsText: parsed.cmsText ? String(parsed.cmsText) : undefined,
      captureMeta: parsed.captureMeta || null,
      diffStats: parsed.diffStats || null,
      copyResult: parsed.copyResult || null,
      ocrResults: Array.isArray(parsed.ocrResults) ? parsed.ocrResults : [],
      actionResults: Array.isArray(parsed.actionResults) ? parsed.actionResults : [],
      folderPath: parsed.folderPath ? String(parsed.folderPath) : undefined,
      folderQuery: parsed.folderQuery ? String(parsed.folderQuery) : undefined,
      folderAssets: Array.isArray(parsed.folderAssets) ? parsed.folderAssets : [],
    }
  } catch {
    return emptyState
  }
}

function persistReviewState(state: PersistedReviewState) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(reviewStateStorageKey, JSON.stringify(state))
}

function loadReviewProjects(): ReviewProject[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(reviewProjectsStorageKey)

    if (!raw) return []

    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((item): item is ReviewProject => {
        return Boolean(item?.id && item?.name && item?.state)
      })
      .slice(0, 24)
  } catch {
    return []
  }
}

function persistReviewProjects(projects: ReviewProject[]) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(reviewProjectsStorageKey, JSON.stringify(projects.slice(0, 24)))
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeDefaultProjectName(value: string) {
  const urlName = value ? value.replace(/^https?:\/\//, '').split(/[/?#]/)[0] : ''

  return urlName ? `${urlName} 验收` : `专题验收 ${formatHumanDate(new Date())}`
}

function sanitizeProjectState(state: PersistedReviewState): PersistedReviewState {
  return {
    ...state,
    actionResults: (state.actionResults || []).map((item) => ({
      ...item,
      beforeImage: '',
      afterImage: '',
    })),
  }
}

function buildProjectSummary(state: PersistedReviewState, semanticResult: SemanticReviewResult) {
  const warningCount =
    semanticResult.summary.display.warning +
    semanticResult.summary.content.warning +
    semanticResult.summary.function.warning
  const actionRiskCount = (state.actionResults || []).filter((item) => item.status !== 'passed').length

  return [
    state.pageType || '未选择类型',
    state.url ? shortenUrl(state.url) : '未填写 URL',
    `风险 ${warningCount}`,
    state.copyResult ? `文案缺失 ${state.copyResult.missing.length}` : '文案未对比',
    state.actionResults?.length ? `点测待复核 ${actionRiskCount}` : '功能未点测',
  ].join(' / ')
}

function buildSmartSummary({
  pageType,
  url,
  captureMeta,
  hasDesign,
  copyResult,
  ocrResults,
  actionResults,
  folderAssets,
  semanticResult,
  reviewDecisions,
}: {
  pageType: PageType
  url: string
  captureMeta: CaptureMeta | null
  hasDesign: boolean
  copyResult: CopyCheckResult | null
  ocrResults: OcrItem[]
  actionResults: ActionCheckItem[]
  folderAssets: FolderAsset[]
  semanticResult: SemanticReviewResult
  reviewDecisions: ReviewDecisionMap
}) {
  const items = [...semanticResult.display, ...semanticResult.content, ...semanticResult.function]
  const issueItems = items.filter((item) => shouldShowAsIssue(item, reviewDecisions[item.id]))
  const actionRisks = actionResults.filter((item) => item.status !== 'passed')
  const missingCopy = copyResult?.missing || []
  const correctedOcrCount = ocrResults.filter((item) => item.corrected).length
  const topIssues = issueItems.slice(0, 5).map((item, index) => `${index + 1}. ${item.title}：${item.evidence}`)
  const nextSteps = [
    !captureMeta ? '先采集页面截图，获得 DOM、按钮和资源证据。' : '',
    !hasDesign ? '补充设计稿或从资料预览中设为设计稿，确认关键模块和背景。' : '',
    !copyResult ? '运行 CMS 文案对比，优先确认上线文案。' : '',
    missingCopy.length ? `复核 ${missingCopy.length} 条疑似缺失文案，必要时用 OCR 修正后再对比。` : '',
    !actionResults.length ? '运行功能点测，确认核心 CTA 的跳转、弹窗或状态变化。' : '',
    actionRisks.length ? `复核 ${actionRisks.length} 个功能点测风险，重点看失败原因和点测截图。` : '',
    !folderAssets.length ? '搜索本地资料文件夹，把 PRD/UE 摘录纳入验收输入。' : '',
  ].filter(Boolean)

  return [
    `验收对象：${pageType}${url ? ` / ${url}` : ''}`,
    `总体判断：${issueItems.length ? `当前仍有 ${issueItems.length} 个风险项，需要继续复核。` : '当前机器检查未发现明确需修改项，可进入人工复核。'}`,
    `证据完整度：${captureMeta ? '页面已采集' : '页面未采集'}；${hasDesign ? '设计稿已就绪' : '设计稿缺失'}；资料候选 ${folderAssets.length} 个；OCR 修正 ${correctedOcrCount} 项。`,
    `文案风险：${copyResult ? `匹配 ${copyResult.matched.length} 条，疑似缺失 ${missingCopy.length} 条。` : '尚未运行 CMS 文案对比。'}`,
    `功能风险：${actionResults.length ? `通过 ${actionResults.length - actionRisks.length} 项，风险/待确认 ${actionRisks.length} 项。` : '尚未运行功能点测。'}`,
    '',
    '重点问题：',
    ...(topIssues.length ? topIssues : ['暂无明确风险项。']),
    '',
    '建议下一步：',
    ...(nextSteps.length ? nextSteps.map((item, index) => `${index + 1}. ${item}`) : ['1. 按人工确认结果导出 Markdown 报告并归档。']),
  ].join('\n')
}

function compactReviewDecisions(decisions: ReviewDecisionMap) {
  return Object.fromEntries(
    Object.entries(decisions).filter(([, decision]) => {
      return decision.status !== 'auto' || decision.note.trim()
    }),
  )
}

function shouldShowAsIssue(item: SemanticReviewItem, decision?: ReviewDecision) {
  if (decision?.status === 'ignored' || decision?.status === 'passed') return false
  if (decision?.status === 'needs-change') return true

  return item.status === 'warning'
}

function summarizeReviewDecisions(items: SemanticReviewItem[], decisions: ReviewDecisionMap) {
  const itemIds = new Set(items.map((item) => item.id))
  const activeDecisions = Object.entries(decisions).filter(([itemId]) => itemIds.has(itemId))

  return {
    passed: activeDecisions.filter(([, decision]) => decision.status === 'passed').length,
    needsChange: activeDecisions.filter(([, decision]) => decision.status === 'needs-change').length,
    pending: activeDecisions.filter(([, decision]) => decision.status === 'pending').length,
    ignored: activeDecisions.filter(([, decision]) => decision.status === 'ignored').length,
    noted: activeDecisions.filter(([, decision]) => decision.note.trim()).length,
  }
}

function buildMarkdownReport(input: MarkdownReportInput) {
  const decisionStats = summarizeReviewDecisions(
    [...input.semanticResult.display, ...input.semanticResult.content, ...input.semanticResult.function],
    input.reviewDecisions,
  )
  const correctedOcrCount = input.ocrResults.filter((item) => item.corrected).length
  const actionRiskCount = input.actionResults.filter((item) => item.status !== 'passed').length
  const issueItems = [
    ...input.semanticResult.display,
    ...input.semanticResult.content,
    ...input.semanticResult.function,
  ].filter((item) => shouldShowAsIssue(item, input.reviewDecisions[item.id]))
  const lines = [
    '# 专题验收报告',
    '',
    `生成时间：${formatHumanDate(new Date())}`,
    '',
    '## 基本信息',
    '',
    `- 页面类型：${input.pageType}`,
    `- 页面 URL：${input.url || '未填写'}`,
    input.captureMeta
      ? `- 页面截图：${input.captureMeta.title || '无标题'} / ${input.captureMeta.width} x ${input.captureMeta.height}`
      : '- 页面截图：未采集',
    `- 设计稿：${input.hasDesign ? '已上传' : '未上传'}`,
    `- 视觉参考：${input.diffStats ? `已生成，差异 ${(input.diffStats.ratio * 100).toFixed(2)}%` : '未生成'}`,
    `- 资料候选：${input.folderAssets.length} 个`,
    '',
    '## 最终结论',
    '',
    input.finalConclusion.trim() || '未填写',
    '',
    '## 智能总结',
    '',
    input.smartSummary.trim() || '未生成',
    '',
    '## 汇总',
    '',
    `- 展示检查：${formatSemanticSummary(input.semanticResult.summary.display)}`,
    `- 内容检查：${formatSemanticSummary(input.semanticResult.summary.content)}`,
    `- 功能检查：${formatSemanticSummary(input.semanticResult.summary.function)}`,
    `- 人工确认：通过 ${decisionStats.passed}，需修改 ${decisionStats.needsChange}，待确认 ${decisionStats.pending}，忽略 ${decisionStats.ignored}，备注 ${decisionStats.noted}`,
    `- 问题项：${issueItems.length} 个`,
    '',
    '## 验收闭环',
    '',
    `- 展示证据：${input.hasDesign && input.captureMeta ? '设计稿和页面截图已就绪' : '证据不完整'}`,
    `- 内容对比：${input.copyResult ? `匹配 ${input.copyResult.matched.length} 条，缺失 ${input.copyResult.missing.length} 条` : '未运行'}`,
    `- OCR 修正：${input.ocrResults.length ? `识别 ${input.ocrResults.length} 张，人工修正 ${correctedOcrCount} 项` : '未运行'}`,
    `- 功能点测：${input.actionResults.length ? `通过 ${input.actionResults.length - actionRiskCount} 项，风险/待确认 ${actionRiskCount} 项` : '未运行'}`,
    `- 本地资料：${input.folderAssets.length ? `命中 ${input.folderAssets.length} 个候选` : '未搜索'}`,
    '',
    '## 问题清单',
    '',
    issueItems.length ? '' : '暂无需修改问题。',
  ]

  issueItems.forEach((item, index) => {
    const decision = input.reviewDecisions[item.id]

    lines.push(
      `${index + 1}. ${item.title}`,
      `   - 分类：${semanticCategoryLabel(item.category)}`,
      `   - 状态：${reviewDecisionLabel(decision?.status || 'auto', item.status)}`,
      `   - 来源：${item.source}`,
      `   - 证据：${item.evidence}`,
      decision?.note.trim() ? `   - 备注：${decision.note.trim()}` : '',
    )
  })

  lines.push(
    '',
    '## 展示检查',
    '',
    ...renderMarkdownItems(input.semanticResult.display, input.reviewDecisions),
    '',
    '## 内容检查',
    '',
    ...renderMarkdownItems(input.semanticResult.content, input.reviewDecisions),
    '',
    '## 功能检查',
    '',
    ...renderMarkdownItems(input.semanticResult.function, input.reviewDecisions),
    '',
    '## CMS 文案对比',
    '',
    input.copyResult
      ? `- 匹配 ${input.copyResult.matched.length} 条，缺失 ${input.copyResult.missing.length} 条，忽略 ${input.copyResult.ignored.length} 条`
      : '- 未运行文案对比',
  )

  if (input.copyResult?.missing.length) {
    input.copyResult.missing.forEach((item) => {
      lines.push(`- 疑似缺失：${item.source}`)
    })
  }

  lines.push('', '## 图片 OCR', '')

  if (input.ocrResults.length) {
    input.ocrResults.forEach((item) => {
      lines.push(
        `- ${item.label}：置信度 ${item.confidence.toFixed(1)}${item.corrected ? ' / 已人工修正' : ''}`,
        item.corrected && item.originalText !== undefined
          ? `  - 原始 OCR：${compactText(item.originalText) || '未识别到文字'}`
          : '',
        item.text.trim() ? `  - 文本：${compactText(item.text)}` : '  - 文本：未识别到文字',
      )
    })
  } else {
    lines.push('- 未运行 OCR')
  }

  lines.push('', '## 功能点测', '')

  if (input.actionResults.length) {
    input.actionResults.forEach((item, index) => {
      lines.push(
        `### ${index + 1}. ${item.title}`,
        '',
        `- 状态：${semanticStatusLabel(item.status)}`,
        `- 功能词：${item.term}`,
        `- 失败原因：${item.failureReason || '无'}`,
        `- 点击前 URL：${item.beforeUrl || '未记录'}`,
        `- 点击后 URL：${item.afterUrl || '未记录'}`,
        `- URL 变化：${item.urlChanged ? '是' : '否'}`,
        `- 页面文本变化：${item.textChanged ? '是' : '否'}`,
        `- 新窗口 / 弹窗页：${item.popupOpened ? '是' : '否'}`,
        `- 浏览器弹窗：${item.dialogs?.length ? item.dialogs.map((dialog) => dialog.message).join(' / ') : '无'}`,
        `- 候选入口：${item.matchedElement ? describeElement(item.matchedElement) : '未找到'}`,
        `- 证据：${item.evidence}`,
        item.beforeImage ? `- 点测前截图：\n\n![${item.term} 点测前](${item.beforeImage})` : '',
        item.afterImage ? `- 点测后截图：\n\n![${item.term} 点测后](${item.afterImage})` : '',
        '',
      )
    })
  } else {
    lines.push('- 未运行功能点测')
  }

  lines.push('', '## 资料候选', '')

  if (input.folderAssets.length) {
    input.folderAssets.slice(0, 12).forEach((asset) => {
      lines.push(
        `- ${asset.relativePath} (${asset.type})`,
        asset.snippet ? `  - 摘录：${asset.snippet}` : '',
      )
    })
  } else {
    lines.push('- 未搜索资料')
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

function renderMarkdownItems(items: SemanticReviewItem[], decisions: ReviewDecisionMap) {
  if (!items.length) return ['暂无检查项。']

  return items.flatMap((item) => {
    const decision = decisions[item.id]

    return [
      `- ${item.title}`,
      `  - 状态：${reviewDecisionLabel(decision?.status || 'auto', item.status)}`,
      `  - 来源：${item.source}`,
      `  - 证据：${item.evidence}`,
      decision?.note.trim() ? `  - 备注：${decision.note.trim()}` : '',
    ].filter(Boolean)
  })
}

function semanticCategoryLabel(category: SemanticCategory) {
  if (category === 'display') return '展示'
  if (category === 'content') return '内容'

  return '功能'
}

function formatHumanDate(date: Date) {
  return `${date.getFullYear()}-${padDate(date.getMonth() + 1)}-${padDate(date.getDate())} ${padDate(date.getHours())}:${padDate(date.getMinutes())}`
}

function formatFileDate(date: Date) {
  return `${date.getFullYear()}${padDate(date.getMonth() + 1)}${padDate(date.getDate())}-${padDate(date.getHours())}${padDate(date.getMinutes())}`
}

function padDate(value: number) {
  return String(value).padStart(2, '0')
}

function buildSemanticReview(input: BuildSemanticReviewInput): SemanticReviewResult {
  const display: SemanticReviewItem[] = []
  const content: SemanticReviewItem[] = []
  const functionChecks: SemanticReviewItem[] = []
  const lines = extractReviewLines(input.sourceText)
  const terms = extractExpectationTerms(input.sourceText)
  const meta = input.meta
    ? {
        ...input.meta,
        interactiveElements: input.meta.interactiveElements || [],
        images: input.meta.images || [],
        backgroundImages: input.meta.backgroundImages || [],
      }
    : null
  const pageComparisonText = getPageComparisonText(meta, input.ocrText)
  const activeCopyResult =
    input.copyResult ||
    (meta?.textSample && input.sourceText.trim()
      ? compareCopy(input.sourceText, pageComparisonText)
      : null)

  if (!meta) {
    addSemanticItem(
      display,
      'display',
      '等待页面截图',
      '页面 URL',
      'manual',
      '先粘贴 URL 或点击自动截图',
    )
    addSemanticItem(
      content,
      'content',
      '等待页面 DOM 文本',
      'CMS / 业务方文案',
      'manual',
      '截图后才能对比页面实际展示文本',
    )
    addSemanticItem(
      functionChecks,
      'function',
      '等待页面交互证据',
      '需求 / UE 描述',
      'manual',
      '截图后才能识别按钮、链接和点击入口',
    )

    return withSemanticSummary(display, content, functionChecks)
  }

  addSemanticItem(
    display,
    'display',
    '页面已成功采集',
    meta.title || '页面截图',
    'passed',
    `${meta.width} x ${meta.height}，首屏 ${meta.viewportWidth} x ${meta.viewportHeight}`,
  )

  addSemanticItem(
    display,
    'display',
    input.hasDesign && input.hasActual ? '设计稿和页面截图已就绪' : '设计稿或页面截图不完整',
    '设计稿 vs 页面截图',
    input.hasDesign && input.hasActual ? 'manual' : 'warning',
    input.hasDesign && input.hasActual
      ? '可继续人工确认关键模块、入口、背景是否一致'
      : '上传设计稿并采集页面截图后，展示检查才完整',
  )

  addSemanticItem(
    display,
    'display',
    '页面图片和背景素材',
    '页面资源',
    meta.images.length || meta.backgroundImages.length ? 'passed' : 'warning',
    `图片 ${meta.images.length} 个，背景图 ${meta.backgroundImages.length} 个`,
  )

  for (const term of terms.slice(0, 10)) {
    const source = findSourceLine(term, lines)
    const evidence = findVisualEvidence(term, meta)
    const position = getPositionExpectation(source)

    if (term === '背景' || term === '主视觉') {
      addSemanticItem(
        display,
        'display',
        `${term}素材需确认`,
        source,
        meta.backgroundImages.length || meta.images.length ? 'manual' : 'warning',
        meta.backgroundImages.length
          ? describeBackground(meta.backgroundImages[0])
          : meta.images[0]
            ? describeImage(meta.images[0])
            : '未识别到图片或 CSS 背景图',
      )
      continue
    }

    if (!evidence) {
      addSemanticItem(
        display,
        'display',
        `未找到展示内容：${term}`,
        source,
        'warning',
        '页面 DOM 文本、按钮、图片 alt 和背景区域均未命中',
      )
      continue
    }

    const positionMatched = position ? checkPosition(evidence.box, position, meta) : true
    addSemanticItem(
      display,
      'display',
      position ? `${term}位置检查` : `找到展示内容：${term}`,
      source,
      positionMatched ? 'passed' : 'manual',
      `${describeVisualEvidence(evidence)}${position && !positionMatched ? '，位置需人工确认' : ''}`,
    )
  }

  if (activeCopyResult?.total) {
    addSemanticItem(
      content,
      'content',
      'CMS 文案匹配',
      input.ocrText ? '页面 DOM 文本 + 图片 OCR' : '页面 DOM 文本',
      activeCopyResult.missing.length ? 'warning' : 'passed',
      `匹配 ${activeCopyResult.matched.length} 条，缺失 ${activeCopyResult.missing.length} 条，忽略需求描述 ${activeCopyResult.ignored.length} 条`,
    )

    activeCopyResult.missing.slice(0, 6).forEach((item) => {
      addSemanticItem(
        content,
        'content',
        `疑似缺失文案：${item.source}`,
        item.source,
        'warning',
        input.ocrText
          ? '页面 DOM 文本和图片 OCR 均未包含该文案'
          : '页面 DOM 文本未包含该文案；可运行图片 OCR 继续确认',
      )
    })
  } else {
    addSemanticItem(
      content,
      'content',
      '等待 CMS / 业务方文案',
      '文案对比',
      'manual',
      '粘贴 CMS 文案后，会用页面 DOM 文本做第一轮差异检查',
    )
  }

  addSemanticItem(
    content,
    'content',
    input.ocrResults.length ? '图片 OCR 已完成' : '图片 OCR 未运行',
    '设计稿 / 页面截图',
    input.ocrResults.length ? 'passed' : 'manual',
    input.ocrResults.length
      ? `${input.ocrResults
          .map((item) => `${item.label} ${item.text.length} 字 / 置信度 ${item.confidence.toFixed(1)}`)
          .join('；')}；人工修正 ${input.ocrResults.filter((item) => item.corrected).length} 项`
      : '遇到图片化文案时，可点击“图片 OCR”补充文本证据',
  )

  const actionTerms = extractFunctionTerms(input.sourceText)

  if (input.actionResults.length) {
    input.actionResults.forEach((item) => {
      addSemanticItem(
        functionChecks,
        'function',
        item.title,
        item.term,
        item.status,
        item.evidence,
      )
    })
  }

  if (actionTerms.length) {
    actionTerms.slice(0, 10).forEach((term) => {
      const source = findSourceLine(term, lines)
      const evidence = findInteractiveEvidence(term, meta)

      if (!evidence) {
        addSemanticItem(
          functionChecks,
          'function',
          `未找到功能入口：${term}`,
          source,
          'warning',
          pageTextHasTerm(term, meta)
            ? '页面有相关文案，但未识别到可点击元素'
            : '页面文本和可点击元素均未命中',
        )
        return
      }

      addSemanticItem(
        functionChecks,
        'function',
        `${term}入口已识别`,
        source,
        evidence.href ? 'passed' : 'manual',
        evidence.href
          ? `${describeElement(evidence)}，可见跳转：${evidence.href}`
          : `${describeElement(evidence)}，可能是 JS 点击或弹窗，需人工点测`,
      )
    })
  } else {
    addSemanticItem(
      functionChecks,
      'function',
      '等待需求 / UE 功能描述',
      '功能检查',
      'manual',
      `已采集 ${meta.interactiveElements.length} 个可点击元素，粘贴需求后可匹配入口`,
    )
  }

  addSemanticItem(
    functionChecks,
    'function',
    input.folderAssets.length ? '需求 / UE 资料已命中' : '需求 / UE 资料未搜索',
    '本地资料库',
    input.folderAssets.length ? 'passed' : 'manual',
    input.folderAssets.length
      ? `找到 ${input.folderAssets.length} 个候选资料`
      : '可以粘贴资料文件夹地址，先找相关 PRD、UE、设计截图',
  )

  return withSemanticSummary(display, content, functionChecks)
}

function addSemanticItem(
  items: SemanticReviewItem[],
  category: SemanticCategory,
  title: string,
  source: string,
  status: SemanticStatus,
  evidence: string,
) {
  items.push({
    id: `${category}-${items.length}-${title}`,
    category,
    title,
    source,
    status,
    evidence,
  })
}

function withSemanticSummary(
  display: SemanticReviewItem[],
  content: SemanticReviewItem[],
  functionChecks: SemanticReviewItem[],
): SemanticReviewResult {
  return {
    display,
    content,
    function: functionChecks,
    summary: {
      display: summarizeSemanticItems(display),
      content: summarizeSemanticItems(content),
      function: summarizeSemanticItems(functionChecks),
    },
  }
}

function summarizeSemanticItems(items: SemanticReviewItem[]): SemanticReviewSummary {
  return {
    total: items.length,
    passed: items.filter((item) => item.status === 'passed').length,
    warning: items.filter((item) => item.status === 'warning').length,
    manual: items.filter((item) => item.status === 'manual').length,
  }
}

function formatSemanticSummary(summary: SemanticReviewSummary) {
  return `通过 ${summary.passed} / 风险 ${summary.warning} / 待确认 ${summary.manual}`
}

function formatGoalStatus(summary: SemanticReviewSummary) {
  if (!summary.total) return '等待检查'
  if (summary.warning) return `${summary.warning} 个风险`
  if (summary.manual) return `${summary.passed}/${summary.total} 已过，${summary.manual} 待确认`

  return `${summary.passed}/${summary.total} 已通过`
}

function extractReviewLines(value: string) {
  return value
    .split(/\r?\n|[；;]/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function extractExpectationTerms(value: string) {
  const normalized = normalizeCopy(value)
  const quotedTerms = Array.from(value.matchAll(/[「『“"]([^」』”"]{2,24})[」』”"]/g)).map(
    (match) => match[1],
  )
  const suffixTerms = Array.from(
    value.matchAll(/([\u4e00-\u9fa5A-Za-z0-9]{2,12})(?:按钮|入口|链接|模块|弹窗)/g),
  ).map((match) => match[1].replace(/^(页面|点击|打开|跳转到|跳转至|中间要有|右上角要有)/, ''))
  const knownTerms = knownBusinessTerms.filter((term) => normalized.includes(normalizeCopy(term)))

  return Array.from(new Set([...knownTerms, ...quotedTerms, ...suffixTerms]))
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !isGenericTerm(term))
}

function extractFunctionTerms(value: string) {
  const lines = extractReviewLines(value)
  const actionLines = lines.filter((line) => functionIntentPattern.test(line))
  const source = actionLines.join('\n') || value

  return extractExpectationTerms(source).filter((term) => isActionTerm(term, findSourceLine(term, lines)))
}

function isActionTerm(term: string, source: string) {
  return /下载|预约|购票|领取|绑定|登录|分享|抽奖|报名|兑换|关闭|返回|查看|跳转|打开/.test(
    `${term}${source}`,
  )
}

function isGenericTerm(term: string) {
  return ['页面', '按钮', '入口', '链接', '模块', '弹窗', '中间要有', '右上角要有'].includes(term)
}

function findSourceLine(term: string, lines: string[]) {
  return lines.find((line) => line.includes(term)) || lines.find((line) => includesLoose(line, term)) || term
}

function findVisualEvidence(term: string, meta: CaptureMeta) {
  const element = meta.interactiveElements.find((item) =>
    matchesTerm(`${item.text} ${item.href} ${item.selector}`, term),
  )

  if (element) return { kind: 'element' as const, box: element.box, label: describeElement(element) }

  const image = meta.images.find((item) => matchesTerm(`${item.alt} ${item.src} ${item.selector}`, term))

  if (image) return { kind: 'image' as const, box: image.box, label: describeImage(image) }

  const background = meta.backgroundImages.find((item) =>
    matchesTerm(`${item.text} ${item.urls.join(' ')} ${item.selector}`, term),
  )

  if (background) return { kind: 'background' as const, box: background.box, label: describeBackground(background) }

  if (pageTextHasTerm(term, meta)) {
    return {
      kind: 'text' as const,
      box: { x: 0, y: 0, width: meta.viewportWidth, height: meta.viewportHeight },
      label: `页面 DOM 文本包含「${term}」`,
    }
  }

  return null
}

function findInteractiveEvidence(term: string, meta: CaptureMeta) {
  return meta.interactiveElements.find((item) =>
    matchesTerm(`${item.text} ${item.href} ${item.selector}`, term),
  )
}

function pageTextHasTerm(term: string, meta: CaptureMeta) {
  return matchesTerm(meta.textSample, term)
}

function matchesTerm(value: string, term: string) {
  return [term, ...termAliases(term)].some((candidate) => includesLoose(value, candidate))
}

function termAliases(term: string) {
  const aliases: Record<string, string[]> = {
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

function includesLoose(value: string, term: string) {
  const source = normalizeCopy(value)
  const target = normalizeCopy(term)

  if (!source || !target) return false
  if (source.includes(target)) return true

  let position = -1

  return Array.from(target).every((character) => {
    position = source.indexOf(character, position + 1)
    return position >= 0
  })
}

function getPositionExpectation(source: string) {
  if (/右上|顶部右侧/.test(source)) return 'top-right'
  if (/左上|顶部左侧/.test(source)) return 'top-left'
  if (/中间|居中|中心/.test(source)) return 'center'
  if (/底部|下方/.test(source)) return 'bottom'

  return ''
}

function checkPosition(box: DomBox, position: string, meta: CaptureMeta) {
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2

  if (position === 'top-right') {
    return centerX > meta.viewportWidth * 0.58 && box.y < meta.viewportHeight * 0.45
  }

  if (position === 'top-left') {
    return centerX < meta.viewportWidth * 0.42 && box.y < meta.viewportHeight * 0.45
  }

  if (position === 'center') {
    return centerX > meta.viewportWidth * 0.18 && centerX < meta.viewportWidth * 0.82 && centerY < meta.height * 0.72
  }

  if (position === 'bottom') {
    return centerY > meta.height * 0.65
  }

  return true
}

function describeVisualEvidence(evidence: { label: string; box: DomBox }) {
  return `${evidence.label} / ${formatBox(evidence.box)}`
}

function describeElement(element: PageElement) {
  return `${element.text || element.href || element.selector} / ${element.tag}${element.hasClickHandler ? ' / onclick' : ''}`
}

function describeImage(image: PageImage) {
  return `${image.alt || image.selector} / ${shortenUrl(image.src)}`
}

function describeBackground(background: PageBackground) {
  return `${background.text || background.selector} / ${shortenUrl(background.urls[0] || '')}`
}

function formatBox(box: DomBox) {
  return `x:${box.x} y:${box.y} ${box.width}x${box.height}`
}

function shortenUrl(value: string) {
  if (!value) return '无 URL'
  if (value.length <= 80) return value

  return `${value.slice(0, 45)}...${value.slice(-24)}`
}

async function createVisualDiff(designSrc: string, actualSrc: string) {
  const [designImage, actualImage] = await Promise.all([
    loadImage(designSrc),
    loadImage(actualSrc),
  ])
  const maxPixels = 2_400_000
  const scale = Math.min(
    1,
    Math.sqrt(maxPixels / (designImage.naturalWidth * designImage.naturalHeight)),
  )
  const width = Math.max(1, Math.round(designImage.naturalWidth * scale))
  const height = Math.max(1, Math.round(designImage.naturalHeight * scale))
  const designCanvas = drawScaledImage(designImage, width, height)
  const actualCanvas = drawScaledImage(actualImage, width, height)
  const outputCanvas = document.createElement('canvas')
  const outputContext = get2dContext(outputCanvas)

  outputCanvas.width = width
  outputCanvas.height = height

  const designData = get2dContext(designCanvas).getImageData(0, 0, width, height)
  const actualData = get2dContext(actualCanvas).getImageData(0, 0, width, height)
  const outputData = outputContext.createImageData(width, height)
  const threshold = 36
  let diffPixels = 0

  for (let index = 0; index < designData.data.length; index += 4) {
    const redDelta = Math.abs(designData.data[index] - actualData.data[index])
    const greenDelta = Math.abs(designData.data[index + 1] - actualData.data[index + 1])
    const blueDelta = Math.abs(designData.data[index + 2] - actualData.data[index + 2])
    const alphaDelta = Math.abs(designData.data[index + 3] - actualData.data[index + 3])
    const delta = (redDelta + greenDelta + blueDelta) / 3
    const different = delta > threshold || alphaDelta > 64

    if (different) {
      diffPixels += 1
      outputData.data[index] = 239
      outputData.data[index + 1] = 68
      outputData.data[index + 2] = 68
      outputData.data[index + 3] = 230
    } else {
      const grey =
        actualData.data[index] * 0.24 +
        actualData.data[index + 1] * 0.3 +
        actualData.data[index + 2] * 0.18 +
        42

      outputData.data[index] = grey
      outputData.data[index + 1] = grey
      outputData.data[index + 2] = grey
      outputData.data[index + 3] = 190
    }
  }

  outputContext.putImageData(outputData, 0, 0)

  const totalPixels = width * height

  return {
    image: outputCanvas.toDataURL('image/png'),
    stats: {
      width,
      height,
      diffPixels,
      totalPixels,
      ratio: diffPixels / totalPixels,
      threshold,
    },
  }
}

function compareCopy(cmsSource: string, pageText: string): CopyCheckResult {
  const pageNormalized = normalizeCopy(pageText)
  const rawLines = cmsSource
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const ignored: string[] = []
  const items = rawLines.flatMap((line) => {
    const normalized = normalizeCopy(line)

    if (normalized.length < 2 || shouldIgnoreCopyLine(line)) {
      ignored.push(line)
      return []
    }

    return [{ source: line, normalized }]
  })
  const matched: CopyCheckItem[] = []
  const missing: CopyCheckItem[] = []

  for (const item of items) {
    if (pageNormalized.includes(item.normalized)) {
      matched.push({ ...item, status: 'matched' })
    } else {
      missing.push({ ...item, status: 'missing' })
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    pageTextLength: pageText.length,
    total: items.length,
    matched,
    missing,
    ignored,
  }
}

function shouldIgnoreCopyLine(line: string) {
  return (
    /是否|要有|需要|需|应该|符合|一致|同一个|对比|验收|设计稿|UE|需求|点击后|点击.+(跳转|打开|弹窗)|右上|左上|中间|底部|背景|主视觉/.test(
      line,
    ) &&
    !copyIntentPattern.test(line)
  )
}

function normalizeCopy(value: string) {
  return value
    .replace(/[：:]\s*/g, '')
    .replace(/\s+/g, '')
    .replace(/[，。、“”‘’！!？?；;,.()[\]【】<>《》\-—_]/g, '')
    .toLowerCase()
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()

    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片读取失败，请重新上传截图'))
    image.src = src
  })
}

function drawScaledImage(image: HTMLImageElement, width: number, height: number) {
  const canvas = document.createElement('canvas')
  const context = get2dContext(canvas)

  canvas.width = width
  canvas.height = height
  context.drawImage(image, 0, 0, width, height)

  return canvas
}

function get2dContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) {
    throw new Error('当前浏览器不支持 Canvas diff')
  }

  return context
}

function ProjectAndTemplatePanel({
  projectName,
  projects,
  activeProjectId,
  templates,
  activeTemplateId,
  onProjectNameChange,
  onSaveProject,
  onLoadProject,
  onDeleteProject,
  onNewProject,
  onApplyTemplate,
}: {
  projectName: string
  projects: ReviewProject[]
  activeProjectId: string
  templates: ReviewTemplate[]
  activeTemplateId: string
  onProjectNameChange: (value: string) => void
  onSaveProject: () => void
  onLoadProject: (projectId: string) => void
  onDeleteProject: (projectId: string) => void
  onNewProject: () => void
  onApplyTemplate: (template: ReviewTemplate) => void
}) {
  return (
    <section className="rounded-md border border-border bg-background p-4 shadow-sm">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Archive className="size-4" />
            验收项目
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Input value={projectName} onChange={(event) => onProjectNameChange(event.target.value)} />
            <Button variant="outline" onClick={onNewProject}>
              <Plus />
              新建
            </Button>
            <Button onClick={onSaveProject}>
              <Save />
              保存
            </Button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
            <select
              value={activeProjectId}
              onChange={(event) => onLoadProject(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              <option value="">选择历史项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} / {formatHumanDate(new Date(project.updatedAt))}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              onClick={() => activeProjectId && onDeleteProject(activeProjectId)}
              disabled={!activeProjectId}
            >
              <Trash2 />
              删除
            </Button>
          </div>
          {projects.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              已保存 {projects.length} 个本地验收项目，历史记录保留轻量证据，避免大截图占满浏览器存储。
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">还没有历史项目，完成一次验收后点击保存。</p>
          )}
        </div>
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="size-4" />
            验收模板
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onApplyTemplate(template)}
                className="rounded-md border border-border bg-panel p-3 text-left transition-colors hover:bg-muted"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{template.title}</span>
                  <Badge variant={activeTemplateId === template.id ? 'success' : 'outline'}>{template.pageType}</Badge>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{template.description}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ReviewGoalCard({
  icon,
  title,
  desc,
  status,
}: {
  icon: ReactNode
  title: string
  desc: string
  status: string
}) {
  return (
    <article className="rounded-md border border-border bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold [&_svg]:size-4">
        {icon}
        {title}
      </div>
      <p className="min-h-10 text-sm text-muted-foreground">{desc}</p>
      <Badge variant="outline" className="mt-3">
        {status}
      </Badge>
    </article>
  )
}

function SemanticChecksPanel({
  result,
  decisions,
  onStatusChange,
  onNoteChange,
}: {
  result: SemanticReviewResult
  decisions: ReviewDecisionMap
  onStatusChange: (itemId: string, status: ReviewDecisionStatus) => void
  onNoteChange: (itemId: string, note: string) => void
}) {
  const groups: Array<{
    key: SemanticCategory
    title: string
    items: SemanticReviewItem[]
  }> = [
    { key: 'display', title: '展示检查', items: result.display },
    { key: 'content', title: '内容检查', items: result.content },
    { key: 'function', title: '功能检查', items: result.function },
  ]

  return (
    <section className="rounded-md border border-border bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="size-4" />
          三类自动检查
        </div>
        <Badge variant="outline">
          {result.summary.display.warning + result.summary.content.warning + result.summary.function.warning} 个风险
        </Badge>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {groups.map((group) => (
          <article key={group.key} className="rounded-md border border-border bg-panel p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{group.title}</h3>
              <Badge variant={result.summary[group.key].warning ? 'warning' : 'success'}>
                {formatSemanticSummary(result.summary[group.key])}
              </Badge>
            </div>
            <div className="space-y-2">
              {group.items.slice(0, 7).map((item) => (
                <SemanticCheckRow
                  key={item.id}
                  item={item}
                  decision={decisions[item.id]}
                  onStatusChange={onStatusChange}
                  onNoteChange={onNoteChange}
                />
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function SemanticCheckRow({
  item,
  decision,
  onStatusChange,
  onNoteChange,
}: {
  item: SemanticReviewItem
  decision?: ReviewDecision
  onStatusChange: (itemId: string, status: ReviewDecisionStatus) => void
  onNoteChange: (itemId: string, note: string) => void
}) {
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-5">{item.title}</p>
        <Badge variant={decisionStatusVariant(decision?.status || 'auto', item.status)}>
          {reviewDecisionLabel(decision?.status || 'auto', item.status)}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{item.source}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.evidence}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[0.75fr_1fr]">
        <select
          value={decision?.status || 'auto'}
          onChange={(event) => onStatusChange(item.id, event.target.value as ReviewDecisionStatus)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
        >
          <option value="auto">跟随机器判断</option>
          <option value="passed">人工通过</option>
          <option value="needs-change">需修改</option>
          <option value="pending">待确认</option>
          <option value="ignored">忽略</option>
        </select>
        <Input
          value={decision?.note || ''}
          onChange={(event) => onNoteChange(item.id, event.target.value)}
          placeholder="备注"
          className="h-8 text-xs"
        />
      </div>
    </div>
  )
}

function ReviewClosureSummary({
  semanticResult,
  decisionStats,
  copyResult,
  actionResults,
  folderAssets,
  ocrResults,
  hasDesign,
  hasActual,
  onGenerateConclusion,
}: {
  semanticResult: SemanticReviewResult
  decisionStats: ReturnType<typeof summarizeReviewDecisions>
  copyResult: CopyCheckResult | null
  actionResults: ActionCheckItem[]
  folderAssets: FolderAsset[]
  ocrResults: OcrItem[]
  hasDesign: boolean
  hasActual: boolean
  onGenerateConclusion: () => void
}) {
  const totalWarnings =
    semanticResult.summary.display.warning +
    semanticResult.summary.content.warning +
    semanticResult.summary.function.warning
  const actionRiskCount = actionResults.filter((item) => item.status !== 'passed').length
  const correctedOcrCount = ocrResults.filter((item) => item.corrected).length

  return (
    <div className="mb-3 rounded-md border border-border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">验收闭环</span>
        <Badge variant={totalWarnings ? 'warning' : 'success'}>{totalWarnings} 个风险</Badge>
      </div>
      <div className="space-y-1.5 text-xs text-muted-foreground">
        <ClosureRow label="展示证据" value={hasDesign && hasActual ? '设计稿和页面截图已就绪' : '证据不完整'} />
        <ClosureRow
          label="内容对比"
          value={copyResult ? `缺失 ${copyResult.missing.length} 条，匹配 ${copyResult.matched.length} 条` : '未运行'}
        />
        <ClosureRow
          label="OCR 修正"
          value={ocrResults.length ? `识别 ${ocrResults.length} 张，修正 ${correctedOcrCount} 项` : '未运行'}
        />
        <ClosureRow
          label="功能点测"
          value={actionResults.length ? `风险/待确认 ${actionRiskCount} 项` : '未运行'}
        />
        <ClosureRow label="资料候选" value={folderAssets.length ? `${folderAssets.length} 个` : '未搜索'} />
        <ClosureRow
          label="人工确认"
          value={`通过 ${decisionStats.passed}，需改 ${decisionStats.needsChange}，待确认 ${decisionStats.pending}`}
        />
      </div>
      <Button className="mt-3 w-full" variant="outline" onClick={onGenerateConclusion}>
        <ClipboardList />
        生成结论草稿
      </Button>
    </div>
  )
}

function ClosureRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

function SmartSummaryPanel({
  summary,
  onGenerate,
  onApplyToConclusion,
}: {
  summary: string
  onGenerate: () => void
  onApplyToConclusion: () => void
}) {
  return (
    <div className="mb-3 rounded-md border border-border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Sparkles className="size-3.5" />
          智能总结
        </div>
        <Badge variant={summary ? 'success' : 'outline'}>{summary ? '已生成' : '本地 v1'}</Badge>
      </div>
      {summary ? (
        <Textarea value={summary} readOnly className="mb-2 min-h-36 font-mono text-xs" />
      ) : (
        <p className="mb-2 rounded-md border border-border bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
          根据展示、CMS、OCR、功能点测和资料命中生成验收建议；当前版本不调用云端模型。
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" onClick={onGenerate}>
          <Sparkles />
          生成总结
        </Button>
        <Button variant="outline" onClick={onApplyToConclusion} disabled={!summary.trim()}>
          <FileText />
          写入结论
        </Button>
      </div>
    </div>
  )
}

function semanticStatusLabel(status: SemanticStatus) {
  if (status === 'passed') return '通过'
  if (status === 'warning') return '风险'

  return '待确认'
}

function reviewDecisionLabel(status: ReviewDecisionStatus, autoStatus: SemanticStatus) {
  if (status === 'auto') return `机器：${semanticStatusLabel(autoStatus)}`
  if (status === 'passed') return '人工通过'
  if (status === 'needs-change') return '需修改'
  if (status === 'ignored') return '已忽略'

  return '待确认'
}

function decisionStatusVariant(status: ReviewDecisionStatus, autoStatus: SemanticStatus) {
  if (status === 'passed') return 'success'
  if (status === 'needs-change') return 'danger'
  if (status === 'pending') return 'warning'
  if (status === 'ignored') return 'outline'

  return semanticStatusVariant(autoStatus)
}

function semanticStatusVariant(status: SemanticStatus) {
  if (status === 'passed') return 'success'
  if (status === 'warning') return 'warning'

  return 'outline'
}

function EvidencePanel({
  designPreview,
  actualPreview,
  diffPreview,
  diffStats,
  pageType,
  onPageTypeChange,
  url,
  onUrlChange,
  onDesignUpload,
  onActualUpload,
}: {
  designPreview: string
  actualPreview: string
  diffPreview: string
  diffStats: DiffStats | null
  pageType: PageType
  onPageTypeChange: (value: PageType) => void
  url: string
  onUrlChange: (value: string) => void
  onDesignUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onActualUpload: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <section className="rounded-md border border-border bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <FileImage className="size-4" />
        展示证据
      </div>
      <div className="grid gap-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">页面 URL</span>
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input value={url} onChange={(event) => onUrlChange(event.target.value)} className="pl-9" />
          </div>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">页面类型</span>
          <select
            value={pageType}
            onChange={(event) => onPageTypeChange(event.target.value as PageType)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          >
            {pageTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <UploadThumb title="设计稿" image={designPreview} onChange={onDesignUpload} />
          <UploadThumb title="页面截图" image={actualPreview} onChange={onActualUpload} />
        </div>
        <div className="rounded-md border border-border bg-panel p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">视觉参考</span>
            <Badge variant={diffStats ? 'warning' : 'outline'}>
              {diffStats ? `${(diffStats.ratio * 100).toFixed(2)}%` : '未生成'}
            </Badge>
          </div>
          {diffPreview ? (
            <img src={diffPreview} alt="视觉参考图" className="max-h-64 w-full object-contain" />
          ) : (
            <p className="text-sm text-muted-foreground">
              只辅助判断关键模块、入口、背景是否明显不一致，不做像素级验收结论。
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function UploadThumb({
  title,
  image,
  onChange,
}: {
  title: string
  image: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border bg-panel p-3 text-center">
      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={onChange} />
      {image ? (
        <img src={image} alt={title} className="max-h-44 w-full object-contain" />
      ) : (
        <>
          <Upload className="mb-2 size-5 text-muted-foreground" />
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">上传截图</span>
        </>
      )}
    </label>
  )
}

function ContentAndFolderPanel({
  cmsText,
  onCmsTextChange,
  copyResult,
  ocrResults,
  onOcrTextChange,
  onOcrReset,
  onApplyOcrToCopy,
  actionResults,
  folderPath,
  folderQuery,
  folderAssets,
  assetPreview,
  isSearchingFolder,
  isPreviewingAsset,
  onFolderPathChange,
  onFolderQueryChange,
  onSearchFolder,
  onAppendAsset,
  onPreviewAsset,
  onUsePreviewAsDesign,
}: {
  cmsText: string
  onCmsTextChange: (value: string) => void
  copyResult: CopyCheckResult | null
  ocrResults: OcrItem[]
  onOcrTextChange: (itemId: string, text: string) => void
  onOcrReset: (itemId: string) => void
  onApplyOcrToCopy: () => void
  actionResults: ActionCheckItem[]
  folderPath: string
  folderQuery: string
  folderAssets: FolderAsset[]
  assetPreview: FolderAssetPreview | null
  isSearchingFolder: boolean
  isPreviewingAsset: boolean
  onFolderPathChange: (value: string) => void
  onFolderQueryChange: (value: string) => void
  onSearchFolder: () => void
  onAppendAsset: (asset: FolderAsset) => void
  onPreviewAsset: (asset: FolderAsset) => void
  onUsePreviewAsDesign: () => void
}) {
  return (
    <section className="rounded-md border border-border bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <FolderOpen className="size-4" />
        内容与资料
      </div>
      <div className="space-y-3">
        <Textarea
          value={cmsText}
          onChange={(event) => onCmsTextChange(event.target.value)}
          placeholder="粘贴 CMS 文案、业务方文案、需求或 UE 描述"
          className="min-h-32 font-mono text-xs"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <MiniMetric label="CMS 匹配" value={copyResult ? `${copyResult.matched.length}` : '-'} />
          <MiniMetric label="CMS 缺失" value={copyResult ? `${copyResult.missing.length}` : '-'} />
          <MiniMetric label="候选资料" value={`${folderAssets.length}`} />
        </div>
        {ocrResults.length ? (
          <OcrCorrectionPanel
            results={ocrResults}
            canApply={Boolean(cmsText.trim())}
            onTextChange={onOcrTextChange}
            onReset={onOcrReset}
            onApplyToCopy={onApplyOcrToCopy}
          />
        ) : null}
        {actionResults.length ? (
          <ActionResultsPanel results={actionResults} />
        ) : null}
        {copyResult?.missing.length ? (
          <ResultList title="疑似缺失文案" items={copyResult.missing.map((item) => item.source)} />
        ) : null}
        <div className="grid gap-2 sm:grid-cols-[1fr_0.8fr_auto]">
          <Input value={folderPath} onChange={(event) => onFolderPathChange(event.target.value)} />
          <Input value={folderQuery} onChange={(event) => onFolderQueryChange(event.target.value)} />
          <Button variant="outline" onClick={onSearchFolder} disabled={isSearchingFolder || !folderPath}>
            {isSearchingFolder ? <Loader2 className="animate-spin" /> : <Search />}
            搜索
          </Button>
        </div>
        <div className="max-h-56 space-y-2 overflow-auto pr-1">
          {folderAssets.slice(0, 12).map((asset) => (
            <article key={asset.path} className="rounded-md border border-border bg-panel p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{asset.name}</p>
                <Badge variant="outline">{asset.type}</Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">{asset.relativePath}</p>
              {asset.snippet ? <p className="mt-1 text-xs text-muted-foreground">{asset.snippet}</p> : null}
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => onPreviewAsset(asset)} disabled={isPreviewingAsset}>
                  {isPreviewingAsset ? <Loader2 className="animate-spin" /> : <Eye />}
                  预览
                </Button>
                <Button size="sm" variant="outline" onClick={() => onAppendAsset(asset)}>
                  <FileText />
                  纳入输入
                </Button>
              </div>
            </article>
          ))}
        </div>
        {assetPreview ? (
          <AssetPreviewPanel preview={assetPreview} onAppendAssetText={onCmsTextChange} cmsText={cmsText} onUseAsDesign={onUsePreviewAsDesign} />
        ) : null}
      </div>
    </section>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-panel p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  )
}

function AssetPreviewPanel({
  preview,
  cmsText,
  onAppendAssetText,
  onUseAsDesign,
}: {
  preview: FolderAssetPreview
  cmsText: string
  onAppendAssetText: (value: string) => void
  onUseAsDesign: () => void
}) {
  const previewText = preview.content?.trim() || ''

  return (
    <div className="rounded-md border border-border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{preview.name || '资料预览'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{preview.path}</p>
        </div>
        <Badge variant="outline">{preview.type || preview.ext || 'file'}</Badge>
      </div>
      {preview.dataUrl ? (
        <div className="space-y-2">
          <img src={preview.dataUrl} alt={preview.name || '资料图片'} className="max-h-64 w-full rounded-md object-contain" />
          <Button variant="outline" className="w-full" onClick={onUseAsDesign}>
            <FileImage />
            设为设计稿
          </Button>
        </div>
      ) : null}
      {previewText ? (
        <div className="space-y-2">
          <Textarea value={previewText} readOnly className="max-h-64 min-h-32 font-mono text-xs" />
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              onAppendAssetText(
                [cmsText.trim(), `资料预览：${preview.name || '未命名资料'}`, previewText].filter(Boolean).join('\n'),
              )
            }
          >
            <FileText />
            追加到验收输入
          </Button>
        </div>
      ) : null}
      {!preview.dataUrl && !previewText ? (
        <p className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
          {preview.message || '该资料暂不支持直接预览，可先根据文件名和搜索摘录判断是否相关。'}
        </p>
      ) : null}
    </div>
  )
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border bg-panel p-3">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="space-y-1">
        {items.slice(0, 8).map((item) => (
          <p key={item} className="rounded-sm bg-background px-2 py-1 text-xs">
            {item}
          </p>
        ))}
      </div>
    </div>
  )
}

function OcrCorrectionPanel({
  results,
  canApply,
  onTextChange,
  onReset,
  onApplyToCopy,
}: {
  results: OcrItem[]
  canApply: boolean
  onTextChange: (itemId: string, text: string) => void
  onReset: (itemId: string) => void
  onApplyToCopy: () => void
}) {
  const correctedCount = results.filter((item) => item.corrected).length

  return (
    <div className="rounded-md border border-border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-muted-foreground">图片 OCR 文案</div>
        <Badge variant={correctedCount ? 'warning' : 'outline'}>
          {correctedCount ? `已修正 ${correctedCount}` : '可修正'}
        </Badge>
      </div>
      <div className="max-h-80 space-y-3 overflow-auto pr-1">
        {results.map((item) => (
          <article key={item.id} className="rounded-md border border-border bg-background p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">置信度 {item.confidence.toFixed(1)}</p>
              </div>
              {item.corrected ? <Badge variant="warning">人工修正</Badge> : null}
            </div>
            <Textarea
              value={item.text}
              onChange={(event) => onTextChange(item.id, event.target.value)}
              className="min-h-24 font-mono text-xs"
            />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onReset(item.id)}
                disabled={!item.corrected || item.originalText === undefined}
              >
                <RotateCcw />
                恢复原文
              </Button>
            </div>
          </article>
        ))}
      </div>
      <Button className="mt-3 w-full" variant="outline" onClick={onApplyToCopy} disabled={!canApply}>
        <FileText />
        用修正文案重新对比
      </Button>
    </div>
  )
}

function ActionResultsPanel({ results }: { results: ActionCheckItem[] }) {
  return (
    <div className="rounded-md border border-border bg-panel p-3">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">功能点测结果</div>
      <div className="max-h-96 space-y-2 overflow-auto pr-1">
        {results.map((item) => (
          <article key={`${item.term}-${item.title}`} className="rounded-md border border-border bg-background p-2">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.term}</p>
              </div>
              <Badge variant={semanticStatusVariant(item.status)}>{semanticStatusLabel(item.status)}</Badge>
            </div>
            <div className="grid gap-2 text-xs text-muted-foreground">
              <p>点击前：{item.beforeUrl || '未记录'}</p>
              <p>点击后：{item.afterUrl || '未记录'}</p>
              <p>
                变化：URL {item.urlChanged ? '是' : '否'} / 文本 {item.textChanged ? '是' : '否'} / 新窗口 {item.popupOpened ? '是' : '否'}
              </p>
              {item.failureReason ? (
                <p className="rounded-sm bg-amber-50 px-2 py-1 text-amber-800">失败原因：{item.failureReason}</p>
              ) : null}
              {item.dialogs?.length ? <p>弹窗：{item.dialogs.map((dialog) => dialog.message).join(' / ')}</p> : null}
              <p>{item.evidence}</p>
            </div>
            {item.beforeImage || item.afterImage ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {item.beforeImage ? (
                  <figure className="rounded-md border border-border bg-panel p-1">
                    <img src={item.beforeImage} alt={`${item.term} 点测前`} className="max-h-40 w-full object-contain" />
                    <figcaption className="mt-1 text-center text-[11px] text-muted-foreground">点测前</figcaption>
                  </figure>
                ) : null}
                {item.afterImage ? (
                  <figure className="rounded-md border border-border bg-panel p-1">
                    <img src={item.afterImage} alt={`${item.term} 点测后`} className="max-h-40 w-full object-contain" />
                    <figcaption className="mt-1 text-center text-[11px] text-muted-foreground">点测后</figcaption>
                  </figure>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  )
}

function IssueRow({ issue }: { issue: ReviewIssue }) {
  const severityVariant =
    issue.severity === '高' ? 'danger' : issue.severity === '中' ? 'warning' : 'outline'

  return (
    <article className="rounded-md border border-border bg-panel p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{issue.type}</Badge>
            <Badge variant={severityVariant}>{issue.severity}</Badge>
          </div>
          <h3 className="mt-2 text-sm font-semibold">{issue.title}</h3>
        </div>
        <Badge variant="outline">{issue.status}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{issue.location}</p>
    </article>
  )
}

function InlineErrors({ errors }: { errors: string[] }) {
  const activeErrors = errors.filter(Boolean)

  if (!activeErrors.length) return null

  return (
    <div className="mt-3 space-y-2">
      {activeErrors.map((error) => (
        <p key={error} className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ))}
    </div>
  )
}

export default App
