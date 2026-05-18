interface Props {
  title: string
}

const s = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '400px',
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '16px',
    padding: '48px 24px',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '14px',
  } as React.CSSProperties,

  title: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: '8px',
  } as React.CSSProperties,
}

export function PlaceholderPage({ title }: Props) {
  return (
    <div style={s.wrapper}>
      <p style={s.title}>{title}</p>
      <p>功能开发中...</p>
    </div>
  )
}
