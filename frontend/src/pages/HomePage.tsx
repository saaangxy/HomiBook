import { Book, Users, Wallet, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import { useBookStore } from '../stores/book'

const s = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '20px',
  } as React.CSSProperties,

  statCard: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '16px',
    padding: '24px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
  } as React.CSSProperties,

  statIcon: (color: string) => ({
    width: '48px',
    height: '48px',
    borderRadius: '14px',
    backgroundColor: `${color}15`,
    color,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties),

  statValue: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#e2e8f0',
    lineHeight: 1.2,
  } as React.CSSProperties,

  statLabel: {
    fontSize: '13px',
    color: '#64748b',
    marginTop: '4px',
  } as React.CSSProperties,

  section: {
    marginTop: '32px',
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: '16px',
  } as React.CSSProperties,

  emptyCard: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '16px',
    padding: '48px 24px',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '14px',
  } as React.CSSProperties,
}

export function HomePage() {
  const { currentBookId, books } = useBookStore()
  const currentBook = books.find((b) => b.id === currentBookId)

  return (
    <div>
      {currentBook && (
        <div
          style={{
            marginBottom: 20,
            padding: '12px 20px',
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Book size={18} style={{ color: '#f97316' }} />
          <span style={{ color: '#94a3b8', fontSize: 14 }}>当前账本：</span>
          <span style={{ color: '#f97316', fontSize: 14, fontWeight: 600 }}>{currentBook.name}</span>
        </div>
      )}
      {!currentBook && (
        <div
          style={{
            marginBottom: 20,
            padding: '20px',
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 12,
            textAlign: 'center',
            color: '#64748b',
            fontSize: 14,
          }}
        >
          请选择或创建账本开始记账
        </div>
      )}

      {/* 统计卡片 */}
      <div style={s.grid}>
        <div style={s.statCard}>
          <div style={s.statIcon('#3b82f6')}>
            <Wallet size={22} />
          </div>
          <div>
            <div style={s.statValue}>0</div>
            <div style={s.statLabel}>总账户数</div>
          </div>
        </div>

        <div style={s.statCard}>
          <div style={s.statIcon('#f97316')}>
            <ArrowUpCircle size={22} />
          </div>
          <div>
            <div style={s.statValue}>¥0</div>
            <div style={s.statLabel}>本月收入</div>
          </div>
        </div>

        <div style={s.statCard}>
          <div style={s.statIcon('#ef4444')}>
            <ArrowDownCircle size={22} />
          </div>
          <div>
            <div style={s.statValue}>¥0</div>
            <div style={s.statLabel}>本月支出</div>
          </div>
        </div>

        <div style={s.statCard}>
          <div style={s.statIcon('#8b5cf6')}>
            <Users size={22} />
          </div>
          <div>
            <div style={s.statValue}>1</div>
            <div style={s.statLabel}>家庭成员</div>
          </div>
        </div>
      </div>

      {/* 最近账本 */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>我的账本</h2>
        <div style={s.emptyCard}>
          <Book size={40} style={{ marginBottom: '12px', opacity: 0.3 }} />
          <div>还没有账本，点击上方按钮创建第一个</div>
        </div>
      </div>
    </div>
  )
}
