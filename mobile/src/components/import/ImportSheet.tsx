import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Check, CheckCircle2, ChevronDown, FileText } from 'lucide-react-native';
import { useTheme, alpha, haptics, semanticTypeColor } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { ChipSelect } from '@/components/ui/ChipSelect';
import { notifyPageRefresh } from '@/components/chrome/chrome';
import { useRecords } from '@/stores/records';
import { useAuth } from '@/stores/auth';
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account';
import { fetchBookMembers } from '@/services/records';
import {
  analyzeImportCsv,
  confirmImport,
  previewImport,
  type DictEntry,
  type ImportPreviewResult,
  type ParsedImportRow,
} from '@/services/import';
import {
  ACCOUNT_TYPE_LABELS,
  IMPORT_COLUMN_FIELDS,
  IMPORT_SOURCE_DEFS,
  IMPORT_TYPE_LABELS,
  TYPE_TO_GROUP,
  autoDetectColumns,
  autoDetectTypeMapping,
  detectTypeValues,
  initAccountResolutions,
  isColumnMappingValid,
  matchAccountInPool,
  mergeAccountCreations,
  type AccountResolution,
  type ImportColumnField,
  type ImportSource,
} from '@homibook/core';

// 类型语义色随主题(semanticTypeColor);映射未命中等警示色保持固定琥珀
// 收支类型 → 字典组映射(TYPE_TO_GROUP)统一来自 @homibook/core
const GROUP_LABELS: Record<string, string> = {
  transaction_category_expense: '支出分类',
  transaction_category_income: '收入分类',
  transaction_category_transfer: '转账分类',
};

type Step = 'source' | 'upload' | 'columnMapping' | 'preview' | 'confirm' | 'result';

// 账户解析类型与默认值初始化统一来自 @homibook/core(与 AI 导入卡共用策略)

interface CategoryResolution {
  targetCode: string;
  save: boolean;
  payerContains: string;
  descriptionContains: string;
}

interface PickedFile {
  uri: string;
  name: string;
  size: number;
}

