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
            <TableHead className="text-xs w-16">状态</TableHead>
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
              <TableCell className="py-1.5">
                <Badge variant={p.status === 'GENERATED' ? 'default' : 'secondary'} className="text-[10px]">
                  {p.status === 'GENERATED' ? '已生成' : '待生成'}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
