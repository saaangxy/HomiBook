/**
 * 一次性数据修复：清理「同一条 assistant 消息被写了两行」的重复行。
 *
 * 背景：saveMessageSnapshot 在并发工具调用下会各 create 一行（已修，见 routes/chat.ts 的串行化队列）。
 * 存量重复行的特征非常明确：**同一 session + 同一 parentMessageId + createdAt 精确相同（同毫秒）**。
 * 这种重复行会被前端 buildActivePath 当成"最后一个子节点"而顶掉真正的分支（消息消失 / 确认状态回滚），
 * 也会让 buildChatMessages 重放两份相同 tool_call 的消息而被上游以 duplicate tool_call_id 拒绝。
 *
 * 处理策略：每组重复行保留「有子节点的那一条」（真正的分支），若都没有子节点则保留最早的那条，其余删除。
 *
 * 用法：
 *   node scripts/fix-duplicate-snapshots.cjs            # 只报告（默认 dry-run）
 *   node scripts/fix-duplicate-snapshots.cjs --apply     # 真正删除
 */
const { DatabaseSync } = require('node:sqlite')
const path = require('path')

const apply = process.argv.includes('--apply')
const dbPath = process.env.HOMIBOOK_DB || path.join(__dirname, '..', 'prisma', 'dev.db')
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = ON')

const duplicates = db
  .prepare(
    `SELECT a.id, a.sessionId, a.parentMessageId, a.createdAt, length(a.toolCalls) AS tcLen
       FROM ChatMessage a
      WHERE a.role = 'assistant' AND a.parentMessageId IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM ChatMessage b
           WHERE b.sessionId = a.sessionId AND b.role = 'assistant'
             AND b.parentMessageId = a.parentMessageId AND b.createdAt = a.createdAt AND b.id <> a.id
        )
      ORDER BY a.createdAt ASC, a.id ASC`,
  )
  .all()

const childCount = (id) => db.prepare('SELECT COUNT(*) AS n FROM ChatMessage WHERE parentMessageId = ?').get(id).n
const groups = new Map()
for (const row of duplicates) {
  const key = `${row.sessionId}|${row.parentMessageId}|${row.createdAt}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(row)
}

console.log(`DB: ${dbPath}`)
console.log(`发现 ${duplicates.length} 行疑似重复，分布在 ${groups.size} 组\n`)

const toDelete = []
for (const [key, rows] of groups) {
  // 保留优先级：有子节点（真正的分支） > toolCalls 更完整（快照更晚） > 更早创建
  const withChildren = rows.filter((r) => childCount(r.id) > 0)
  const keep = withChildren.length > 0
    ? withChildren[0]
    : [...rows].sort((a, b) => (b.tcLen || 0) - (a.tcLen || 0))[0]
  const drop = rows.filter((r) => r.id !== keep.id)
  const sid = key.split('|')[0]
  console.log(`session ${sid.slice(0, 8)} @ ${key.split('|')[2]}`)
  for (const r of rows) {
    const n = childCount(r.id)
    const mark = r.id === keep.id ? '保留' : '删除'
    console.log(`   [${mark}] ${r.id.slice(0, 8)}  子节点=${n}  toolCalls长度=${r.tcLen}`)
  }
  toDelete.push(...drop.map((d) => d.id))
}

if (toDelete.length === 0) {
  console.log('\n没有需要清理的重复行。')
} else if (!apply) {
  console.log(`\n[dry-run] 将删除 ${toDelete.length} 行；确认无误后加 --apply 执行。`)
} else {
  const stmt = db.prepare('DELETE FROM ChatMessage WHERE id = ?')
  for (const id of toDelete) stmt.run(id)
  console.log(`\n已删除 ${toDelete.length} 行重复消息。`)
}
db.close()
