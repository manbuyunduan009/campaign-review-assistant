export type PageType = '网页移动端' | '小程序' | '游戏内嵌页' | '网吧内嵌页'

export type ReviewStatus = '未确认' | '可接受' | '需修改' | '待确认'

export interface ReviewIssue {
  id: number
  type: '文案' | '视觉' | '模块' | '交互'
  title: string
  location: string
  severity: '高' | '中' | '低'
  status: ReviewStatus
}
