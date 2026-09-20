import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BellRing, CheckCircle2, ChevronLeft, Lock, MessageSquareText, Sparkles, TriangleAlert, Zap } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';
import { FormSheet } from '@/components/chrome/FormSheet';
import { showToast } from '@/components/chrome/Toast';
import {
  clearPendingNotifications,
  hasSmsPermission,
  isNotificationAccessGranted,
  isTxnReaderSupported,
  openNotificationAccessSettings,
  openSmsPermissionSettings,
  requestSmsPermission,
} from '@/services/txn-reader';
import { clearProcessedSmsIds } from '@/services/sms-processed';
import { ensureNotificationPermission } from '@/services/notifications';
import { clearSmsAiCache, loadSmsAiSettings, saveSmsAiSettings, type SmsAiSettings } from '@/services/sms-ai';
import { clearSmsSenders } from '@/services/sms-senders';
import {
  AUTO_MIN_CONFIDENCE,
  clearAutoHistory,
  loadAutoHistory,
  loadAutoSettings,
  saveAutoSettings,
  type AutoBookkeepingSettings,
  type AutoHistoryEntry,
} from '@/services/sms-auto';

// 短信记账 · 权限与设置页(仅 Android):权限状态、通知使用权、自动记账开关与撤销、隐私说明、本机标记。

/** ISO 时间 → MM-DD HH:mm(按设备本地时区;避免依赖 Intl 的本地化差异) */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 权限状态行:已授权(主色对勾) / 未授权(警示) */
function StatusLine({ ok, okText, pendingText }: { ok: boolean; okText: string; pendingText: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {ok ? <CheckCircle2 size={15} color={colors.primary} /> : <TriangleAlert size={15} color={colors.expense} />}
      <Text style={{ fontSize: 13.5, fontWeight: '600', color: ok ? colors.primary : colors.expense }}>
        {ok ? okText : pendingText}
      </Text>
    </View>
  );
}

