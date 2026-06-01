import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { RepaymentPlan } from '@/api/recurring'

interface Props {
  plans: RepaymentPlan[]
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount)
}

export function RepaymentPlanTable({ plans }: Props) {
  if (plans.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">暂无还款计划</p>
  }

  return (
    <div className="max-h-[400px] overflow-y-auto border border-border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-12">期数</TableHead>
            <TableHead className="text-xs">日期</TableHead>
            <TableHead className="text-xs text-right">月还款额</TableHead>
            <TableHead className="text-xs text-right">本金</TableHead>
            <TableHead className="text-xs text-right">利息</TableHead>
            <TableHead className="text-xs text-right">剩余本金</TableHead>
            <TableHead className="text-xs w-20">状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.map((p) => (
            <TableRow key={p.id || p.period}>
              <TableCell className="text-xs py-1.5">{p.period}</TableCell>
              <TableCell className="text-xs py-1.5">
                {new Date(p.dueDate).toLocaleDateString('zh-CN')}
              </TableCell>
              <TableCell className="text-xs py-1.5 text-right">{formatMoney(p.totalPayment)}</TableCell>
              <TableCell className="text-xs py-1.5 text-right">{formatMoney(p.principal)}</TableCell>
              <TableCell className="text-xs py-1.5 text-right">{formatMoney(p.interest)}</TableCell>
              <TableCell className="text-xs py-1.5 text-right">{formatMoney(p.remainingPrincipal)}</TableCell>
              <TableCell className="py-1.5 whitespace-nowrap">
                {(() => {
                  const isPastDue = new Date(p.dueDate) <= new Date()
                  if (p.status === 'GENERATED') {
                    return <Badge className="text-[10px] bg-[#22c55e]/10 text-[#22c55e] whitespace-nowrap">已生成</Badge>
                  }
                  if (isPastDue) {
                    return <Badge className="text-[10px] bg-[#f97316]/10 text-[#f97316] whitespace-nowrap">已到期</Badge>
                  }
                  return <Badge variant="secondary" className="text-[10px] whitespace-nowrap">待还款</Badge>
                })()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