/** 底部弹出选项选择器(字段映射/分类/账户/类型共用) */
function OptionPickerSheet({
  visible,
  title,
  options,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  options: { value: string; label: string; group?: string }[];
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  const { colors } = useTheme();
  const groups = useMemo(() => {
    const g = new Map<string, { value: string; label: string }[]>();
    for (const o of options) {
      const key = o.group ?? '';
      (g.get(key) ?? g.set(key, []).get(key)!).push(o);
    }
    return Array.from(g.entries());
  }, [options]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '65%', backgroundColor: colors.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: 30 }}>
        <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 8 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted }} />
          <Text style={{ fontSize: 15, fontWeight: '700', marginTop: 8 }}>{title}</Text>
        </View>
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          {groups.map(([group, items]) => (
            <View key={group || '_'} onStartShouldSetResponder={() => true}>
              {group ? (
                <Text variant="muted" style={{ fontSize: 11, letterSpacing: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4 }}>{group}</Text>
              ) : null}
              {items.map((o) => (
                <Pressable
                  key={o.value}
                  onPress={() => {
                    haptics.tap();
                    onSelect(o.value);
                    onClose();
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 }}
                >
                  <Text style={{ fontSize: 14, color: colors.foreground, flex: 1 }}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

interface ImportSheetProps {
  visible: boolean;
  onClose: () => void;
  bookId: string;
  dictCodes: DictEntry[];
}

// 流水导入向导(复刻 web ImportDialog):来源 → 上传 → (CSV 列映射) → 预览处理 → 确认 → 结果
export function ImportSheet({ visible, onClose, bookId, dictCodes }: ImportSheetProps) {
  const { colors, palette } = useTheme();
  const { accounts } = useRecords();

  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<ImportSource>('alipay');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // CSV 分析结果
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvSampleRows, setCsvSampleRows] = useState<Record<string, string>[]>([]);
  const [csvTotalRows, setCsvTotalRows] = useState(0);
  const [headerRow, setHeaderRow] = useState<string>('');
  const [columnMapping, setColumnMapping] = useState<Partial<Record<ImportColumnField, string>>>({});
  const [typeMapping, setTypeMapping] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<{ kind: 'column' | 'type-value' | 'acct-type' | 'account' | 'category' | 'owner' | 'unrec-type' | 'unrec-acct' | 'unrec-cat' | 'owner-confirm' | 'prev-type' | 'prev-cat' | 'prev-acct'; key?: string } | null>(null);

  // 预览结果
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [showAllRecords, setShowAllRecords] = useState(false);
  // 预览列表筛选(参考 web:类型/原始分类/账户)
  const [prevFilterType, setPrevFilterType] = useState('');
  const [prevFilterCategory, setPrevFilterCategory] = useState('');
  const [prevFilterAccount, setPrevFilterAccount] = useState('');
  const [confirmShowAll, setConfirmShowAll] = useState(false);
  const [accountRes, setAccountRes] = useState<Record<string, AccountResolution>>({});
  const [categoryRes, setCategoryRes] = useState<Record<string, CategoryResolution>>({});
  const [unrecognizedRes, setUnrecognizedRes] = useState<Record<number, { type: string; accountId: string; categoryCode: string }>>({});

  // 确认导入
  const [selectedOwnerId, setSelectedOwnerId] = useState('__self__');
  const [bookMembers, setBookMembers] = useState<{ userId: string; name: string }[]>([]);
  const [importResult, setImportResult] = useState<{ imported: number; accountsCreated: number } | null>(null);

  const allDictItems = dictCodes;

  // 打开时拉取账本成员(归属人选择)
  useEffect(() => {
    if (visible && bookId) {
      fetchBookMembers(bookId)
        .then((ms) => setBookMembers(ms.map((m) => ({ userId: m.userId || m.id, name: m.nickname }))))
        .catch(() => {});
    }
  }, [visible, bookId]);

  // 实际归属人(多成员账本下,候选/匹配切换到归属人名下账户)
  const auth = useAuth();
  const currentUserId = auth.user?.id ?? '';
  const effectiveOwnerId = selectedOwnerId === '__self__' ? currentUserId : selectedOwnerId;
  const ownerPool = useMemo(
    () => accounts.filter((a) => a.status === 'ACTIVE' && (!effectiveOwnerId || a.ownerId === effectiveOwnerId)),
    [accounts, effectiveOwnerId],
  );
  const multiOwnerAccounts = new Set(accounts.filter((a) => a.ownerId).map((a) => a.ownerId)).size > 1;

  // 预览筛选:候选(原始分类/账户去重)与过滤结果(同 web filteredRecords)
  const previewCategories = useMemo(
    () => (preview ? (Array.from(new Set(preview.records.map((r) => r.categoryCode).filter(Boolean))) as string[]) : []),
    [preview],
  );
  const previewAccounts = useMemo(
    () => (preview ? (Array.from(new Set(preview.records.map((r) => r.accountName).filter(Boolean))) as string[]) : []),
    [preview],
  );
  const filteredPreview = preview
    ? preview.records.filter((r) => {
        if (prevFilterType && r.type !== prevFilterType) return false;
        if (prevFilterCategory && r.categoryCode !== prevFilterCategory) return false;
        if (prevFilterAccount && r.accountName !== prevFilterAccount) return false;
        return true;
      })
    : [];

  const reset = () => {
    setStep('source');
    setSource('alipay');
    setFile(null);
    setLoading(false);
    setError('');
    setCsvHeaders([]);
    setCsvSampleRows([]);
    setCsvTotalRows(0);
    setHeaderRow('');
    setColumnMapping({});
    setTypeMapping({});
    setPicker(null);
    setPreview(null);
    setShowAllRecords(false);
    setPrevFilterType('');
    setPrevFilterCategory('');
    setPrevFilterAccount('');
    setConfirmShowAll(false);
    setAccountRes({});
    setCategoryRes({});
    setUnrecognizedRes({});
    setSelectedOwnerId('__self__');
    setImportResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const pickFile = async (src: ImportSource) => {
    const DocumentPicker = await import('expo-document-picker');
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
      type: src === 'wechat' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/comma-separated-values,text/csv',
    });
    if (result.canceled || !result.assets?.length) return null;
    const asset = result.assets[0];
    return { uri: asset.uri, name: asset.name || 'bill.csv', size: asset.size ?? 0 };
  };

  // ── 步骤流转 ──

  const goUpload = async (src: ImportSource) => {
    setSource(src);
    // 切换来源重新进入上传步骤时,清空上一次选择的文件
    setFile(null);
    setError('');
    setStep('upload');
    haptics.tap();
  };

  const handlePickFile = async () => {
    try {
      const f = await pickFile(source);
      if (f) {
        setFile(f);
        setError('');
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const hr = headerRow.trim() ? parseInt(headerRow.trim(), 10) : undefined;
      const result = await analyzeImportCsv(file.uri, file.name, Number.isNaN(hr as number) ? undefined : hr);
      const headers = result.headers.filter((h) => h !== '');
      setCsvHeaders(headers);
      setCsvSampleRows(result.sampleRows);
      setCsvTotalRows(result.totalRows);
      const detected = autoDetectColumns(result.headers);
      setColumnMapping(detected);
      if (detected.type) {
        setTypeMapping(autoDetectTypeMapping(detectTypeValues(detected.type, result.sampleRows)) as Record<string, string>);
      }
      setStep('columnMapping');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleParse = async () => {
    if (!file || !bookId) return;
    setLoading(true);
    setError('');
    try {
      const result = await previewImport(file.uri, file.name, {
        source,
        accountBookId: bookId,
        columnMapping: source === 'csv' ? columnMapping : undefined,
        typeMapping: source === 'csv' ? typeMapping : undefined,
        headerRow: source === 'csv' && headerRow.trim() ? parseInt(headerRow.trim(), 10) : undefined,
      });
      applyPreview(result);
      setStep('preview');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const applyPreview = (result: ImportPreviewResult) => {
    setPreview(result);
    // 新预览重置列表筛选与展开状态
    setPrevFilterType('');
    setPrevFilterCategory('');
    setPrevFilterAccount('');
    setShowAllRecords(false);
    // 初始化账户解析:有候选默认选第一个,无候选默认新建(统一策略见 core initAccountResolutions)
    setAccountRes(initAccountResolutions(result.unmatchedAccounts));
    // 初始化分类解析
    const catRes: Record<string, CategoryResolution> = {};
    for (const uc of result.unmatchedCategories) {
      const key = `${uc.sourceCategory}::${uc.types[0] ?? 'EXPENSE'}`;
      catRes[key] = { targetCode: uc.suggestedCode ?? '', save: false, payerContains: '', descriptionContains: '' };
    }
    setCategoryRes(catRes);
    setUnrecognizedRes({});
  };

  // 切换归属人后:已选的已有账户/新建账户归属切换到该归属人名下
  const handleOwnerChange = (ownerId: string) => {
    setSelectedOwnerId(ownerId);
    const targetId = ownerId === '__self__' ? currentUserId : ownerId;
    const pool = accounts.filter((a) => a.status === 'ACTIVE' && (!targetId || a.ownerId === targetId));
    setAccountRes((prev) => {
      const next: Record<string, AccountResolution> = {};
      for (const [key, res] of Object.entries(prev)) {
        if (res.action === 'existing' && res.accountId) {
          const acc = accounts.find((a) => a.id === res.accountId);
          const rematched = acc ? matchAccountInPool(acc.name, pool, targetId) : null;
          next[key] = { action: 'existing', accountId: rematched?.id ?? '' };
        } else {
          next[key] = res;
        }
      }
      return next;
    });
  };

  // ── 组装确认数据(对齐 web buildImportData) ──

  const findBestCategoryResolution = (sourceCategory: string, recordType: string, payer: string | null, remark: string | null): string | null => {
    let best: string | null = null;
    let bestScore = -1;
    for (const [key, cr] of Object.entries(categoryRes)) {
      if (!cr.targetCode) continue;
      const parts = key.split('::');
      if (parts[0] !== sourceCategory || parts[1] !== recordType) continue;
      let score = 0;
      if (cr.payerContains) {
        if (payer && payer.includes(cr.payerContains)) score += 2;
        else continue;
      }
      if (cr.descriptionContains) {
        if (remark && remark.includes(cr.descriptionContains)) score += 1;
        else continue;
      }
      if (score > bestScore) {
        bestScore = score;
        best = cr.targetCode;
      }
    }
    return best;
  };

  const buildImportData = () => {
    // 待创建账户(合并同名) + 归属人
    const rawCreations = (preview?.unmatchedAccounts ?? [])
      .filter((ua) => accountRes[ua.csvName]?.action === 'create')
      .map((ua) => {
        const res = accountRes[ua.csvName] as { action: 'create'; name: string; type: string };
        return { csvName: ua.csvName, name: res.name, type: res.type };
      });
    const accountCreations = mergeAccountCreations(rawCreations).map((c) => ({
      csvName: c.csvName,
      name: c.name,
      type: c.type,
      bankName: c.bankName ?? undefined,
      accountNo: c.accountNo ?? undefined,
      ownerId: effectiveOwnerId || undefined,
    }));

    // 记录列表(账户重映射 + 分类条件化映射 + 归属人)
    const remapAccount = (accountId: string | null | undefined): string => {
      if (!accountId) return '';
      const acc = accounts.find((a) => a.id === accountId);
      if (!acc) return accountId;
      return matchAccountInPool(acc.name, ownerPool, effectiveOwnerId)?.id || accountId;
    };

    const records = (preview?.records ?? []).map((r) => {
      let accountId = remapAccount(r.accountId || undefined);
      if (!accountId && r.accountName) {
        const res = accountRes[r.accountName];
        if (res?.action === 'existing') accountId = res.accountId;
        else if (res?.action === 'create') accountId = res.name;
        else accountId = matchAccountInPool(r.accountName, ownerPool, effectiveOwnerId)?.id || r.accountName;
      }

      let toAccountId = remapAccount(r.toAccountId || undefined) || undefined;
      if (!toAccountId && r.toAccountName) {
        const res = accountRes[r.toAccountName];
        if (res?.action === 'existing') toAccountId = res.accountId;
        else if (res?.action === 'create') toAccountId = res.name;
        else toAccountId = matchAccountInPool(r.toAccountName, ownerPool, effectiveOwnerId)?.id || r.toAccountName;
      }

      const userResolution = r.categoryCode ? findBestCategoryResolution(r.categoryCode, r.type, r.payer ?? null, r.remark ?? null) : null;
      return {
        date: r.date,
        type: r.type,
        amount: r.amount,
        accountId,
        toAccountId,
        categoryCode: userResolution || r.mappedCategoryCode || r.categoryCode || null,
        payer: r.payer ?? undefined,
        remark: r.remark ?? undefined,
        tags: r.tags ?? [],
        ownerId: selectedOwnerId === '__self__' ? undefined : selectedOwnerId,
        _accountName: r.accountName,
      };
    });

    // 未识别记录(已设置类型+账户的)
    const resolvedUnrecognized = (preview?.unrecognizedRecords ?? [])
      .filter((r) => {
        const res = unrecognizedRes[r.rowIndex ?? -1];
        return res?.type && res?.accountId;
      })
      .map((r) => {
        const res = unrecognizedRes[r.rowIndex ?? -1];
        return {
          date: r.date,
          type: res.type,
          amount: r.amount,
          accountId: res.accountId,
          categoryCode: res.categoryCode || r.mappedCategoryCode || r.categoryCode || null,
          payer: r.payer ?? undefined,
          remark: r.remark ?? undefined,
          ownerId: selectedOwnerId === '__self__' ? undefined : selectedOwnerId,
          _accountName: r.accountName,
        };
      });

    // 保存的分类/账户映射规则(与 web 一致,随确认提交持久化)
    const accountIdToName = new Map<string, string>();
    for (const a of accounts) accountIdToName.set(a.id, a.name);
    for (const c of accountCreations) accountIdToName.set(c.name, c.name);
    const accountMappingSet = new Map<string, { sourceAccountName: string; targetAccountName: string }>();
    for (const r of records as any[]) {
      const csvName = r._accountName;
      if (!csvName) continue;
      const targetName = accountIdToName.get(r.accountId) || r.accountId;
      if (targetName === csvName) continue;
      const key = `${csvName}||${targetName}`;
      if (!accountMappingSet.has(key)) accountMappingSet.set(key, { sourceAccountName: csvName, targetAccountName: targetName });
    }

    const newMappings = Object.entries(categoryRes)
      .filter(([, cr]) => cr.save && cr.targetCode)
      .map(([key, cr]) => {
        const parts = key.split('::');
        return {
          sourceCategory: parts[0],
          targetCategoryCode: cr.targetCode,
          recordType: parts[1],
          payerContains: cr.payerContains || undefined,
          descriptionContains: cr.descriptionContains || undefined,
        };
      });

    const allRecords = (records as any[]).concat(resolvedUnrecognized);
    return {
      payload: {
        accountBookId: bookId,
        source,
        records: allRecords.map(({ _accountName, ...r }) => r),
        accountCreations,
        newMappings,
        newAccountMappings: Array.from(accountMappingSet.values()),
      },
      allCount: records.length + resolvedUnrecognized.length,
      // 展示用列表(带账户名,同预览行渲染)
      displayRecords: allRecords.map(({ _accountName, ...r }) => ({ ...r, accountName: _accountName })),
    };
  };

  const handleConfirm = async () => {
    const { payload, allCount } = buildImportData();
    if (allCount === 0) return;
    setLoading(true);
    setError('');
    try {
      const result = await confirmImport(payload);
      setImportResult(result);
      setStep('result');
      haptics.success();
      notifyPageRefresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── 选择器选项 ──

  const pickerOptions: { value: string; label: string; group?: string }[] = (() => {
    if (!picker) return [];
    if (picker.kind === 'column') {
      return csvHeaders.map((h) => ({ value: h, label: h }));
    }
    if (picker.kind === 'acct-type') {
      return Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v as string }));
    }
    if (picker.kind === 'account') {
      return ownerPool.map((a) => ({ value: a.id, label: accountLabel(a, multiOwnerAccounts) }));
    }
    if (picker.kind === 'category') {
      // key 为 `源分类::记录类型`,按类型限定分类字典分组
      const type = picker.key ? picker.key.split('::')[1] : null;
      const group = type ? TYPE_TO_GROUP[type] : null;
      return allDictItems
        .filter((d) => !group || d.group === group)
        .map((d) => ({ value: d.code, label: d.label, group: GROUP_LABELS[d.group] }));
    }
    if (picker.kind === 'unrec-type') {
      return Object.entries(IMPORT_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }));
    }
    if (picker.kind === 'unrec-acct') {
      return ownerPool.map((a) => ({ value: a.id, label: accountLabel(a, multiOwnerAccounts) }));
    }
    if (picker.kind === 'unrec-cat') {
      const res = picker.key ? unrecognizedRes[Number(picker.key)] : undefined;
      const group = res?.type ? TYPE_TO_GROUP[res.type] : null;
      return allDictItems
        .filter((d) => !group || d.group === group)
        .map((d) => ({ value: d.code, label: d.label, group: GROUP_LABELS[d.group] }));
    }
    if (picker.kind === 'owner') {
      return [
        { value: '__self__', label: '本人(默认)' },
        ...bookMembers.map((m) => ({ value: m.userId, label: m.name })),
      ];
    }
    if (picker.kind === 'prev-type') {
      return [
        { value: '', label: '全部' },
        ...Object.entries(IMPORT_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v })),
      ];
    }
    if (picker.kind === 'prev-cat') {
      return [{ value: '', label: '全部' }, ...previewCategories.map((c) => ({ value: c, label: c }))];
    }
    if (picker.kind === 'prev-acct') {
      return [{ value: '', label: '全部' }, ...previewAccounts.map((a) => ({ value: a, label: a }))];
    }
    return [];
  })();

  const onPickerSelect = (value: string) => {
    if (!picker) return;
    const key = picker.key;
    if (picker.kind === 'column' && key) {
      setColumnMapping((p) => ({ ...p, [key as ImportColumnField]: value }));
    } else if (picker.kind === 'type-value' && key) {
      setTypeMapping((p) => ({ ...p, [key]: value }));
    } else if (picker.kind === 'acct-type' && key) {
      setAccountRes((p) => {
        const res = p[key];
        return res?.action === 'create' ? { ...p, [key]: { ...res, type: value } } : p;
      });
    } else if (picker.kind === 'account' && key) {
      setAccountRes((p) => ({ ...p, [key]: { action: 'existing', accountId: value } }));
    } else if (picker.kind === 'category' && key) {
      setCategoryRes((p) => ({ ...p, [key]: { ...p[key], targetCode: value } }));
    } else if (picker.kind === 'unrec-type' && key !== undefined) {
      setUnrecognizedRes((p) => ({ ...p, [Number(key)]: { ...p[Number(key)], type: value, categoryCode: '' } }));
    } else if (picker.kind === 'unrec-acct' && key !== undefined) {
      setUnrecognizedRes((p) => ({ ...p, [Number(key)]: { ...p[Number(key)], accountId: value } }));
    } else if (picker.kind === 'unrec-cat' && key !== undefined) {
      setUnrecognizedRes((p) => ({ ...p, [Number(key)]: { ...p[Number(key)], categoryCode: value } }));
    } else if (picker.kind === 'owner') {
      handleOwnerChange(value);
    } else if (picker.kind === 'prev-type') {
      setPrevFilterType(value);
    } else if (picker.kind === 'prev-cat') {
      setPrevFilterCategory(value);
    } else if (picker.kind === 'prev-acct') {
      setPrevFilterAccount(value);
    }
  };

  const pickerTitle =
    picker?.kind === 'column' ? `选择「${IMPORT_COLUMN_FIELDS.find((f) => f.key === picker.key)?.label}」对应的列`
    : picker?.kind === 'type-value' ? '映射为收支类型'
    : picker?.kind === 'acct-type' ? '账户类型'
    : picker?.kind === 'account' ? '选择已有账户'
    : picker?.kind === 'category' ? '选择目标分类'
    : picker?.kind === 'unrec-type' ? '记录类型'
    : picker?.kind === 'unrec-acct' ? '选择账户'
    : picker?.kind === 'unrec-cat' ? '选择分类'
    : picker?.kind === 'prev-type' ? '按类型筛选'
    : picker?.kind === 'prev-cat' ? '按原始分类筛选'
    : picker?.kind === 'prev-acct' ? '按账户筛选'
    : '选择归属人';

  const STEP_TITLE: Record<Step, string> = {
    source: '导入 · 选择来源',
    upload: '导入 · 上传文件',
    columnMapping: '导入 · 列映射',
    preview: '导入 · 预览处理',
    confirm: '导入 · 确认',
    result: '导入 · 完成',
  };

  const fieldLabel = (key: string) => IMPORT_COLUMN_FIELDS.find((f) => f.key === key)?.label ?? key;

  return (
    <>
      <FormSheet visible={visible} title={STEP_TITLE[step]} onClose={handleClose}>
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
          {error ? (
            <View style={{ padding: 10, borderRadius: 10, backgroundColor: alpha(colors.expense, 0.1), marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: colors.expense }}>{error}</Text>
            </View>
          ) : null}

          {/* ── Step 1: 来源 ── */}
          {step === 'source' &&
            IMPORT_SOURCE_DEFS.map((def) => {
              const selected = source === def.key;
              return (
                <Pressable
                  key={def.key}
                  onPress={() => {
                    setSource(def.key);
                    haptics.tap();
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 14,
                    borderRadius: 14,
                    borderWidth: 1.5,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? alpha(colors.primary, 0.08) : colors.card,
                    marginBottom: 10,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600' }}>{def.label}</Text>
                    <Text variant="muted" style={{ fontSize: 11, marginTop: 2 }}>{def.description}</Text>
                  </View>
                  {selected ? <CheckCircle2 size={20} color={colors.primary} /> : null}
                </Pressable>
              );
            })}

          {/* ── Step 2: 上传 ── */}
          {step === 'upload' ? (
            <>
              <Pressable
                onPress={handlePickFile}
                style={{
                  paddingVertical: 30,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderStyle: 'dashed',
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 12,
                }}
              >
                <FileText size={30} color={colors.mutedForeground} style={{ marginBottom: 8 }} />
                {file ? (
                  <>
                    <Text style={{ fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{file.name}</Text>
                    <Text variant="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      {(file.size / 1024).toFixed(1)} KB · 点击重新选择
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={{ fontSize: 13, fontWeight: '600' }}>点击选择{source === 'wechat' ? ' Excel' : ' CSV'} 文件</Text>
                    <Text variant="muted" style={{ fontSize: 11, marginTop: 4 }}>支持 {source === 'wechat' ? '.xlsx' : '.csv'} 格式,最大 10MB</Text>
                  </>
                )}
              </Pressable>
              <Text variant="muted" style={{ fontSize: 11, marginBottom: 12 }}>
                {source === 'csv' ? '开始解析后需配置列映射' : '将使用内置解析器自动识别账单格式'}
              </Text>
            </>
          ) : null}

          {/* ── Step 3: 列映射(仅 CSV) ── */}
          {step === 'columnMapping' ? (
            <>
              <Text variant="muted" style={{ fontSize: 11, marginBottom: 10 }}>
                {file?.name} · {csvTotalRows} 行数据 · {csvHeaders.length} 列
              </Text>
              <Text variant="muted" style={{ fontSize: 12, marginBottom: 6 }}>表头行号(留空自动检测)</Text>
              <TextInput
                value={headerRow}
                onChangeText={setHeaderRow}
                keyboardType="number-pad"
                placeholder="自动检测"
                placeholderTextColor={colors.mutedForeground}
                style={{
                  height: 42,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  paddingHorizontal: 12,
                  fontSize: 14,
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  marginBottom: 6,
                }}
              />
              <Pressable
                onPress={handleAnalyze}
                style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.muted, marginBottom: 14, marginTop: 6 }}
              >
                <Text style={{ fontSize: 12, color: colors.foreground }}>重新分析</Text>
              </Pressable>

              <Text variant="muted" style={{ fontSize: 12, marginBottom: 6 }}>系统字段映射</Text>
              {IMPORT_COLUMN_FIELDS.map((f) => (
                <Pressable
                  key={f.key}
                  onPress={() => {
                    setPicker({ kind: 'column', key: f.key });
                    haptics.tap();
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 11,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: columnMapping[f.key] ? colors.primary : colors.border,
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ fontSize: 13, flex: 1 }}>
                    {f.required ? <Text style={{ color: colors.expense }}>* </Text> : null}
                    {f.label}
                  </Text>
                  <Text style={{ fontSize: 12, color: columnMapping[f.key] ? colors.primary : colors.mutedForeground }} numberOfLines={1}>
                    {columnMapping[f.key] || '未选择'}
                  </Text>
                  <ChevronDown size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
                </Pressable>
              ))}

              {/* 类型值映射 */}
              {columnMapping.type ? (
                <>
                  <Text variant="muted" style={{ fontSize: 12, marginVertical: 6 }}>收支类型值映射</Text>
                  {detectTypeValues(columnMapping.type, csvSampleRows).map((v) => (
                    <View key={v} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Text style={{ fontSize: 13, flex: 1 }} numberOfLines={1}>{v}</Text>
                      {!typeMapping[v] ? (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: alpha('#f59e0b', 0.15) }}>
                          <Text style={{ fontSize: 10, color: '#f59e0b' }}>未映射</Text>
                        </View>
                      ) : null}
                      <ChipSelect
                        value={typeMapping[v] ?? ''}
                        onChange={(val) => setTypeMapping((p) => ({ ...p, [v]: val }))}
                        options={[
                          { value: 'EXPENSE', label: '支出' },
                          { value: 'INCOME', label: '收入' },
                          { value: 'TRANSFER', label: '转账' },
                        ]}
                      />
                    </View>
                  ))}
                </>
              ) : null}

              {/* 样本预览 */}
              <Text variant="muted" style={{ fontSize: 12, marginVertical: 6 }}>数据预览(前 {Math.min(5, csvSampleRows.length)} 行)</Text>
              {csvSampleRows.map((row, i) => (
                <View key={i} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.hairline }}>
                  <Text variant="muted" style={{ fontSize: 10 }} numberOfLines={2}>
                    {Object.values(row).filter(Boolean).join(' | ')}
                  </Text>
                </View>
              ))}
            </>
          ) : null}

          {/* ── Step 4: 预览处理 ── */}
          {step === 'preview' && preview ? (
            <>
              {/* 统计摘要 */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {[
                  { label: '解析成功', value: preview.stats.parsedRows, color: colors.income },
                  { label: '跳过', value: preview.stats.skippedRows, color: colors.mutedForeground },
                  {
                    label: '待处理',
                    value: preview.unmatchedAccounts.length + preview.unmatchedCategories.length + preview.unrecognizedRecords.length,
                    color: '#f59e0b',
                  },
                ].map((s) => (
                  <View key={s.label} style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: colors.muted, alignItems: 'center' }}>
                    <Text style={{ fontSize: 18, fontWeight: '700' }}>{s.value}</Text>
                    <Text variant="muted" style={{ fontSize: 10, marginTop: 2 }}>{s.label}</Text>
                  </View>
                ))}
              </View>

              {preview.stats.errors.length > 0 ? (
                <View style={{ padding: 10, borderRadius: 10, backgroundColor: colors.muted, marginBottom: 12 }}>
                  <Text variant="muted" style={{ fontSize: 11 }}>
                    {preview.stats.errors.length} 条被跳过: {preview.stats.errors.slice(0, 3).join('; ')}
                    {preview.stats.errors.length > 3 ? ' …' : ''}
                  </Text>
                </View>
              ) : null}

              {/* 已匹配账户 */}
              {Object.keys(preview.accountMappings ?? {}).length > 0 ? (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', marginBottom: 6, color: colors.income }}>
                    已匹配的账户 ({Object.keys(preview.accountMappings ?? {}).length})
                  </Text>
                  {Object.entries(preview.accountMappings ?? {}).map(([csvName, targetName]) => (
                    <View key={csvName} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 12, fontWeight: '500' }} numberOfLines={1}>{csvName}</Text>
                      <Text variant="muted" style={{ fontSize: 12 }}>→</Text>
                      <Text style={{ fontSize: 12, color: colors.income }} numberOfLines={1}>{targetName}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* 未匹配账户 */}
              {preview.unmatchedAccounts.length > 0 ? (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', marginBottom: 4 }}>
                    未匹配的账户 ({preview.unmatchedAccounts.length})
                  </Text>
                  <Text variant="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                    同一账户可能有多个名称变体,设为相同名称即可合并为一个账户
                  </Text>
                  {preview.unmatchedAccounts.map((ua) => {
                    const res = accountRes[ua.csvName];
                    return (
                      <View key={ua.csvName} style={{ padding: 10, borderRadius: 12, backgroundColor: colors.muted, marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <Text style={{ fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>{ua.csvName}</Text>
                          <Pressable
                            onPress={() => {
                              setAccountRes((p) =>
                                res?.action === 'create'
                                  ? { ...p, [ua.csvName]: { action: 'existing', accountId: ownerPool[0]?.id ?? '' } }
                                  : { ...p, [ua.csvName]: { action: 'create', name: ua.suggestedName, type: ua.suggestedType || 'OTHER' } },
                              );
                              haptics.tap();
                            }}
                            style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
                          >
                            <Text style={{ fontSize: 11, color: colors.foreground }}>
                              {res?.action === 'create' ? '用已有' : '新建'}
                            </Text>
                          </Pressable>
                        </View>
                        {res?.action === 'create' ? (
                          <View style={{ gap: 6 }}>
                            <TextInput
                              value={res.name}
                              onChangeText={(t) =>
                                setAccountRes((p) => {
                                  const cur = p[ua.csvName];
                                  return cur?.action === 'create' ? { ...p, [ua.csvName]: { ...cur, name: t } } : p;
                                })
                              }
                              placeholder="账户名称"
                              placeholderTextColor={colors.mutedForeground}
                              style={{ height: 38, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, fontSize: 12, color: colors.foreground, backgroundColor: colors.card }}
                            />
                            <Pressable
                              onPress={() => setPicker({ kind: 'acct-type', key: ua.csvName })}
                              style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                            >
                              <Text style={{ fontSize: 12 }} numberOfLines={1}>
                                {ACCOUNT_TYPE_LABELS[res.type as keyof typeof ACCOUNT_TYPE_LABELS] ?? res.type}
                              </Text>
                              <ChevronDown size={12} color={colors.mutedForeground} />
                            </Pressable>
                          </View>
                        ) : (
                          <Pressable
                            onPress={() => setPicker({ kind: 'account', key: ua.csvName })}
                            style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                          >
                            <Text style={{ fontSize: 12, color: (res as any)?.accountId ? colors.foreground : colors.mutedForeground, flex: 1 }} numberOfLines={1}>
                              {(() => {
                                const a = accounts.find((x) => x.id === (res as any)?.accountId);
                                return a ? accountLabel(a, multiOwnerAccounts) : '选择已有账户...';
                              })()}
                            </Text>
                            <ChevronDown size={12} color={colors.mutedForeground} />
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {/* 未映射分类 */}
              {preview.unmatchedCategories.length > 0 ? (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', marginBottom: 4 }}>
                    未映射的分类 ({preview.unmatchedCategories.length})
                  </Text>
                  <Text variant="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                    为源分类选择目标系统分类;勾选保存后,后续导入自动映射
                  </Text>
                  {preview.unmatchedCategories.map((uc) => {
                    const key = `${uc.sourceCategory}::${uc.types[0] ?? 'EXPENSE'}`;
                    const cr = categoryRes[key];
                    const typeLabel = IMPORT_TYPE_LABELS[uc.types[0] as keyof typeof IMPORT_TYPE_LABELS] ?? uc.types[0] ?? '支出';
                    const typeColor = semanticTypeColor(colors, uc.types[0], colors.mutedForeground);
                    return (
                      <View key={key} style={{ padding: 10, borderRadius: 12, backgroundColor: colors.muted, marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <Text style={{ fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>{uc.sourceCategory}</Text>
                          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: alpha(typeColor, 0.12) }}>
                            <Text style={{ fontSize: 10, color: typeColor }}>{typeLabel}</Text>
                          </View>
                        </View>
                        <View style={{ gap: 6, marginBottom: 6 }}>
                          <TextInput
                            value={cr?.payerContains ?? ''}
                            onChangeText={(t) => setCategoryRes((p) => ({ ...p, [key]: { ...p[key], payerContains: t } }))}
                            placeholder="交易方包含(选填,命中才使用该规则)"
                            placeholderTextColor={colors.mutedForeground}
                            style={{ height: 38, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, fontSize: 12, color: colors.foreground, backgroundColor: colors.card }}
                          />
                          <TextInput
                            value={cr?.descriptionContains ?? ''}
                            onChangeText={(t) => setCategoryRes((p) => ({ ...p, [key]: { ...p[key], descriptionContains: t } }))}
                            placeholder="说明包含(选填)"
                            placeholderTextColor={colors.mutedForeground}
                            style={{ height: 38, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, fontSize: 12, color: colors.foreground, backgroundColor: colors.card }}
                          />
                        </View>
                        <Pressable
                          onPress={() => setPicker({ kind: 'category', key })}
                          style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: cr?.targetCode ? colors.primary : colors.border, flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}
                        >
                          <Text style={{ fontSize: 12, color: cr?.targetCode ? colors.primary : colors.mutedForeground, flex: 1 }} numberOfLines={1}>
                            {allDictItems.find((d) => d.code === cr?.targetCode)?.label ?? '选择目标分类'}
                          </Text>
                          <ChevronDown size={12} color={colors.mutedForeground} />
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setCategoryRes((p) => ({ ...p, [key]: { ...p[key], save: !p[key]?.save } }));
                            haptics.tap();
                          }}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                        >
                          <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: cr?.save ? colors.primary : colors.border, backgroundColor: cr?.save ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                            {cr?.save ? <Check size={12} color={colors.primaryForeground} /> : null}
                          </View>
                          <Text variant="muted" style={{ fontSize: 11 }}>保存为映射规则</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {/* 未识别记录 */}
              {preview.unrecognizedRecords.length > 0 ? (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', marginBottom: 4 }}>
                    需手动处理的记录 ({preview.unrecognizedRecords.length})
                  </Text>
                  <Text variant="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                    无法自动识别类型,请设置类型/账户/分类;未设置的将被跳过
                  </Text>
                  {preview.unrecognizedRecords.map((r) => {
                    const res = unrecognizedRes[r.rowIndex ?? -1];
                    const isResolved = !!(res?.type && res?.accountId);
                    return (
                      <View
                        key={r.rowIndex}
                        style={{
                          padding: 10,
                          borderRadius: 12,
                          borderWidth: 1,
                          marginBottom: 8,
                          borderColor: isResolved ? alpha(colors.income, 0.4) : alpha('#f59e0b', 0.5),
                          backgroundColor: isResolved ? alpha(colors.income, 0.05) : colors.muted,
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <Text style={{ fontSize: 13, fontWeight: '700' }}>{r.amount.toFixed(2)}</Text>
                          {r.accountName ? <Text variant="muted" style={{ fontSize: 11 }} numberOfLines={1}>{r.accountName}</Text> : null}
                          {r.payer ? <Text variant="muted" style={{ fontSize: 11, marginLeft: 'auto' }} numberOfLines={1}>{r.payer}</Text> : null}
                        </View>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <Pressable onPress={() => setPicker({ kind: 'unrec-type', key: String(r.rowIndex) })} style={{ ...pickerBtnStyle }}>
                            <Text style={{ fontSize: 11, color: res?.type ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>
                              {res?.type ? IMPORT_TYPE_LABELS[res.type as keyof typeof IMPORT_TYPE_LABELS] ?? res.type : '类型'}
                            </Text>
                            <ChevronDown size={10} color={colors.mutedForeground} />
                          </Pressable>
                          <Pressable onPress={() => setPicker({ kind: 'unrec-acct', key: String(r.rowIndex) })} style={{ ...pickerBtnStyle, flex: 1 }}>
                            <Text style={{ fontSize: 11, color: res?.accountId ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>
                              {(() => {
                                const a = accounts.find((x) => x.id === res?.accountId);
                                return a ? accountLabel(a, multiOwnerAccounts) : '账户';
                              })()}
                            </Text>
                            <ChevronDown size={10} color={colors.mutedForeground} />
                          </Pressable>
                          <Pressable onPress={() => setPicker({ kind: 'unrec-cat', key: String(r.rowIndex) })} style={{ ...pickerBtnStyle, flex: 1 }}>
                            <Text style={{ fontSize: 11, color: res?.categoryCode ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>
                              {allDictItems.find((d) => d.code === res?.categoryCode)?.label ?? '分类'}
                            </Text>
                            <ChevronDown size={10} color={colors.mutedForeground} />
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {/* 记录预览(类型/原始分类/账户筛选,同 web) */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', flex: 1 }}>
                  记录预览 ({filteredPreview.length}{filteredPreview.length !== preview.records.length ? ` / 共 ${preview.records.length}` : ''} 条)
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {([
                  { kind: 'prev-type', active: !!prevFilterType, label: `类型: ${prevFilterType ? IMPORT_TYPE_LABELS[prevFilterType as keyof typeof IMPORT_TYPE_LABELS] : '全部'}` },
                  { kind: 'prev-cat', active: !!prevFilterCategory, label: `分类: ${prevFilterCategory || '全部'}` },
                  { kind: 'prev-acct', active: !!prevFilterAccount, label: `账户: ${prevFilterAccount || '全部'}` },
                ] as const).map((f) => (
                  <Pressable
                    key={f.kind}
                    onPress={() => {
                      setPicker({ kind: f.kind });
                      haptics.tap();
                    }}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
                      borderWidth: 1,
                      borderColor: f.active ? colors.primary : colors.border,
                      backgroundColor: f.active ? alpha(colors.primary, 0.08) : colors.card,
                    }}
                  >
                    <Text style={{ fontSize: 11, color: f.active ? colors.primary : colors.mutedForeground }} numberOfLines={1}>{f.label}</Text>
                    <ChevronDown size={10} color={colors.mutedForeground} />
                  </Pressable>
                ))}
              </View>
              {(showAllRecords ? filteredPreview : filteredPreview.slice(0, 30)).map((r, i) => (
                <RecordPreviewRow key={r.rowIndex ?? i} r={r} />
              ))}
              {filteredPreview.length > 30 ? (
                <Pressable
                  onPress={() => {
                    setShowAllRecords((v) => !v);
                    haptics.tap();
                  }}
                  style={{ paddingVertical: 8, alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 12, color: colors.primary }}>{showAllRecords ? '收起' : `查看全部 ${filteredPreview.length} 条`}</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          {/* ── Step 5: 确认 ── */}
          {step === 'confirm' ? <ConfirmStep /> : null}

          {/* ── Step 6: 结果 ── */}
          {step === 'result' && importResult ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: alpha(colors.income, 0.12), alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <CheckCircle2 size={34} color={colors.income} />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '700' }}>成功导入 {importResult.imported} 条记录</Text>
              {importResult.accountsCreated > 0 ? (
                <Text variant="muted" style={{ fontSize: 13, marginTop: 6 }}>同时创建了 {importResult.accountsCreated} 个新账户</Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        {/* 底部按钮 */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          {step !== 'source' && step !== 'result' ? (
            <Pressable
              onPress={() => {
                setError('');
                setStep(step === 'confirm' ? 'preview' : step === 'preview' ? (source === 'csv' ? 'columnMapping' : 'upload') : step === 'columnMapping' ? 'upload' : 'source');
              }}
              style={{ flex: 1, height: 46, borderRadius: palette.radius.button, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '500' }}>上一步</Text>
            </Pressable>
          ) : null}

          {step === 'source' ? (
            <PrimaryBtn label="下一步" onPress={() => goUpload(source)} />
          ) : null}
          {step === 'upload' ? (
            <PrimaryBtn
              label={loading ? '解析中...' : source === 'csv' ? '分析文件' : '开始解析'}
              loading={loading}
              disabled={!file || loading}
              onPress={() => (source === 'csv' ? handleAnalyze() : handleParse())}
            />
          ) : null}
          {step === 'columnMapping' ? (
            <PrimaryBtn
              label={loading ? '解析中...' : '开始解析'}
              loading={loading}
              disabled={loading || !isColumnMappingValid(columnMapping as any)}
              onPress={handleParse}
            />
          ) : null}
          {step === 'preview' ? (
            <PrimaryBtn
              label="下一步:确认导入"
              disabled={(preview?.records.length ?? 0) === 0 && (preview?.unrecognizedRecords ?? []).every((r) => {
                const res = unrecognizedRes[r.rowIndex ?? -1];
                return !(res?.type && res?.accountId);
              })}
              onPress={() => {
                setStep('confirm');
                haptics.tap();
              }}
            />
          ) : null}
          {step === 'confirm' ? (
            <PrimaryBtn label={loading ? '导入中...' : `确认导入 ${buildImportData().allCount} 条`} loading={loading} onPress={handleConfirm} />
          ) : null}
          {step === 'result' ? <PrimaryBtn label="完成" onPress={handleClose} /> : null}
        </View>
      </FormSheet>

      <OptionPickerSheet
        visible={!!picker && picker.kind !== 'owner'}
        title={pickerTitle}
        options={pickerOptions}
        onClose={() => setPicker(null)}
        onSelect={onPickerSelect}
      />
      {/* 归属人选择(preview→confirm 阶段) */}
      <OptionPickerSheet
        visible={picker?.kind === 'owner'}
        title="选择归属人"
        options={pickerOptions}
        onClose={() => setPicker(null)}
        onSelect={onPickerSelect}
      />
    </>
  );

  function PrimaryBtn({ label, onPress, loading, disabled }: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean }) {
    return (
      <Pressable
        onPress={() => {
          if (!disabled && !loading) {
            haptics.tap();
            onPress();
          }
        }}
        disabled={disabled || loading}
        style={{
          flex: 1.4,
          height: 46,
          borderRadius: palette.radius.button,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          opacity: disabled || loading ? 0.5 : 1,
        }}
      >
        {loading ? <ActivityIndicator color={colors.primaryForeground} /> : (
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.primaryForeground }}>{label}</Text>
        )}
      </Pressable>
    );
  }

  /** 确认页(将创建账户 + 归属人 + 收支概览 + 记录列表) */
  function ConfirmStep() {
    const { payload, allCount, displayRecords } = buildImportData();
    const records = displayRecords;
    const income = records.filter((r) => r.type === 'INCOME');
    const expense = records.filter((r) => r.type === 'EXPENSE');
    const transfer = records.filter((r) => r.type === 'TRANSFER');
    const sum = (arr: typeof records) => arr.reduce((s, r) => s + r.amount, 0);

    return (
      <>
        {/* 将创建的账户 */}
        {payload.accountCreations && payload.accountCreations.length > 0 ? (
          <View style={{ marginBottom: 14 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
              将创建 {payload.accountCreations.length} 个新账户:
            </Text>
            {payload.accountCreations.map((ac) => (
              <View key={ac.csvName} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 }}>
                <Text style={{ fontSize: 12, fontWeight: '500' }}>{ac.name}</Text>
                <Text variant="muted" style={{ fontSize: 11 }} numberOfLines={1}>({ac.csvName})</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* 归属人 */}
        <Text variant="muted" style={{ fontSize: 12, marginBottom: 6 }}>归属人</Text>
        <Pressable onPress={() => setPicker({ kind: 'owner' })} style={{ ...pickerBtnStyle, marginBottom: 14, paddingVertical: 12 }}>
          <Text style={{ fontSize: 13, flex: 1 }}>
            {selectedOwnerId === '__self__' ? '本人(默认)' : bookMembers.find((m) => m.userId === selectedOwnerId)?.name ?? selectedOwnerId}
          </Text>
          <ChevronDown size={14} color={colors.mutedForeground} />
        </Pressable>

        {/* 收支概览 */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {[
            { label: '收入', count: income.length, sum: sum(income), color: colors.income },
            { label: '支出', count: expense.length, sum: sum(expense), color: colors.expense },
            { label: '转账', count: transfer.length, sum: sum(transfer), color: colors.transfer },
          ].map((s) => (
            <View key={s.label} style={{ flex: 1, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
              <Text variant="muted" style={{ fontSize: 10 }}>{s.label}</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: s.color, marginTop: 2 }}>{s.count} 条</Text>
              <Text style={{ fontSize: 10, color: s.color }}>{s.sum.toFixed(2)}</Text>
            </View>
          ))}
        </View>

        {/* 记录列表(行渲染同预览) */}
        <Text variant="muted" style={{ fontSize: 11, marginBottom: 6 }}>将导入 {allCount} 条流水记录:</Text>
        {(confirmShowAll ? records : records.slice(0, 50)).map((r, i) => (
          <RecordPreviewRow key={r.rowIndex ?? i} r={r} />
        ))}
        {records.length > 50 ? (
          <Pressable
            onPress={() => {
              setConfirmShowAll((v) => !v);
              haptics.tap();
            }}
            style={{ paddingVertical: 8, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 12, color: colors.primary }}>{confirmShowAll ? '收起' : `查看全部 ${records.length} 条`}</Text>
          </Pressable>
        ) : null}
      </>
    );
  }
}

const pickerBtnStyle = {
  paddingHorizontal: 10,
  paddingVertical: 8,
  borderRadius: 10,
  borderWidth: 1,
  alignItems: 'center',
  flexDirection: 'row',
  gap: 4,
} as const;

/** 单条记录预览行 */
function RecordPreviewRow({ r }: { r: ParsedImportRow }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.hairline }}>
      <Text style={{ fontSize: 11, color: semanticTypeColor(colors, r.type), width: 28 }}>
        {IMPORT_TYPE_LABELS[r.type as keyof typeof IMPORT_TYPE_LABELS] ?? r.type}
      </Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12 }} numberOfLines={1}>
          {r.accountName || '-'}
          {r.payer ? ` · ${r.payer}` : ''}
        </Text>
        <Text variant="muted" style={{ fontSize: 10, marginTop: 1 }} numberOfLines={1}>
          {r.date.replace('T', ' ').slice(0, 16)}
          {r.categoryCode ? ` · ${r.categoryCode}` : ''}
          {r.mappedCategoryCode ? ` → ${r.mappedCategoryCode}` : ''}
          {r.remark ? ` · ${r.remark}` : ''}
        </Text>
      </View>
      <Text style={{ fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'], color: semanticTypeColor(colors, r.type) }}>
        {r.type === 'EXPENSE' ? '-' : r.type === 'INCOME' ? '+' : ''}{r.amount.toFixed(2)}
      </Text>
    </View>
  );
}
