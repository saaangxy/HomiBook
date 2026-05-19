import { Card, CardBody } from '@heroui/react'
import { Book, Users, Wallet, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import { useBookStore } from '../stores/book'

export function HomePage() {
  const { currentBookId, books } = useBookStore()
  const currentBook = books.find((b) => b.id === currentBookId)

  return (
    <div>
      {currentBook ? (
        <div className="flex items-center gap-2.5 mb-5 px-5 py-3 bg-[#1e293b] border border-[#334155] rounded-xl">
          <Book size={18} className="text-[#f97316]" />
          <span className="text-sm text-[#94a3b8]">当前账本：</span>
          <span className="text-sm font-semibold text-[#f97316]">{currentBook.name}</span>
        </div>
      ) : (
        <div className="mb-5 p-5 bg-[#1e293b] border border-[#334155] rounded-xl text-center text-sm text-[#64748b]">
          请选择或创建账本开始记账
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
        <Card className="bg-[#1e293b] border border-[#334155] rounded-2xl">
          <CardBody className="flex flex-row items-start gap-4 p-6">
            <div className="w-12 h-12 rounded-2xl bg-[#3b82f6]/10 text-[#3b82f6] flex items-center justify-center shrink-0">
              <Wallet size={22} />
            </div>
            <div>
              <div className="text-[28px] font-bold text-[#e2e8f0] leading-tight">0</div>
              <div className="text-[13px] text-[#64748b] mt-1">总账户数</div>
            </div>
          </CardBody>
        </Card>

        <Card className="bg-[#1e293b] border border-[#334155] rounded-2xl">
          <CardBody className="flex flex-row items-start gap-4 p-6">
            <div className="w-12 h-12 rounded-2xl bg-[#f97316]/10 text-[#f97316] flex items-center justify-center shrink-0">
              <ArrowUpCircle size={22} />
            </div>
            <div>
              <div className="text-[28px] font-bold text-[#e2e8f0] leading-tight">¥0</div>
              <div className="text-[13px] text-[#64748b] mt-1">本月收入</div>
            </div>
          </CardBody>
        </Card>

        <Card className="bg-[#1e293b] border border-[#334155] rounded-2xl">
          <CardBody className="flex flex-row items-start gap-4 p-6">
            <div className="w-12 h-12 rounded-2xl bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center shrink-0">
              <ArrowDownCircle size={22} />
            </div>
            <div>
              <div className="text-[28px] font-bold text-[#e2e8f0] leading-tight">¥0</div>
              <div className="text-[13px] text-[#64748b] mt-1">本月支出</div>
            </div>
          </CardBody>
        </Card>

        <Card className="bg-[#1e293b] border border-[#334155] rounded-2xl">
          <CardBody className="flex flex-row items-start gap-4 p-6">
            <div className="w-12 h-12 rounded-2xl bg-[#8b5cf6]/10 text-[#8b5cf6] flex items-center justify-center shrink-0">
              <Users size={22} />
            </div>
            <div>
              <div className="text-[28px] font-bold text-[#e2e8f0] leading-tight">1</div>
              <div className="text-[13px] text-[#64748b] mt-1">家庭成员</div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* 我的账本 */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-[#e2e8f0] mb-4">我的账本</h2>
        <Card className="bg-[#1e293b] border border-[#334155] rounded-2xl">
          <CardBody className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Book size={40} className="opacity-30" />
            <span className="text-sm text-[#64748b]">还没有账本，点击上方按钮创建第一个</span>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