export default function SmsSettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const supported = isTxnReaderSupported;

  // 首帧即读真实权限状态(惰性初始化,避免在 effect 里 setState 触发级联渲染)
  const [smsGranted, setSmsGranted] = useState(hasSmsPermission);
  const [notifGranted, setNotifGranted] = useState(isNotificationAccessGranted);
  const [asking, setAsking] = useState(false);
  // 自动记账(默认关闭)与「最近一批」撤销入口
  const [auto, setAuto] = useState<AutoBookkeepingSettings>({ enabled: false, notify: true });
  // 最近自动入账记录(本机保留 50 条,列表里只展示最近 10 条)
  const [history, setHistory] = useState<AutoHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  // AI 兜底解析(默认关闭:开启后未识别正文才会离开设备)
  const [ai, setAi] = useState<SmsAiSettings>({ enabled: false });

  // 权限状态在系统弹窗/系统设置页里变化,回到前台时重新读取
  const refresh = useCallback(() => {
    setSmsGranted(hasSmsPermission());
    setNotifGranted(isNotificationAccessGranted());
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // 本机偏好与历史记录异步读取(在异步回调里 setState,避免 effect 内同步派发)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [settings, autoHistory, aiSettings] = await Promise.all([
        loadAutoSettings(),
        loadAutoHistory(),
        loadSmsAiSettings(),
      ]);
      if (!alive) return;
      setAuto(settings);
      setHistory(autoHistory);
      setAi(aiSettings);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const askSmsPermission = async () => {
    setAsking(true);
    try {
      const granted = await requestSmsPermission();
      setSmsGranted(granted);
      if (granted) {
        haptics.success();
        showToast('已获得短信读取权限');
      } else {
        showToast('未获得权限,可稍后在系统设置中开启');
      }
    } catch (e: any) {
      showToast(`申请失败: ${e?.message || '未知错误'}`);
    } finally {
      setAsking(false);
    }
  };

  const openNotifSettings = () => {
    haptics.tap();
    openNotificationAccessSettings();
  };

  /** 权限在系统设置里改过后回前台会自动刷新;这里再给一个手动确认入口(状态行/按钮随之更新) */
  const recheckNotif = () => {
    haptics.tap();
    const ok = isNotificationAccessGranted();
    setNotifGranted(ok);
    showToast(ok ? '通知使用权已开启' : '仍未开启:请在系统设置里勾选本应用');
  };

  /** 通知权限(Android 13+)按需申请:没权限只会少一条提醒,不影响记账 */
  const askNotifyPermission = () => {
    void ensureNotificationPermission().then((ok) => {
      if (!ok) showToast('未授予通知权限,入账提醒只能在应用内看到');
    });
  };

  const toggleAuto = (enabled: boolean) => {
    haptics.tap();
    const next = { ...auto, enabled };
    setAuto(next);
    void saveAutoSettings(next);
    if (enabled && !smsGranted) showToast('还需授予短信读取权限,自动记账才会生效');
    if (enabled && next.notify) askNotifyPermission();
  };

  /** 入账后是否发系统通知:关掉只在应用内 toast 提示,不往通知栏堆 */
  const toggleNotify = (on: boolean) => {
    haptics.tap();
    const next = { ...auto, notify: on };
    setAuto(next);
    void saveAutoSettings(next);
    if (on) askNotifyPermission();
  };

  const toggleAi = (enabled: boolean) => {
    haptics.tap();
    setAi({ enabled });
    void saveSmsAiSettings({ enabled });
    showToast(enabled ? 'AI 兜底已开启:未识别的原文会发送到模型' : 'AI 兜底已关闭:原文不再离开设备');
  };

  // 本机标记:①「已处理」标记(去重第 1 层)② 通知累积队列 ③ 自动记账历史。
  // 用户在系统里删掉导入的流水后,需要清空标记才能重新扫到这些短信/通知。
  const clearMarks = async () => {
    try {
      await clearProcessedSmsIds();
      // 自动记账历史一并清掉:否则「最近自动记账」里会留着已删除流水的记录
      await clearAutoHistory();
      clearPendingNotifications();
      // AI 解析缓存一并清掉:重新扫描时会对未识别内容重新解析
      await clearSmsAiCache();
      // 发件人候选缓存也清掉:下次扫描重新累积(筛选规则里已选中的项不受影响)
      await clearSmsSenders();
      haptics.success();
      showToast('已清空本机标记');
    } catch (e: any) {
      showToast(`清空失败: ${e?.message || '未知错误'}`);
    }
  };

  const noteStyle = { fontSize: 12, color: colors.mutedForeground, lineHeight: 18, marginTop: 8 };

  const primaryBtn = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.primary,
    marginTop: 12,
  };

  // 次级按钮:跳系统设置(边框 + 底色,与主操作区分)
  const ghostBtn = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    marginTop: 12,
  };

  return (
    <>
      {/* 根级 Stack 页(headerShown: false):顶部需自行避让状态栏,否则标题被系统状态栏/通知栏盖住;
          内容高度超过一屏,必须可滚动(短屏上「自动记账/本机标记」否则够不到) */}
      <Screen scroll>
        <View style={{ paddingHorizontal: 20, paddingTop: insets.top + 8 }}>
          {/* 返回 + 标题 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <Pressable
              onPress={() => router.back()}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronLeft size={18} color={colors.foreground} />
            </Pressable>
            <Text style={{ fontSize: 20, fontWeight: '700' }}>短信记账</Text>
          </View>

          {!supported ? (
            <FadeInView>
              <Card className="px-5 py-4 mb-4">
                <StatusLine ok={false} okText="" pendingText="当前平台不支持" />
                <Text style={noteStyle}>
                  依赖 Android 短信数据库与通知使用权,仅 Android 可用。
                </Text>
              </Card>
            </FadeInView>
          ) : (
            <>
              {/* 短信读取权限 */}
              <FadeInView>
                <Card className="px-5 py-4 mb-4">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
                      <MessageSquareText size={16} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600' }}>读取短信</Text>
                      <Text variant="muted" style={{ fontSize: 11.5, marginTop: 1 }}>回溯银行/支付的交易短信并生成候选流水</Text>
                    </View>
                  </View>
                  <View style={{ marginTop: 12 }}>
                    <StatusLine ok={smsGranted} okText="已授权" pendingText="未授权" />
                  </View>
                  {!smsGranted && (
                    <Pressable onPress={askSmsPermission} disabled={asking} style={{ ...primaryBtn, opacity: asking ? 0.6 : 1 }}>
                      {asking ? <ActivityIndicator size="small" color="#fff" /> : <MessageSquareText size={15} color="#fff" />}
                      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{asking ? '申请中...' : '申请读取短信权限'}</Text>
                    </Pressable>
                  )}
                  {smsGranted && (
                    <Pressable onPress={() => { haptics.tap(); router.push('/sms-import'); }} style={primaryBtn}>
                      <MessageSquareText size={15} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>开始扫描短信记账</Text>
                    </Pressable>
                  )}
                  {/* 小米/红米:银行短信属于「通知类短信」,系统默认拒绝且应用无法申请 —— 只能引导手动开 */}
                  {smsGranted && (
                    <>
                      <Pressable
                        onPress={() => { haptics.tap(); openSmsPermissionSettings(); }}
                        style={ghostBtn}
                      >
                        <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.foreground }}>
                          检查「通知类短信」权限
                        </Text>
                      </Pressable>
                      <Text style={noteStyle}>
                        部分系统将银行、服务号短信划为「通知类短信」,系统默认拒绝且应用申请不到;需要手动开启权限
                      </Text>
                    </>
                  )}
                  <Text style={noteStyle}>
                    只读收件箱;验证码、账单、营销短信在本机直接排除。
                  </Text>
                </Card>
              </FadeInView>

              {/* 通知使用权 */}
              <FadeInView index={1}>
                <Card className="px-5 py-4 mb-4">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
                      <BellRing size={16} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600' }}>通知使用权</Text>
                      <Text variant="muted" style={{ fontSize: 11.5, marginTop: 1 }}>捕获银行 / 支付 App 的消费通知</Text>
                    </View>
                  </View>
                  <View style={{ marginTop: 12 }}>
                    <StatusLine ok={notifGranted} okText="已开启" pendingText="未开启" />
                  </View>
                  {!notifGranted ? (
                    <Pressable onPress={openNotifSettings} style={primaryBtn}>
                      <BellRing size={15} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>前往系统设置开启</Text>
                    </Pressable>
                  ) : (
                    <Pressable onPress={recheckNotif} style={ghostBtn}>
                      <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.foreground }}>重新检查状态</Text>
                    </Pressable>
                  )}
                  <Text style={noteStyle}>
                    只能捕获开启之后的通知,历史通知补不回来。
                  </Text>
                </Card>
              </FadeInView>

              {/* 自动记账(默认关闭) */}
              <FadeInView index={2}>
                <Card className="px-5 py-4 mb-4">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
                      <Zap size={16} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600' }}>自动记账</Text>
                      <Text variant="muted" style={{ fontSize: 11.5, marginTop: 1 }}>打开应用时静默入账高置信度的交易</Text>
                    </View>
                    <Switch
                      value={auto.enabled}
                      onValueChange={toggleAuto}
                      trackColor={{ true: colors.primary }}
                      thumbColor="#fff"
                    />
                  </View>

                  {/* 子开关:只在自动记账开启时出现,避免没开主开关就配置提醒 */}
                  {auto.enabled ? (
                    <View
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.hairline,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13.5, fontWeight: '500' }}>入账后发送通知</Text>
                        <Text variant="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                          点通知可直接打开对应流水;关闭后只在应用内提示
                        </Text>
                      </View>
                      <Switch
                        value={auto.notify}
                        onValueChange={toggleNotify}
                        trackColor={{ true: colors.primary }}
                        thumbColor="#fff"
                      />
                    </View>
                  ) : null}

                  <Text style={noteStyle}>
                    只入账「已匹配到已有账户且置信度 ≥ {AUTO_MIN_CONFIDENCE}」的交易,其余留在扫描页确认。
                    不建账户、不写映射规则,可整批撤销。
                  </Text>
                  <Text style={{ ...noteStyle, marginTop: 0 }}>
                    应用被系统清理或长期未打开时可能延迟入账。
                  </Text>
                  {auto.enabled && !smsGranted ? (
                    <Text style={{ ...noteStyle, marginTop: 0, color: colors.expense }}>
                      需先授予短信读取权限。
                    </Text>
                  ) : null}

                  {history.length > 0 ? (
                    <Pressable onPress={() => { haptics.tap(); setHistoryOpen(true); }} style={ghostBtn}>
                      <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.foreground }}>
                        最近自动记账记录(本机 {history.length} 条)
                      </Text>
                    </Pressable>
                  ) : null}
                </Card>
              </FadeInView>

              {/* AI 兜底解析(默认关闭) */}
              <FadeInView index={3}>
                <Card className="px-5 py-4 mb-4">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
                      <Sparkles size={16} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600' }}>AI 兜底解析</Text>
                      <Text variant="muted" style={{ fontSize: 11.5, marginTop: 1 }}>让模型读懂规则认不出的长尾短信</Text>
                    </View>
                    <Switch
                      value={ai.enabled}
                      onValueChange={toggleAi}
                      trackColor={{ true: colors.primary }}
                      thumbColor="#fff"
                    />
                  </View>

                  <Text style={noteStyle}>
                    只上送「本地没读懂」的原文;模型只抽字段,账户匹配与入账仍走本地管线,结果需你核对。
                  </Text>
                  <Text style={{ ...noteStyle, marginTop: 0 }}>
                    需先在「设置 → AI 助手」配置模型;结果本机缓存,同一批不重复调用。
                  </Text>
                  {ai.enabled ? (
                    <Text style={{ ...noteStyle, marginTop: 0, color: colors.primary }}>
                      已开启:未识别的原文会上送模型。
                    </Text>
                  ) : null}
                </Card>
              </FadeInView>

              {/* 隐私说明:参考信息,排在开关之后,不打断「权限 → 开关」的操作流 */}
              <FadeInView index={4}>
                <Card className="px-5 py-4 mb-4">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
                      <Lock size={16} color={colors.primary} />
                    </View>
                    <Text style={{ fontSize: 15, fontWeight: '600' }}>隐私说明</Text>
                  </View>
                  <View style={{ marginTop: 10, gap: 6 }}>
                    <Text style={noteStyle}>· 正文只在本机解析(金额 / 时间 / 尾号 / 交易方)</Text>
                    <Text style={{ ...noteStyle, marginTop: 0 }}>· 原文默认不出设备;开启「AI 兜底解析」后才上送未识别的原文</Text>
                    <Text style={{ ...noteStyle, marginTop: 0 }}>· 候选需你确认才入账,权限可随时撤销</Text>
                  </View>
                </Card>
              </FadeInView>

              {/* 本机标记 */}
              <FadeInView index={5}>
                <Card className="px-5 py-4 mb-4">
                  <Text style={{ fontSize: 15, fontWeight: '600' }}>本机标记</Text>
                  <Text style={noteStyle}>
                    已导入的短信/通知会标记为「已处理」,不再出现在扫描结果里。若你在系统里删掉了这些流水,
                    清空标记后即可重新扫描。
                  </Text>
                  <Pressable
                    onPress={clearMarks}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                      paddingVertical: 11, borderRadius: 12, borderWidth: 1,
                      borderColor: colors.border, backgroundColor: colors.muted, marginTop: 12,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>清空本机标记</Text>
                  </Pressable>
                </Card>
              </FadeInView>
            </>
          )}
        </View>
      </Screen>

      {/* 最近自动记账记录:只读列表(要改/删请去流水列表)。
          同样放在 Screen/ScrollView 之外 —— FormSheet 用 absoluteFill 内联定位,
          放进滚动内容里会被「内容撑高的容器」带到屏幕外 */}
      <FormSheet
        visible={historyOpen}
        title="最近自动记账"
        onClose={() => setHistoryOpen(false)}
      >
        {history.length === 0 ? (
          <Text variant="muted" style={{ fontSize: 12.5, lineHeight: 19 }}>还没有自动记账记录。</Text>
        ) : (
          <View style={{ gap: 12 }}>
            {history.slice(0, 10).map((e) => (
              <View key={e.recordId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '500' }} numberOfLines={1}>
                    {e.accountName || '未识别账户'}
                  </Text>
                  <Text variant="muted" style={{ fontSize: 11.5, marginTop: 1 }}>{fmtDate(e.date)}</Text>
                </View>
                <Text
                  style={{
                    fontSize: 13.5, fontWeight: '600',
                    color: e.type === 'INCOME' ? colors.primary : colors.expense,
                  }}
                >
                  {e.type === 'INCOME' ? '收入' : e.type === 'EXPENSE' ? '支出' : '待确认'} {e.amount.toFixed(2)}
                </Text>
              </View>
            ))}
            <Text variant="muted" style={{ fontSize: 11, lineHeight: 16 }}>
              只保留本机最近 50 条;这里仅作查看,修改请到流水列表。
            </Text>
          </View>
        )}
      </FormSheet>
    </>
  );
}
