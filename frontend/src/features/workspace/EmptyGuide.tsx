/**
 * 新工作区空态引导卡片（03 §7.1，M4 任务五）：
 * 工作区尚无导图与会话时居中展示「新建第一张导图 / 开始第一次会话」两个入口，
 * 附 30 秒快速上手提示（建导图 → 开会话 → 搜索复盘），让新用户 5 分钟内走通闭环（07 §7）。
 * 纯展示组件：入口行为由父组件注入（聚焦对应创建输入框）。
 */
import './empty-guide.css'

export function EmptyGuide({
  workspaceName,
  onNewMindmap,
  onNewSession,
}: {
  workspaceName: string
  onNewMindmap: () => void
  onNewSession: () => void
}) {
  return (
    <div className="empty-guide" data-testid="empty-guide" role="region" aria-label={`${workspaceName} 新工作区引导`}>
      <div className="empty-guide-card">
        <h2 className="empty-guide-title">开始使用「{workspaceName}」</h2>
        <p className="empty-guide-sub">
          先画一张导图理清思路，再开始一次会话记录过程。这里还没有任何内容，从下面任选一个入口开始：
        </p>
        <div className="empty-guide-actions">
          <button className="empty-guide-btn primary" onClick={onNewMindmap}>
            🗺 新建第一张导图
          </button>
          <button className="empty-guide-btn" onClick={onNewSession}>
            ⏱ 开始第一次会话
          </button>
        </div>
        <div className="empty-guide-steps">
          <p className="empty-guide-steps-title">30 秒快速上手</p>
          <ol>
            <li>
              新建导图后，双击空白处或选中节点按 <kbd>Ctrl+N</kbd> 添加节点，回车确认、Esc 取消
            </li>
            <li>
              开始会话后，用底部快速记录框写条目：选类型（默认 action）→ 输入 → <kbd>Enter</kbd>{' '}
              提交，切换画布用 <kbd>Ctrl+1</kbd> / <kbd>Ctrl+2</kbd>
            </li>
            <li>
              随时按 <kbd>Ctrl+K</kbd> 全局搜索，会话结束前导出 Markdown / JSON 留档复盘
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}
