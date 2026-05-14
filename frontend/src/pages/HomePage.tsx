import { Card, CardBody, CardHeader, Button } from '@heroui/react'
import { Plus } from 'lucide-react'

export function HomePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Account Books</h1>
        <Button color="primary" startContent={<Plus className="w-4 h-4" />}>
          New Account Book
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Family Expenses</h2>
          </CardHeader>
          <CardBody>
            <p className="text-gray-500">3 members · 5 accounts</p>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}