import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';
import { FormSheet } from '@/components/chrome/FormSheet';
import { fetchAuditLogs } from '@/services/admin';
import type { AuditAction, AuditLogItem } from '@/types';

const ACTION_LABEL: Record<AuditAction, string> = {
  tool_call: '工具调用',
  model_call: '模型调用',
  confirm: '用户确认',
  reject: '用户拒绝',
};

const PAGE_SIZE = 5;

// AI 审计:筛选 + 日志列表 + 详情 + 分页(设计优先 mock)
export default function AIAuditScreen() {
  const { colors } = useTheme();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [user, setUser] = useState('全部');
  const [action, setAction] = useState('全部');
  const [status, setStatus] = useState('全部');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditLogItem | null>(null);

  useEffect(() => {
    fetchAuditLogs().then(setLogs);
  }, []);

  const users = useMemo(() => ['全部', ...Array.from(new Set(logs.map((l) => l.userNickname)))], [logs]);

  const filtered = useMemo(() => {
    return logs.filter((l) => (user === '全部' || l.userNickname === user) && (action === '全部' || l.action === action) && (status === '全部' || l.status === status));
  }, [logs, user, action, status]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const pageItems = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);

  const reset = () => {
    setUser('全部');
    setAction('全部');
    setStatus('全部');
    setPage(1);
  };

  const chip = (value: string, active: string, onPress: () => void, key: string) => {
    const isOn = value === active;
    return (
      <Pressable key={key} onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: isOn ? colors.primary : colors.border, backgroundColor: isOn ? colors.primary : colors.muted }}>
        <Text style={{ fontSize: 12, color: isOn ? '#fff' : colors.foreground, fontWeight: isOn ? '600' : '400' }}>{value}</Text>
      </Pressable>
    );
  };

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
        {/* 标题栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={{ fontSize: 20, fontWeight: '700' }}>AI 审计</Text>
          <Pressable onPress={reset} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
            <RotateCcw size={15} color={colors.foreground} />
          </Pressable>
        </View>

        {/* 筛选 */}
        <View style={{ marginBottom: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {users.map((u) => chip(u, user, () => setUser(u), `u${u}`))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {['全部', 'tool_call', 'model_call', 'confirm', 'reject'].map((a) => chip(a, action, () => setAction(a), `a${a}`))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {['全部', 'success', 'error'].map((s) => chip(s, status, () => setStatus(s), `s${s}`))}
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {pageItems.length === 0 ? (
            <Card className="items-center py-12">
              <Text style={{ fontSize: 30, marginBottom: 6 }}>🔍</Text>
              <Text variant="muted">无匹配审计记录</Text>
            </Card>
          ) : (
            pageItems.map((l, i) => {
              const ok = l.status === 'success';
              const actLabel = l.action === 'model_call' ? l.modelName ?? ACTION_LABEL[l.action] : ACTION_LABEL[l.action];
              return (
                <FadeInView key={l.id} index={i}>
                  <Card className="px-5 py-4 mb-3" onPress={() => setDetail(l)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600' }}>{actLabel}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ok ? colors.income : colors.expense }} />
                        <Text style={{ fontSize: 12, color: ok ? colors.income : colors.expense, fontWeight: '600' }}>{ok ? '成功' : '失败'}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text variant="muted" style={{ fontSize: 12 }}>
                        {l.userNickname} · {l.toolName ? l.toolName : l.modelName}
                      </Text>
                      <Text variant="muted" style={{ fontSize: 11, fontVariant: ['tabular-nums'] }}>
                        {l.createdAt}
                      </Text>
                    </View>
                    {(l.durationMs ?? 0) > 0 && <Text variant="muted" style={{ fontSize: 11, marginTop: 6 }}>耗时 {(l.durationMs ?? 0) / 1000}s</Text>}
                  </Card>
                </FadeInView>
              );
            })
          )}

          {/* 分页 */}
          {filtered.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 6 }}>
              <Pressable
                disabled={cur <= 1}
                onPress={() => setPage(cur - 1)}
                style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: cur <= 1 ? colors.muted : colors.muted, opacity: cur <= 1 ? 0.4 : 1 }}
              >
                <ChevronLeft size={15} color={colors.foreground} />
              </Pressable>
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontVariant: ['tabular-nums'] }}>{cur} / {pages} · 共 {filtered.length}</Text>
              <Pressable
                disabled={cur >= pages}
                onPress={() => setPage(cur + 1)}
                style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted, opacity: cur >= pages ? 0.4 : 1 }}
              >
                <ChevronRight size={15} color={colors.foreground} />
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>

      {/* 详情 */}
      <FormSheet visible={!!detail} title="审计详情" onClose={() => setDetail(null)}>
        {detail && (
          <View>
            <Row label="时间" value={detail.createdAt} />
            <Row label="用户" value={detail.userNickname} />
            <Row label="动作" value={ACTION_LABEL[detail.action]} />
            <Row label="工具/模型" value={detail.toolName ?? detail.modelName ?? '-'} />
            <Row label="状态" value={detail.status === 'success' ? '成功' : '失败'} color={detail.status === 'success' ? colors.income : colors.expense} />
            {(detail.durationMs ?? 0) > 0 && <Row label="耗时" value={`${(detail.durationMs ?? 0) / 1000}s`} />}
            {detail.errorMessage ? <Row label="错误" value={detail.errorMessage} color={colors.expense} /> : null}
            {detail.input ? <KV title="工具参数" json={detail.input} colors={colors} /> : null}
            {detail.output ? <KV title="返回值" json={detail.output} colors={colors} /> : null}
            <View style={{ height: 6 }} />
          </View>
        )}
      </FormSheet>
    </Screen>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
      <Text style={{ width: 72, fontSize: 13, color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 13, color: color ?? colors.foreground }}>{value}</Text>
    </View>
  );
}

function KV({ title, json, colors }: { title: string; json: string; colors: ReturnType<typeof import('@/theme').useTheme>['colors'] }) {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(json);
  } catch {
    obj = { raw: json };
  }
  const entries = Object.entries(obj);
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 6 }}>{title}</Text>
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.muted }}>
        {entries.map(([k, v]) => (
          <Text key={k} style={{ fontSize: 12, color: colors.foreground, marginBottom: 3 }}>
            <Text style={{ color: colors.mutedForeground }}>{k}: </Text>{String(v)}
          </Text>
        ))}
      </View>
    </View>
  );
}