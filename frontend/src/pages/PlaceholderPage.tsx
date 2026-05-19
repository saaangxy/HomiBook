import { Card, CardBody } from '@heroui/react'

interface Props {
  title: string
}

export function PlaceholderPage({ title }: Props) {
  return (
    <Card className="bg-[#1e293b] border border-[#334155] rounded-2xl">
      <CardBody className="flex flex-col items-center justify-center min-h-[400px] gap-2 text-center py-12">
        <p className="text-xl font-semibold text-[#e2e8f0]">{title}</p>
        <p className="text-sm text-[#64748b]">功能开发中...</p>
      </CardBody>
    </Card>
  )
}
