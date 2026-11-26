import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { RefreshCw } from 'lucide-react-native';
import {
  BACKUP_FREQUENCY_LABELS,
  BACKUP_SCHEDULES,
  BACKUP_TRIGGER_LABELS,
  RETENTION_OPTIONS,
  createDefaultBackupSettings,
  describeBackupScope,
  formatBytes,
  type BackupSettings,
  type BackupSnapshotMeta,
} from '@homibook/core';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/stores/auth';
import { useConfirm } from '@/components/chrome/ConfirmSheet';
import { showToast } from '@/components/chrome/Toast';
import { backupApi } from '@/services/backup';
import { Btn, Chips, ErrorText, Field } from './shared';

const ON_OFF = [{ value: 'on', label: '已开启' }, { value: 'off', label: '已关闭' }];

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function triggerLabel(meta: BackupSnapshotMeta): string {
  return meta.trigger === 'SCHEDULED' && meta.schedule
    ? `${BACKUP_FREQUENCY_LABELS[meta.schedule]}定时`
    : BACKUP_TRIGGER_LABELS[meta.trigger];
}

// 备份与还原(服务端快照):全量备份、每天/每周/每月定期备份、随时还原
export function BackupSettingsPanel() {
  const { colors } = useTheme();
  const { logout } = useAuth();
  const confirm = useConfirm();

  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [schedules, setSchedules] = useState<BackupSettings['schedules']>(
    () => createDefaultBackupSettings().schedules,
  );
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const [snapshots, setSnapshots] = useState<BackupSnapshotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const [error, setError] = useState('');

  const loadSnapshots = (silent = false) => {
    if (!silent) setRefreshing(true);
    backupApi.listSnapshots()
      .then(setSnapshots)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载备份记录失败'))
      .finally(() => {
        setRefreshing(false);
        setLoading(false);
      });
  };

  useEffect(() => {
    backupApi.getSettings()
      .then((s) => {
        setIncludeAttachments(s.includeAttachments);
        setSchedules(s.schedules);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载备份设置失败'));
    loadSnapshots(true);
  }, []);

  const patchSchedule = (key: keyof BackupSettings['schedules'], patch: { enabled?: boolean; retention?: number }) => {
    setSchedules((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const saveSettings = async () => {
    setSaving(true);
    setError('');
    try {
      const next = await backupApi.updateSettings({
        includeAttachments,
        schedules: {
          daily: { enabled: schedules.daily.enabled, retention: schedules.daily.retention },
          weekly: { enabled: schedules.weekly.enabled, retention: schedules.weekly.retention },
          monthly: { enabled: schedules.monthly.enabled, retention: schedules.monthly.retention },
        },
      });
      setIncludeAttachments(next.includeAttachments);
      setSchedules(next.schedules);
      showToast('备份设置已保存');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存备份设置失败');
    } finally {
      setSaving(false);
    }
  };

  const createBackup = async () => {
    setBackingUp(true);
    setError('');
    try {
      const meta = await backupApi.createSnapshot({ includeAttachments });
      setSnapshots((prev) => [meta, ...prev]);
      showToast(`备份完成,共 ${formatBytes(meta.size)}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '备份失败');
    } finally {
      setBackingUp(false);
    }
  };

  const removeSnapshot = (meta: BackupSnapshotMeta) => {
    confirm({
      title: '删除备份',
      message: `确定删除 ${formatTime(meta.createdAt)} 的备份?删除后无法恢复。`,
      onConfirm: async () => {
        try {
          await backupApi.deleteSnapshot(meta.id);
          setSnapshots((prev) => prev.filter((s) => s.id !== meta.id));
          showToast('备份已删除');
        } catch (e: unknown) {
          showToast(e instanceof Error ? e.message : '删除失败');
        }
      },
    });
  };

  const restore = (meta: BackupSnapshotMeta) => {
    confirm({
      title: '从备份恢复',
      message: `将清空当前全部数据并恢复 ${formatTime(meta.createdAt)} 的备份,恢复前会自动创建一份安全备份。恢复完成后需要重新登录。`,
      confirmLabel: '确认恢复',
      onConfirm: async () => {
        setRestoringId(meta.id);
        setError('');
        try {
          const res = await backupApi.restoreSnapshot(meta.id, { safetyBackup: true });
          showToast(res.safetySnapshotId ? '恢复完成,已创建安全备份' : '恢复完成,请重新登录');
          await logout();
          router.replace('/(auth)/login');
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : '恢复失败');
          setRestoringId(null);
        }
      },
    });
  };

  const divider = <View style={{ height: 1, backgroundColor: colors.hairline }} />;

  return (
    <View style={{ gap: 14 }}>
      <ErrorText msg={error} />

      <Field label="包含附件文件">
        <Chips
          options={ON_OFF}
          value={includeAttachments ? 'on' : 'off'}
          onChange={(v) => setIncludeAttachments(v === 'on')}
        />
      </Field>

      {divider}

      <Text style={{ fontSize: 13.5, fontWeight: '500' }}>定期备份</Text>

      {BACKUP_SCHEDULES.map((preset) => {
        const state = schedules[preset.key];
        return (
          <View
            key={preset.key}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 10 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '500' }}>{preset.label}</Text>
                <Text variant="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{preset.timeLabel}</Text>
              </View>
              <Chips
                options={ON_OFF}
                value={state.enabled ? 'on' : 'off'}
                onChange={(v) => patchSchedule(preset.key, { enabled: v === 'on' })}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text variant="muted" style={{ fontSize: 11.5 }}>保留</Text>
              <Chips
                options={RETENTION_OPTIONS.map((n) => ({ value: String(n), label: `${n} 份` }))}
                value={String(state.retention)}
                onChange={(v) => patchSchedule(preset.key, { retention: Number(v) })}
              />
            </View>

            <Text variant="muted" style={{ fontSize: 11.5, lineHeight: 17 }}>
              上次:{formatTime(state.lastRunAt)}
              {state.lastResult ? (
                <Text style={{ fontSize: 11.5, color: state.lastResult.status === 'FAILED' ? colors.expense : colors.income }}>
                  {state.lastResult.status === 'FAILED' ? ' (失败)' : ' (成功)'}
                </Text>
              ) : null}
              {'  ·  下次:'}
              {state.enabled ? formatTime(state.nextRunAt) : '未启用'}
            </Text>
            {state.lastResult?.error ? (
              <Text style={{ fontSize: 11, color: colors.expense }}>{state.lastResult.error}</Text>
            ) : null}
          </View>
        );
      })}

      <Btn title="保存备份设置" onPress={saveSettings} loading={saving} />

      {divider}

      <View style={{ alignItems: 'flex-end' }}>
        <View style={{ width: 120 }}>
          <Btn title="立即备份" onPress={createBackup} loading={backingUp} />
        </View>
      </View>

      {divider}

      {/* 备份记录 */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13.5, fontWeight: '500' }}>备份记录</Text>
          <Text variant="muted" style={{ fontSize: 11.5, marginTop: 2 }}>保存在服务器 backups 目录,可随时还原</Text>
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => loadSnapshots()}
          disabled={refreshing}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border }}
        >
          <RefreshCw size={13} color={colors.primary} />
          <Text style={{ fontSize: 12, color: colors.primary }}>{refreshing ? '刷新中' : '刷新'}</Text>
        </Pressable>
      </View>

      {loading ? (
        <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 12 }}>加载中...</Text>
      ) : snapshots.length === 0 ? (
        <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12 }}>
          还没有备份,先创建一个吧
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {snapshots.map((meta) => (
            <View key={meta.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '600' }}>{formatTime(meta.createdAt)}</Text>
                <View style={{
                  paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                  backgroundColor: meta.trigger === 'SAFETY' ? alpha(colors.expense, 0.12) : colors.muted,
                }}>
                  <Text style={{
                    fontSize: 10.5,
                    color: meta.trigger === 'SAFETY' ? colors.expense : colors.mutedForeground,
                    fontWeight: '600',
                  }}>
                    {triggerLabel(meta)}
                  </Text>
                </View>
                <Text variant="muted" style={{ fontSize: 11 }}>{formatBytes(meta.size)}</Text>
              </View>
              <Text variant="muted" style={{ fontSize: 11.5 }}>{describeBackupScope(meta.scope)}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Btn
                    title="恢复"
                    variant="secondary"
                    onPress={() => restore(meta)}
                    loading={restoringId === meta.id}
                    disabled={restoringId !== null && restoringId !== meta.id}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Btn
                    title="删除"
                    variant="danger"
                    onPress={() => removeSnapshot(meta)}
                    disabled={restoringId !== null}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 提示:恢复会清空全部数据,确认弹窗已上提到页面层 ConfirmProvider */}
      <Text variant="muted" style={{ fontSize: 11, lineHeight: 16 }}>
        恢复会覆盖当前全部数据,请谨慎操作;恢复前建议保留一份较新的备份。
      </Text>
    </View>
  );
}
