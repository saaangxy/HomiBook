import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy } from 'lucide-react-native';
import {
  buildMcpCliCommand,
  buildMcpClientConfig,
  groupMcpTools,
  MCP_CONFIG_KEYS,
  MCP_ENDPOINT,
  resolveMcpUrl,
  splitMcpTools,
  type McpInfo,
  type McpToolInfo,
} from '@homibook/core';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/stores/auth';
import { getBaseUrl } from '@/services/http';
import { mcpApi, settingsApi } from '@/services/settings';
import { showToast } from '@/components/chrome/Toast';
import { Chips, ErrorText, Field } from './shared';

const CODE_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** 工具清单:按业务分类分组展示(只读 / 写操作各一份) */
function ToolGroups({ tools, empty }: { tools: McpToolInfo[]; empty: string }) {
  const { colors } = useTheme();
  if (tools.length === 0) {
    return <Text variant="muted" style={{ fontSize: 11.5 }}>{empty}</Text>;
  }
  return (
    <View style={{ gap: 10 }}>
      {groupMcpTools(tools).map((group) => (
        <View key={group.category} style={{ gap: 6 }}>
          <Text variant="muted" style={{ fontSize: 11.5, fontWeight: '600' }}>{group.category}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {group.tools.map((tool) => (
              <View
                key={tool.name}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: alpha(colors.primary, 0.05),
                }}
              >
                <Text style={{ fontSize: 11.5 }}>{tool.displayName}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/** 小徽标 */
function Badge({ label, tone }: { label: string; tone: 'muted' | 'primary' }) {
  const { colors } = useTheme();
  const active = tone === 'primary';
  return (
    <View style={{
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: active ? alpha(colors.primary, 0.12) : colors.muted,
    }}>
      <Text style={{ fontSize: 10.5, color: active ? colors.primary : colors.mutedForeground, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

/** 代码块 + 复制按钮 */
function CodeBox({ title, code, onCopy }: { title: string; code: string; onCopy: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.elevated, padding: 10, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="muted" style={{ fontSize: 11, flex: 1 }}>{title}</Text>
        <Pressable hitSlop={8} onPress={onCopy} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Copy size={12} color={colors.primary} />
          <Text style={{ fontSize: 11.5, color: colors.primary }}>复制</Text>
        </Pressable>
      </View>
      <Text selectable style={{ fontSize: 11, lineHeight: 16, fontFamily: CODE_FONT }}>{code}</Text>
    </View>
  );
}

// MCP 服务设置(所有用户可见;服务端开关仅管理员可改)
export function McpSettings() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [info, setInfo] = useState<McpInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mcpApi.info()
      .then(setInfo)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载 MCP 配置失败'))
      .finally(() => setLoading(false));
  }, []);

  const endpoint = resolveMcpUrl(getBaseUrl(), info?.endpoint ?? MCP_ENDPOINT);
  const snippet = buildMcpClientConfig(endpoint);
  const cliCommand = buildMcpCliCommand(endpoint);
  const { read: readTools, write: writeTools } = splitMcpTools(info?.tools ?? []);

  const copy = async (text: string, message: string) => {
    await Clipboard.setStringAsync(text);
    showToast(message);
  };

  const updateFlag = async (key: 'mcpEnabled' | 'mcpWriteEnabled', value: boolean) => {
    if (saving) return;
    if (key === MCP_CONFIG_KEYS.writeEnabled && !info?.enabled) {
      showToast('请先启用 MCP 服务');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // 关闭服务时一并收回写权限,避免下次开启时仍保留高危权限
      const revokeWrite = key === MCP_CONFIG_KEYS.enabled && !value && !!info?.writeEnabled;
      await settingsApi.updateConfig(
        revokeWrite
          ? { mcpEnabled: false, mcpWriteEnabled: false }
          : key === MCP_CONFIG_KEYS.enabled
            ? { mcpEnabled: value }
            : { mcpWriteEnabled: value },
      );
      setInfo((prev) => (prev
        ? {
            ...prev,
            ...(key === MCP_CONFIG_KEYS.enabled ? { enabled: value } : { writeEnabled: value }),
            ...(revokeWrite ? { writeEnabled: false } : {}),
          }
        : prev));
      showToast(
        key === MCP_CONFIG_KEYS.enabled
          ? (value ? 'MCP 服务已开启' : 'MCP 服务已关闭')
          : (value ? '已允许 MCP 写操作' : '已禁止 MCP 写操作'),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 12 }}>加载中...</Text>;
  }

  const divider = <View style={{ height: 1, backgroundColor: colors.hairline }} />;

  return (
    <View style={{ gap: 14 }}>
      <ErrorText msg={error} />

      <Text variant="muted" style={{ fontSize: 11.5, lineHeight: 17 }}>
        开启后,可通过 MCP(Model Context Protocol)把 HomiBook 的账本能力接入 Cursor、Claude Code、Cherry Studio 等 AI 客户端。
      </Text>

      {/* 服务开关(管理员) */}
      {isAdmin ? (
        <>
          <Field label="启用 MCP 服务" desc="关闭后所有 MCP 请求都会被拒绝">
            <Chips
              options={[{ value: 'on', label: '已开启' }, { value: 'off', label: '已关闭' }]}
              value={info?.enabled ? 'on' : 'off'}
              onChange={(v) => updateFlag(MCP_CONFIG_KEYS.enabled, v === 'on')}
            />
          </Field>
          {divider}
          <Field label="允许写操作" desc="开启后客户端可创建、修改、删除流水与预算;关闭时仅提供查询与统计">
            <Chips
              options={[{ value: 'on', label: '已开启' }, { value: 'off', label: '已关闭' }]}
              value={info?.writeEnabled ? 'on' : 'off'}
              onChange={(v) => updateFlag(MCP_CONFIG_KEYS.writeEnabled, v === 'on')}
            />
          </Field>
          {saving && <Text variant="muted" style={{ fontSize: 11 }}>保存中…</Text>}
        </>
      ) : (
        <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, padding: 12 }}>
          <Text variant="muted" style={{ fontSize: 11.5 }}>
            MCP 服务由管理员统一开启。当前状态:
            <Text style={{ fontSize: 11.5, color: colors.foreground, fontWeight: '600' }}>
              {info?.enabled ? `已启用${info.writeEnabled ? '(含写操作)' : '(仅查询)'}` : '未启用'}
            </Text>
          </Text>
        </View>
      )}

      {divider}

      {/* 接入地址 */}
      <Field label="接入地址" desc="Streamable HTTP(无状态)传输,请求头携带 Authorization: Bearer homibook_...">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.elevated }}>
            <Text selectable style={{ fontSize: 11.5, fontFamily: CODE_FONT }}>{endpoint}</Text>
          </View>
          <Pressable
            hitSlop={8}
            onPress={() => copy(endpoint, '地址已复制')}
            style={{ width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
          >
            <Copy size={14} color={colors.primary} />
          </Pressable>
        </View>
      </Field>

      {divider}

      {/* 配置指引 */}
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '500' }}>配置指引</Text>
        <Text variant="muted" style={{ fontSize: 11.5, lineHeight: 18 }}>
          1. 在下方「API Key 管理」创建一个 API Key(密钥仅创建时显示一次)。{'\n'}
          2. 复制下方配置到 MCP 客户端,把占位符替换为实际密钥。{'\n'}
          3. 重启客户端,确认工具列表中出现 HomiBook 工具。{'\n'}
          4. 如需创建/修改数据,请管理员开启「允许写操作」。
        </Text>
        <CodeBox title="客户端配置" code={snippet} onCopy={() => copy(snippet, '配置已复制')} />
        <Text variant="muted" style={{ fontSize: 11, lineHeight: 17 }}>
          不同客户端字段略有差异:支持 url + headers 的直接粘贴;要求传输类型时填 streamable-http。
        </Text>
        <CodeBox title="Claude Code 命令行" code={cliCommand} onCopy={() => copy(cliCommand, '命令已复制')} />
      </View>

      {divider}

      {/* 能力清单 */}
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '500' }}>可提供的功能</Text>

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Badge label="只读" tone="muted" />
            <Text variant="muted" style={{ fontSize: 11 }}>查询、统计与记忆读取,始终可用</Text>
          </View>
          <ToolGroups tools={readTools} empty="暂无可用工具" />
        </View>

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Badge label="写操作" tone="primary" />
            <Text variant="muted" style={{ fontSize: 11 }}>
              {info?.writeEnabled ? '已开启' : '需管理员开启后才对客户端可见'}
            </Text>
          </View>
          <ToolGroups tools={writeTools} empty="暂无写操作工具" />
        </View>

        <Text variant="muted" style={{ fontSize: 11, lineHeight: 17 }}>
          依赖前端交互的能力(账单导入预览、小票识别、图片查看、切换账本)以及联网搜索不通过 MCP 暴露。所有 MCP 调用都会记录到 AI 审计日志。
        </Text>
      </View>
    </View>
  );
}
