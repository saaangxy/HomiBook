import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronLeft, MessageSquareText, RefreshCw, ShieldAlert, SlidersHorizontal, TriangleAlert } from 'lucide-react-native';
import { DEFAULT_SMS_FILTER_RULES, type SmsFilterRules } from '@homibook/core';
import { useTheme, alpha, haptics, semanticTypeColor } from '@/theme';
import { Text } from '@/components/ui/Text';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { showToast } from '@/components/chrome/Toast';
import { FormSheet } from '@/components/chrome/FormSheet';
import { Btn, LabeledInput, useInputStyle } from '@/components/settings/shared';
import { SenderPickerSheet } from '@/components/sms/SenderPickerSheet';
import { CandidateDetailSheet } from '@/components/sms/CandidateDetailSheet';
import { useUIShell } from '@/components/chrome/chrome';
import { ImportSheet } from '@/components/import/ImportSheet';
import {
  hasSmsPermission, isNotificationAccessGranted, isTxnReaderSupported, openSmsPermissionSettings,
  removePendingNotifications,
} from '@/services/txn-reader';
import {
  needsConfirm, SMS_FETCH_MAX, SMS_SCAN_DAYS_DEFAULT, scanCandidates, smsPreview, type SmsCandidate,
} from '@/services/sms-import';
import { isSmsFilterRulesCustomized, loadSmsFilterRules, saveSmsFilterRules } from '@/services/sms-rules';
import { extractCandidatesWithAi, loadSmsAiSettings } from '@/services/sms-ai';
import { clearSmsSenders, loadSmsSenders, mergeSmsSenders, type SmsSenderEntry } from '@/services/sms-senders';
import { loadProcessedSmsIds, markSmsProcessed } from '@/services/sms-processed';
import type { ImportPreviewResult, ParsedImportRow } from '@/services/import';

// 短信记账 · 扫描与筛选(仅 Android)。
// 流程:本机按「用户筛选规则」采集短信 + 通知(去重第1层:跳过已处理)→ 规则读不懂的长尾内容
//      (开关开启时)→ AI 兜底抽取 → 服务端预览(账户匹配 + 分类映射 + 去重第3层弱校验)
//      → 候选勾选(疑似重复默认不勾选)→ ImportSheet 复用「预览处理 / 确认 / 结果」全流程。
// 隐私:AI 开关默认关闭;关闭时原文一条都不出设备,只上送结构化字段。
// 本页无任何输入框 → 不涉及键盘遮挡;有输入框的是 ImportSheet(FormSheet 自带键盘避让)。
// 本页自行处理顶部安全域与底部操作条安全域(独立 Stack 页,无 GlobalBar)。

const DAY_OPTIONS = [7, 30, 90];
/** 自定义扫描区间上限(天):本机单次最多读取 2000 条短信,再大也没有额外收益 */
const MAX_SCAN_DAYS = 3650;
const FILTERS: { key: 'all' | 'EXPENSE' | 'INCOME' | 'low'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'EXPENSE', label: '支出' },
  { key: 'INCOME', label: '收入' },
  { key: 'low', label: '需确认' },
];

/** 本机候选 + 行号(与服务端 ParsedRow.rowIndex 一致:提交顺序的位置 + 1) */
type LocalCandidate = SmsCandidate & { rowIndex: number; parsedBy?: 'ai' };
/** 合并 AI 结果时的中间形态:此时还没排序、没编 rowIndex */
type MergedCandidate = Omit<LocalCandidate, 'rowIndex'>;

/** 文本 → 列表:支持空格 / 半角逗号 / 全角逗号分隔(规则编辑用) */
function splitList(text: string): string[] {
  return text.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
}

// 「需确认」口径(未识别账户 / 低置信度 / 方向未识别)统一定义在 services/sms-import.ts,
// 页面与详情弹窗共用,避免两处各写一遍门槛值。

