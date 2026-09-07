/** 分类领域类型(权威) */
import type { RecordType } from './record.js';

export interface Category {
  code: string;
  label: string;
  type: RecordType;
  /** emoji 图标 */
  icon: string;
}
