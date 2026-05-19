import { Card, CardContent } from '@/components/ui/card'

interface Props {
  title: string
}

export function PlaceholderPage({ title }: Props) {
  return (
    <Card className="bg-card border-border rounded-2xl">
      <CardContent className="flex flex-col items-center justify-center min-h-[400px] gap-2 text-center py-12">
        <p className="text-xl font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">功能开发中...</p>
      </CardContent>
    </Card>
  )
}