export default function SmsImportScreen() {
  const { colors, palette } = useTheme();
  const ruleInputStyle = useInputStyle();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  // 账本列表是异步加载的:就绪前 currentLedger 是 EMPTY_LEDGER(id 为 ''),
  // 此时发起预览/导入会带上空的 accountBookId,被服务端按「参数无效」拒掉
  const ledgerReady = !!bookId;

  const supported = isTxnReaderSupported;
  const [permitted, setPermitted] = useState(hasSmsPermission);
  const [notifGranted, setNotifGranted] = useState(isNotificationAccessGranted);
  const [days, setDays] = useState(SMS_SCAN_DAYS_DEFAULT);
  // 自定义扫描区间(本机临时值,不持久化):弹窗里的草稿单独存,取消不动生效值
  const [daysOpen, setDaysOpen] = useState(false);
  const [daysDraft, setDaysDraft] = useState('');
  const [filter, setFilter] = useState<'all' | 'EXPENSE' | 'INCOME' | 'low'>('all');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [candidates, setCandidates] = useState<LocalCandidate[]>([]);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [skipped, setSkipped] = useState({ processed: 0, duplicates: 0, byRules: 0 });
  const [channels, setChannels] = useState({ sms: 0, notification: 0 });
  // 本次扫描实际读到(落在时间窗内)的原始条数
  const [readCount, setReadCount] = useState(0);
  // 本机短信库里是否见过服务号(106/95xxx)发件人:默认 true(首扫前不提示),扫描后按实际结果更新。
  // 全时段都没有服务号 → 多为小米/红米「通知类短信」未允许(该权限查不到,只能靠症状判断)
  const [hasServiceSender, setHasServiceSender] = useState(true);
  // 本次是否撞到单次读取上限(撞到时更早的短信没被纳入本次扫描)
  const [fetchLimitHit, setFetchLimitHit] = useState(false);
  // 本机通知队列条数:用来区分「队列空」与「队列有内容但都不像交易」
  const [notifQueue, setNotifQueue] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preset, setPreset] = useState<{ source: string; preview: ImportPreviewResult } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // 本机筛选规则(编辑入口在本页,规则纯函数在 core)+ AI 兜底结果统计
  const [rules, setRules] = useState<SmsFilterRules>(DEFAULT_SMS_FILTER_RULES);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiInfo, setAiInfo] = useState({ parsed: 0, pending: 0, unrecognized: 0 });
  // AI 抽取进度(模型响应慢时按钮上显示 x/y,避免长等待看起来像卡死)
  const [aiBusy, setAiBusy] = useState<{ done: number; total: number } | null>(null);
  // 规则编辑草稿:发件人走多选下拉(候选来自本机缓存),关键词用空白/逗号分隔的文本
  const [draft, setDraft] = useState<{
    sms: boolean; notification: boolean; senders: string[];
    include: string; exclude: string; minAmount: string;
  }>({ sms: true, notification: true, senders: [], include: '', exclude: '', minAmount: '' });
  // 发件人选择器:候选在打开时从本机缓存读取(每次扫描后更新)
  const [sendersOpen, setSendersOpen] = useState(false);
  const [senderOptions, setSenderOptions] = useState<SmsSenderEntry[]>([]);
  // 候选详情(原文 + 解析/匹配逐项):存行号,候选列表变化后自动失效关闭
  const [detailRow, setDetailRow] = useState<number | null>(null);

  // 规则与 AI 开关只在本机存储:挂载时读一次用于展示(扫描时再读一次取最新值)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [loadedRules, ai] = await Promise.all([loadSmsFilterRules(), loadSmsAiSettings()]);
      if (!alive) return;
      setRules(loadedRules);
      setAiEnabled(ai.enabled);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 行号 → 预览行(展示账户匹配结果 / 分类 / 疑似重复标记)
  const previewByRow = useMemo(() => {
    const map = new Map<number, ParsedImportRow>();
    if (preview) {
      for (const r of [...preview.records, ...preview.unrecognizedRecords]) {
        if (r.rowIndex != null) map.set(r.rowIndex, r);
      }
    }
    return map;
  }, [preview]);

  const duplicateCount = useMemo(
    () => [...previewByRow.values()].filter((r) => r.possibleDuplicate).length,
    [previewByRow],
  );

  // 需确认条数(未识别账户 / 低置信度 / 方向未识别):默认不勾选,单独报数
  const needConfirmCount = useMemo(
    () => candidates.filter((c) => needsConfirm(c, previewByRow.get(c.rowIndex))).length,
    [candidates, previewByRow],
  );

  // 扫描后的渠道/去重/规则/AI 提示(为空则不渲染)
  const scanHint = useMemo(() => {
    if (!scanned) return '';
    const parts: string[] = [];
    // 先报「读到多少」:只有 2 条候选时,是收件箱本来就没有,还是被规则/去重吃掉,一眼能分
    parts.push(`读取 ${readCount} 条`);
    if (channels.sms + channels.notification > 0) parts.push(`命中 短信 ${channels.sms} · 通知 ${channels.notification}`);
    if (skipped.byRules > 0) parts.push(`筛选规则跳过 ${skipped.byRules} 条`);
    if (skipped.processed > 0) parts.push(`已跳过 ${skipped.processed} 条已处理`);
    if (skipped.duplicates > 0) parts.push(`${skipped.duplicates} 条同笔已折叠`);
    if (aiInfo.parsed > 0) parts.push(`AI 补全 ${aiInfo.parsed} 条`);
    if (aiEnabled && aiInfo.pending > 0) parts.push(`AI 未能解析 ${aiInfo.pending} 条`);
    if (!aiEnabled && aiInfo.unrecognized > 0) parts.push(`${aiInfo.unrecognized} 条规则未识别(可在设置开启 AI 兜底)`);
    if (duplicateCount > 0) parts.push(`疑似重复 ${duplicateCount} 条已默认不勾选`);
    if (needConfirmCount > 0) parts.push(`需确认 ${needConfirmCount} 条已默认不勾选`);
    return parts.join(';');
  }, [scanned, readCount, channels, skipped, duplicateCount, needConfirmCount, aiInfo, aiEnabled]);

  const visible = useMemo(() => {
    if (filter === 'all') return candidates;
    if (filter === 'low') return candidates.filter((c) => needsConfirm(c, previewByRow.get(c.rowIndex)));
    return candidates.filter((c) => c.type === filter);
  }, [candidates, filter, previewByRow]);

  /** 服务端预览:账户匹配 + 分类映射 + 弱校验;失败时保留本地候选(仅缺匹配信息) */
  const runPreview = async (list: LocalCandidate[]) => {
    if (list.length === 0) {
      setPreview(null);
      setPreviewFailed(false);
      return;
    }
    // 防御(正常已被 runScan 拦住):没有账本做不了账户匹配,退化为「本地候选 + 提示重新扫描」,
    // 而不是发一个注定 400 的请求再把错误文案弹给用户
    if (!ledgerReady) {
      setPreview(null);
      setPreviewFailed(true);
      setSelected(new Set(list.filter((c) => !needsConfirm(c)).map((c) => c.rowIndex)));
      return;
    }
    try {
      const result = await smsPreview(bookId, list);
      setPreview(result);
      setPreviewFailed(false);
      // 默认勾选规则:疑似重复(去重第 3 层,提示而非硬拦)与「需确认」行都不勾,
      // 让用户主动决定要不要带上未识别账户 / 低置信度的行
      const previewRows = [...result.records, ...result.unrecognizedRecords];
      const dupRows = new Set(previewRows.filter((r) => r.possibleDuplicate).map((r) => r.rowIndex));
      const byRow = new Map(previewRows.filter((r) => r.rowIndex != null).map((r) => [r.rowIndex, r]));
      setSelected(
        new Set(
          list
            .filter((c) => !dupRows.has(c.rowIndex) && !needsConfirm(c, byRow.get(c.rowIndex)))
            .map((c) => c.rowIndex),
        ),
      );
    } catch (e: any) {
      setPreview(null);
      setPreviewFailed(true);
      // 预览失败时没有服务端匹配结果:同样按本地信息把「需确认」行排除在默认勾选之外
      setSelected(
        new Set(list.filter((c) => !needsConfirm(c)).map((c) => c.rowIndex)),
      );
      showToast(`账户匹配失败: ${e?.message || '未知错误'}`);
    }
  };

  const runScan = async () => {
    // 账本未就绪时不要扫:预览与导入都必须带 accountBookId,空 id 只会得到一个必然失败的请求
    // (冷启动后立刻点扫描会正好撞上这个窗口)
    if (!ledgerReady) {
      showToast('账本还在加载,请稍后重试');
      return;
    }
    if (!hasSmsPermission()) {
      setPermitted(false);
      showToast('请先授予短信读取权限');
      router.push('/sms-settings');
      return;
    }
    setPermitted(true);
    setScanning(true);
    try {
      const [processedIds, loadedRules, ai] = await Promise.all([
        loadProcessedSmsIds(),
        loadSmsFilterRules(),
        loadSmsAiSettings(),
      ]);
      setRules(loadedRules);
      setAiEnabled(ai.enabled);

      const res = await scanCandidates({ days, accountBookId: bookId, processedIds, rules: loadedRules });
      // 扫描到的来源合并进本机缓存 → 筛选规则的「发件人」下拉候选
      void mergeSmsSenders(res.senders);
      let merged: MergedCandidate[] = res.candidates.map((c) => ({ ...c }));
      setSkipped({ processed: res.skippedProcessed, duplicates: res.duplicates, byRules: res.skippedByRules });
      setChannels(res.channels);
      setReadCount(res.scanned);
      setHasServiceSender(res.hasServiceSender);
      setFetchLimitHit(res.fetchLimitHit);
      setNotifQueue(res.notificationQueued);
      setNotifGranted(isNotificationAccessGranted());
      setScanned(true);

      // AI 兜底:只处理「通过筛选规则、但本地规则没读懂」的原文;开关关闭时一条都不上送
      let parsedByAi = 0;
      if (ai.enabled && res.unrecognized.length > 0) {
        setAiBusy({ done: 0, total: res.unrecognized.length });
        try {
          const out = await extractCandidatesWithAi(bookId, res.unrecognized, {
            onProgress: (done, total) => setAiBusy({ done, total }),
          });
          parsedByAi = out.candidates.length;
          merged = [...merged, ...out.candidates.map((c) => ({ ...c, parsedBy: 'ai' as const }))];
        } catch (e: any) {
          // 模型未配置 / 网络 / 超时:如实提示,本地候选照常可确认
          // status 0 = 本地网络层失败(超时或连不上),其余是服务端返回的错误文案
          showToast(
            e?.status === 0
              ? `AI 解析失败(网络或超时):${e?.message || '未知错误'}`
              : `AI 解析失败: ${e?.message || '未知错误'}`,
          );
        } finally {
          setAiBusy(null);
        }
      }
      setAiInfo({
        parsed: parsedByAi,
        pending: res.unrecognized.length - parsedByAi,
        unrecognized: res.unrecognized.length,
      });

      // 合并 AI 结果后再排序并重新编号 —— rowIndex 必须等于「提交给服务端的位置」
      const list: LocalCandidate[] = merged
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((c, i) => ({ ...c, rowIndex: i + 1 }));
      setCandidates(list);
      haptics.tap();
      if (list.length === 0) {
        showToast(`近 ${days} 天没有待处理的新交易记录`);
        setSelected(new Set());
        setPreview(null);
      } else {
        await runPreview(list);
      }
    } catch (e: any) {
      showToast(`扫描失败: ${e?.message || '未知错误'}`);
    } finally {
      setScanning(false);
    }
  };

  // 详情面板的目标行:直接从候选列表派生 —— 导入/移除后该行不存在时面板自动关闭
  const detailCandidate = detailRow != null ? candidates.find((c) => c.rowIndex === detailRow) : undefined;

  const toggle = (rowIndex: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
    haptics.tap();
  };

  /** 把预览裁剪到「选中的行」:确认卡只处理这一批(未选中的行不进确认流程) */
  const buildSelectedPreview = (): ImportPreviewResult | null => {
    if (!preview) return null;
    const records = preview.records.filter((r) => r.rowIndex != null && selected.has(r.rowIndex));
    const unrecognizedRecords = preview.unrecognizedRecords.filter((r) => r.rowIndex != null && selected.has(r.rowIndex));
    if (records.length === 0 && unrecognizedRecords.length === 0) return null;

    // 只保留仍被引用到的账户/分类,避免确认卡出现无关决议项
    const names = new Set<string>();
    for (const r of [...records, ...unrecognizedRecords]) {
      if (r.accountName) names.add(r.accountName);
      if (r.toAccountName) names.add(r.toAccountName);
    }
    const cats = new Set(records.map((r) => r.categoryCode).filter(Boolean) as string[]);

    return {
      ...preview,
      records,
      unrecognizedRecords,
      unmatchedAccounts: preview.unmatchedAccounts.filter((ua) => names.has(ua.csvName)),
      unmatchedCategories: preview.unmatchedCategories.filter((uc) => cats.has(uc.sourceCategory)),
      stats: { ...preview.stats, parsedRows: records.length, unrecognizedCount: unrecognizedRecords.length },
    };
  };

  const openConfirm = () => {
    const picked = buildSelectedPreview();
    if (!picked) return;
    haptics.tap();
    setPreset({ source: 'sms', preview: picked });
    setSheetOpen(true);
  };

  // ── 筛选规则编辑(草稿用文本编辑列表,保存时经 core 规范化) ──

  const openRules = () => {
    haptics.tap();
    setDraft({
      sms: rules.sms,
      notification: rules.notification,
      senders: rules.senders,
      include: rules.include.join(' '),
      exclude: rules.exclude.join(' '),
      minAmount: rules.minAmount > 0 ? String(rules.minAmount) : '',
    });
    setRulesOpen(true);
  };

  const saveRules = async () => {
    const saved = await saveSmsFilterRules({
      sms: draft.sms,
      notification: draft.notification,
      senders: draft.senders,
      include: splitList(draft.include),
      exclude: splitList(draft.exclude),
      minAmount: Number(draft.minAmount) || 0,
    });
    setRules(saved);
    setRulesOpen(false);
    haptics.success();
    showToast('筛选规则已保存(重新扫描生效)');
  };

  const resetRules = () => {
    setDraft({
      sms: true, notification: true,
      senders: draft.senders, include: '', exclude: '', minAmount: '',
    });
    haptics.tap();
  };

  /** 打开发件人下拉:候选从本机缓存现读,保证是最近一次扫描后的列表 */
  const openSenderPicker = async () => {
    haptics.tap();
    setSenderOptions(await loadSmsSenders());
    setSendersOpen(true);
  };

  const clearSenderCache = async () => {
    await clearSmsSenders();
    setSenderOptions([]);
    haptics.success();
    showToast('已清空发件人候选缓存');
  };

  /** 自定义扫描区间:打开时用当前生效值预填 */
  const openDaysSheet = () => {
    haptics.tap();
    setDaysDraft(String(days));
    setDaysOpen(true);
  };

  const applyDays = () => {
    const n = Number.parseInt(daysDraft.trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > MAX_SCAN_DAYS) {
      showToast(`请输入 1–${MAX_SCAN_DAYS} 之间的天数`);
      return;
    }
    setDays(n);
    setDaysOpen(false);
    haptics.success();
  };

  // ── 平台/权限门禁 ──

  if (!supported) {
    return (
      <Screen>
        <View style={{ flex: 1, paddingTop: insets.top + 8, paddingHorizontal: 20 }}>
          <Header colors={colors} onBack={() => router.back()} />
          <Card className="px-5 py-4">
            <Text style={{ fontSize: 14, fontWeight: '600' }}>当前平台不支持</Text>
            <Text variant="muted" style={{ fontSize: 12, lineHeight: 18, marginTop: 6 }}>
              依赖 Android 短信数据库,仅 Android 可用。
            </Text>
          </Card>
        </View>
      </Screen>
    );
  }

  const selectedCount = selected.size;

  // 扫描诊断:除统计行外按优先级给提示,只显示最靠前的两条(见下方诊断块)。
  // 顺序 = 可操作程度:没开通知使用权 > 可能没开「通知类短信」 > 没扫完 > 通知队列情况
  const diagnostics: { key: string; text: string; color: string; onPress?: () => void }[] = [];
  if (!notifGranted) {
    diagnostics.push({
      key: 'notif-off',
      text: '通知使用权未开启,银行 / 支付 App 的通知收不到',
      color: colors.mutedForeground,
      onPress: () => { haptics.tap(); router.push('/sms-settings'); },
    });
  }
  if (channels.sms === 0 && !hasServiceSender) {
    diagnostics.push({
      key: 'no-service-sms',
      text: '未发现服务号短信,可能未允许「通知类短信」',
      color: colors.expense,
      onPress: () => { haptics.tap(); openSmsPermissionSettings(); },
    });
  }
  if (fetchLimitHit) {
    diagnostics.push({
      key: 'fetch-limit',
      text: `已达单次读取上限(${SMS_FETCH_MAX} 条),更早的短信未纳入本次扫描`,
      color: colors.mutedForeground,
    });
  }
  if (notifGranted && channels.notification === 0) {
    diagnostics.push({
      key: 'notif-empty',
      text: notifQueue > 0 ? `通知队列 ${notifQueue} 条,但都不像交易` : '通知队列为空',
      color: colors.mutedForeground,
    });
  }
  const topDiagnostics = diagnostics.slice(0, 2);

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
        <View style={{ paddingHorizontal: 20 }}>
          <Header colors={colors} onBack={() => router.back()} />

          {/* 扫描条件 */}
          <Card className="px-4 py-3 mb-3">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', flex: 1 }}>扫描区间</Text>
              {DAY_OPTIONS.map((d) => {
                const active = days === d;
                return (
                  <Pressable
                    key={d}
                    onPress={() => {
                      setDays(d);
                      haptics.tap();
                    }}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? alpha(colors.primary, 0.1) : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 11.5, color: active ? colors.primary : colors.mutedForeground, fontWeight: active ? '600' : '400' }}>
                      {d} 天
                    </Text>
                  </Pressable>
                );
              })}
              {/* 自定义:选中后直接显示当前天数(超出预设区间时一眼看得出生效值) */}
              <Pressable
                onPress={openDaysSheet}
                style={{
                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1,
                  borderColor: !DAY_OPTIONS.includes(days) ? colors.primary : colors.border,
                  backgroundColor: !DAY_OPTIONS.includes(days) ? alpha(colors.primary, 0.1) : 'transparent',
                }}
              >
                <Text style={{ fontSize: 11.5, color: !DAY_OPTIONS.includes(days) ? colors.primary : colors.mutedForeground, fontWeight: !DAY_OPTIONS.includes(days) ? '600' : '400' }}>
                  {DAY_OPTIONS.includes(days) ? '自定义' : `${days} 天`}
                </Text>
              </Pressable>
            </View>

            {/* 筛选规则入口:通道 / 发件人白名单 / 关键词 / 金额下限。本机生效,也是 AI 上送的隐私闸门 */}
            <Pressable onPress={openRules} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
              <SlidersHorizontal
                size={13}
                color={isSmsFilterRulesCustomized(rules) ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={{
                  fontSize: 11.5, flex: 1,
                  color: isSmsFilterRulesCustomized(rules) ? colors.primary : colors.mutedForeground,
                }}
              >
                {isSmsFilterRulesCustomized(rules) ? '已自定义筛选规则' : '筛选规则(通道 / 发件人 / 关键词 / 金额)'}
              </Text>
              <ChevronLeft size={13} color={colors.mutedForeground} style={{ transform: [{ rotate: '180deg' }] }} />
            </Pressable>

            {!permitted ? (
              <Pressable
                onPress={() => router.push('/sms-settings')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: alpha(colors.expense, 0.08) }}
              >
                <ShieldAlert size={15} color={colors.expense} />
                <Text style={{ flex: 1, fontSize: 12, color: colors.expense }}>未授予短信读取权限,去开启</Text>
                <ChevronLeft size={14} color={colors.expense} style={{ transform: [{ rotate: '180deg' }] }} />
              </Pressable>
            ) : (
              <Pressable
                onPress={runScan}
                disabled={scanning || !ledgerReady}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  marginTop: 10, paddingVertical: 11, borderRadius: 12,
                  backgroundColor: colors.primary, opacity: scanning || !ledgerReady ? 0.6 : 1,
                }}
              >
                {scanning
                  ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                  : <RefreshCw size={15} color={colors.primaryForeground} />}
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.primaryForeground }}>
                  {scanning
                    ? aiBusy
                      ? `AI 解析中 ${aiBusy.done}/${aiBusy.total}...`
                      : '扫描中...'
                    : !ledgerReady
                      ? '账本未就绪'
                      : scanned
                        ? '重新扫描'
                        : '开始扫描'}
                </Text>
              </Pressable>
            )}

            {/* 扫描诊断块:统计(scanHint) + 最多两条按优先级排序的提示。
                原来散成 5 段小字,同时命中时会堆一屏,合并后只显示最该处理的那两条 */}
            {scanned ? (
              <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: colors.muted, gap: 5 }}>
                {scanHint ? (
                  <Text variant="muted" style={{ fontSize: 10.5, lineHeight: 15 }}>{scanHint}</Text>
                ) : null}
                {topDiagnostics.map((d) => (
                  d.onPress ? (
                    <Pressable
                      key={d.key}
                      onPress={d.onPress}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <TriangleAlert size={12} color={d.color} />
                      <Text style={{ fontSize: 10.5, flex: 1, lineHeight: 15, color: d.color }}>{d.text}</Text>
                      <ChevronLeft size={12} color={d.color} style={{ transform: [{ rotate: '180deg' }] }} />
                    </Pressable>
                  ) : (
                    <Text key={d.key} variant="muted" style={{ fontSize: 10.5, lineHeight: 15 }}>{d.text}</Text>
                  )
                ))}
              </View>
            ) : null}
          </Card>

          {/* 筛选 */}
          {scanned && candidates.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {FILTERS.map((f) => {
                const active = filter === f.key;
                const count = f.key === 'all'
                  ? candidates.length
                  : f.key === 'low'
                    ? needConfirmCount
                    : candidates.filter((c) => c.type === f.key).length;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => { setFilter(f.key); haptics.tap(); }}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? alpha(colors.primary, 0.1) : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 11.5, color: active ? colors.primary : colors.mutedForeground }}>
                      {f.label} {count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {scanned && candidates.length > 0 ? (
            <Text variant="muted" style={{ fontSize: 10.5, marginBottom: 8 }}>
              点行看原文与匹配详情;左侧方框勾选
            </Text>
          ) : null}
        </View>

        {/* 候选列表 */}
        <FlatList
          style={{ flex: 1 }}
          data={visible}
          keyExtractor={(c) => c.sourceId}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 40, gap: 8 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.1) }}>
                <MessageSquareText size={24} color={colors.primary} />
              </View>
              <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', lineHeight: 19 }}>
                {scanned
                  ? '没有符合条件的候选\n换个时间范围,或清空本机标记后重扫'
                  : `读取本机短信识别交易\n近 ${days} 天,验证码/营销自动排除`}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <CandidateRow
              candidate={item}
              previewRow={previewByRow.get(item.rowIndex)}
              checked={selected.has(item.rowIndex)}
              onToggle={() => toggle(item.rowIndex)}
              onOpenDetail={() => { haptics.tap(); setDetailRow(item.rowIndex); }}
            />
          )}
        />

        {/* 底部操作条:自行吃底部安全域,避免被手势条/导航栏遮挡 */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 12),
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
            backgroundColor: colors.background,
          }}
        >
          {previewFailed && candidates.length > 0 ? (
            <Text style={{ fontSize: 11, color: colors.expense, marginBottom: 6, textAlign: 'center' }}>
              账户匹配未完成,请重新扫描后再导入
            </Text>
          ) : null}
          {selectedCount === 0 && needConfirmCount > 0 ? (
            <Text variant="muted" style={{ fontSize: 11, marginBottom: 6, textAlign: 'center' }}>
              未识别账户 / 低置信度的行默认不勾,核对原文后再手动勾选
            </Text>
          ) : null}
          <Pressable
            onPress={openConfirm}
            disabled={selectedCount === 0 || !preview}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              height: 46, borderRadius: palette.radius.button, backgroundColor: colors.primary,
              opacity: selectedCount === 0 || !preview ? 0.5 : 1,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.primaryForeground }}>
              导入选中 {selectedCount} 条
            </Text>
          </Pressable>
        </View>
      </View>

      {/* 确认流程复用文件导入向导(预置预览 → 直接落在「预览处理」步骤) */}
      <ImportSheet
        visible={sheetOpen}
        onClose={() => { setSheetOpen(false); setPreset(null); }}
        bookId={bookId}
        dictCodes={preset?.preview.allDictItems ?? []}
        presetPreview={preset}
        onImported={(r) => {
          // 去重第 1 层:已导入的来源标记为「已处理」,下次扫描不再出现。
          // 同一笔的其它渠道来源(折叠时被丢弃的那条)也要一起标记 —— 否则标记只落在保留的那条上,
          // 另一渠道的副本下次扫描会以「疑似重复」再出现一次
          const importedRows = new Set(
            [...(preset?.preview.records ?? []), ...(preset?.preview.unrecognizedRecords ?? [])].map((row) => row.rowIndex),
          );
          const imported = candidates.filter((c) => importedRows.has(c.rowIndex));
          const remaining = candidates.filter((c) => !importedRows.has(c.rowIndex));
          const sources = imported.flatMap((c) => [
            { id: c.sourceId, channel: c.channel },
            ...(c.mergedSources ?? []),
          ]);
          markSmsProcessed(sources.map((s) => s.id)).catch(() => {});
          // 通知队列里的对应条目直接删掉(短信条目不在队列里,靠上面的「已处理」标记跳过)
          const notifKeys = sources.filter((s) => s.channel === 'notification').map((s) => s.id);
          if (notifKeys.length > 0) void removePendingNotifications(notifKeys);
          setCandidates(remaining);
          showToast(`已导入 ${r.imported} 条${r.accountsCreated > 0 ? `,新建账户 ${r.accountsCreated} 个` : ''}`);
          // 剩余候选重新过一遍弱校验(刚导入的流水会成为新的「已存在」)
          runPreview(remaining).catch(() => {});
        }}
      />

      {/* 筛选规则编辑:只影响本机采集与 AI 上送范围,不动已有流水 */}
      <FormSheet
        visible={rulesOpen}
        title="筛选规则"
        onClose={() => setRulesOpen(false)}
        onSave={saveRules}
        saveLabel="保存规则"
        scrollBody
      >
        <View style={{ gap: 14 }}>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '500' }}>短信渠道</Text>
                <Text variant="muted" style={{ fontSize: 11.5, marginTop: 2 }}>关闭后不再读取短信收件箱</Text>
              </View>
              <Switch
                value={draft.sms}
                onValueChange={(v) => setDraft((d) => ({ ...d, sms: v }))}
                trackColor={{ true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '500' }}>通知渠道</Text>
                <Text variant="muted" style={{ fontSize: 11.5, marginTop: 2 }}>关闭后不再读取已累积的银行/支付通知</Text>
              </View>
              <Switch
                value={draft.notification}
                onValueChange={(v) => setDraft((d) => ({ ...d, notification: v }))}
                trackColor={{ true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* 发件人白名单:可搜索多选下拉(候选 = 每次扫描后累积的本机来源) */}
          <View style={{ gap: 6 }}>
            <View>
              <Text style={{ fontSize: 13.5, fontWeight: '500' }}>发件人白名单（可选）</Text>
              <Text variant="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                留空 = 不限;按包含匹配(选 95599 也能命中 106980095599)
              </Text>
            </View>
            <Pressable
              onPress={openSenderPicker}
              style={{ ...ruleInputStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <Text
                style={{
                  flex: 1, fontSize: 13.5,
                  color: draft.senders.length > 0 ? colors.foreground : colors.mutedForeground,
                }}
                numberOfLines={2}
              >
                {draft.senders.length > 0 ? draft.senders.join('、') : '不限(全部来源)'}
              </Text>
              <ChevronLeft size={14} color={colors.mutedForeground} style={{ transform: [{ rotate: '180deg' }] }} />
            </Pressable>
          </View>

          <LabeledInput
            label="关键词白名单（可选）"
            desc="非空时,文本必须包含其中之一才会进入候选"
            value={draft.include}
            onChangeText={(v) => setDraft((d) => ({ ...d, include: v }))}
            placeholder="交易 消费 代扣"
          />
          <LabeledInput
            label="关键词黑名单（可选）"
            desc="命中即排除(优先于白名单);已内置排除验证码、账单、余额提醒、营销与促销"
            value={draft.exclude}
            onChangeText={(v) => setDraft((d) => ({ ...d, exclude: v }))}
            placeholder="理财 保险 贷款"
          />
          <LabeledInput
            label="金额下限（元,可选）"
            desc="低于该值的交易不进候选;读不出金额的不受影响"
            value={draft.minAmount}
            onChangeText={(v) => setDraft((d) => ({ ...d, minAmount: v }))}
            keyboardType="decimal-pad"
            placeholder="0"
          />

          <Btn title="恢复默认" variant="secondary" onPress={resetRules} />
        </View>
      </FormSheet>

      {/* 自定义扫描区间 */}
      <FormSheet
        visible={daysOpen}
        title="自定义扫描区间"
        onClose={() => setDaysOpen(false)}
        onSave={applyDays}
        saveLabel="应用"
      >
        <LabeledInput
          label="扫描最近多少天"
          desc={`1–${MAX_SCAN_DAYS} 天;本机单次最多读取 2000 条短信,区间越大扫描越慢`}
          value={daysDraft}
          onChangeText={setDaysDraft}
          keyboardType="numeric"
          placeholder="180"
        />
      </FormSheet>

      {/* 候选详情:点记录行体打开,看原文与逐项解析/匹配结果 */}
      {detailCandidate ? (
        <CandidateDetailSheet
          visible
          candidate={detailCandidate}
          previewRow={previewByRow.get(detailCandidate.rowIndex)}
          checked={selected.has(detailCandidate.rowIndex)}
          onClose={() => setDetailRow(null)}
          onToggle={() => toggle(detailCandidate.rowIndex)}
        />
      ) : null}

      {/* 发件人白名单选择器:候选来自本机缓存(每次扫描后更新),支持搜索与手动添加 */}
      {sendersOpen ? (
        <SenderPickerSheet
          visible
          initialSelected={draft.senders}
          senders={senderOptions}
          onClose={() => setSendersOpen(false)}
          onConfirm={(next) => {
            setDraft((d) => ({ ...d, senders: next }));
            setSendersOpen(false);
          }}
          onClearCache={clearSenderCache}
        />
      ) : null}
    </Screen>
  );
}

/** 返回 + 标题(独立 Stack 页无 GlobalBar,自行渲染) */
function Header({ colors, onBack }: { colors: ReturnType<typeof useTheme>['colors']; onBack: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <Pressable
        onPress={onBack}
        style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' }}
      >
        <ChevronLeft size={18} color={colors.foreground} />
      </Pressable>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>短信记账</Text>
    </View>
  );
}

/** 候选行:左侧复选框勾选,右侧点开详情(原文 + 解析/匹配逐项) */
function CandidateRow({ candidate, previewRow, checked, onToggle, onOpenDetail }: {
  candidate: LocalCandidate;
  previewRow?: ParsedImportRow;
  checked: boolean;
  onToggle: () => void;
  onOpenDetail: () => void;
}) {
  const { colors } = useTheme();
  const typeColor = semanticTypeColor(colors, candidate.type);
  const dup = !!previewRow?.possibleDuplicate;
  // 与「需确认」筛选口径一致:未识别账户也算需确认(默认不勾选)
  const needConfirm = needsConfirm(candidate, previewRow);
  const accountText = previewRow?.accountName || candidate.accountName || '未识别账户';

  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: colors.hairline,
      }}
    >
      {/* 勾选热区与详情热区分开:点行体看原文,不再误触取消勾选 */}
      <Pressable onPress={onToggle} hitSlop={8} style={{ paddingTop: 2 }}>
        <View
          style={{
            width: 20, height: 20, borderRadius: 6, borderWidth: 1.5,
            borderColor: checked ? colors.primary : colors.border,
            backgroundColor: checked ? colors.primary : 'transparent',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          {checked ? <Check size={13} color={colors.primaryForeground} /> : null}
        </View>
      </Pressable>

      <Pressable onPress={onOpenDetail} style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 11, width: 26, color: typeColor }}>
            {candidate.type === 'INCOME' ? '收入' : candidate.type === 'EXPENSE' ? '支出' : candidate.type === 'TRANSFER' ? '转账' : '未识别'}
          </Text>
          <Text style={{ fontSize: 14, fontWeight: '600', flex: 1, color: typeColor, fontVariant: ['tabular-nums'] }}>
            {candidate.type === 'EXPENSE' ? '-' : candidate.type === 'INCOME' ? '+' : ''}{candidate.amount.toFixed(2)}
          </Text>
          {dup ? (
            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: alpha('#f59e0b', 0.15) }}>
              <Text style={{ fontSize: 10, color: '#f59e0b' }}>疑似重复</Text>
            </View>
          ) : needConfirm ? (
            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: alpha('#f59e0b', 0.15) }}>
              <Text style={{ fontSize: 10, color: '#f59e0b' }}>需确认</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 12, flexShrink: 1 }} numberOfLines={1}>
            {accountText}
            {candidate.payer ? ` · ${candidate.payer}` : ''}
          </Text>
          {/* 来源渠道:同一笔在双渠道上报时已折叠,这里标明最终采用哪条 */}
          <View style={{ paddingHorizontal: 4, borderRadius: 4, backgroundColor: colors.muted }}>
            <Text style={{ fontSize: 9, color: colors.mutedForeground }}>
              {candidate.channel === 'notification' ? '通知' : '短信'}
            </Text>
          </View>
          {/* AI 兜底解析出来的行:本地规则没读懂,字段由模型抽取,置信度普遍偏低 */}
          {candidate.parsedBy === 'ai' ? (
            <View style={{ paddingHorizontal: 4, borderRadius: 4, backgroundColor: alpha(colors.primary, 0.15) }}>
              <Text style={{ fontSize: 9, color: colors.primary }}>AI</Text>
            </View>
          ) : null}
        </View>
        <Text variant="muted" style={{ fontSize: 10.5 }} numberOfLines={1}>
          {candidate.date.replace('T', ' ').slice(0, 16)}
          {candidate.tradeKind ? ` · ${candidate.tradeKind}` : ''}
          {candidate.cardTail ? ` · 尾号${candidate.cardTail}` : ''}
          {previewRow?.mappedCategoryCode ? ` · → ${previewRow.mappedCategoryCode}` : ''}
        </Text>
      </Pressable>
    </View>
  );
}
