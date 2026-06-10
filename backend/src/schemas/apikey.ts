import { z } from 'zod'

export const createApiKeySchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100, '名称最多100字符'),
})
