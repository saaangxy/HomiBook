import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Image, Modal, Pressable, ScrollView, View } from 'react-native';
import { Download, FileText, X } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui/Text';
import { DownloadModeSheet } from '@/components/chrome/DownloadModeSheet';
import { downloadAttachment, resolveRemoteUrl, type DownloadMode } from '@/services/http';

// 附件查看(参考 web AttachmentViewer):
// - 缩略图网格 + 全屏大图预览(左右翻页) + 非图片附件文件名块
// - 所有附件可「下载」:走后端下载接口并调起系统分享面板保存

export interface AttachmentItem {
  id: string;
  url: string;
  originalFilename: string;
}

/** 按扩展名判断是否图片(web 同规则) */
export function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(url);
}

/** 全屏大图预览:多图左右翻页 + 下载当前图 */
export function ImageLightbox({ images, initialIndex = 0, onClose }: {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const width = Dimensions.get('window').width;
  const [index, setIndex] = useState(initialIndex);
  const [downloading, setDownloading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    // 打开时定位到点击的图片(分页宽度偏移)
    scrollRef.current?.scrollTo({ x: initialIndex * width, animated: false });
  }, [initialIndex, width]);

  if (images.length === 0) return null;

  const handleDownload = () => setSheetOpen(true);

  const runDownload = async (mode: DownloadMode) => {
    setSheetOpen(false);
    const src = images[index];
    setDownloading(true);
    try {
      await downloadAttachment(src, src.split('/').pop() || `image-${Date.now()}.jpg`, mode);
    } catch (e: any) {
      Alert.alert('下载失败', e?.message || '未知错误');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }}>
        {/* 顶部工具栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
          <Text style={{ color: '#fff', fontSize: 13 }}>{index + 1} / {images.length}</Text>
          <View style={{ flex: 1 }} />
          <Pressable hitSlop={8} onPress={handleDownload} disabled={downloading} style={{ padding: 6, marginRight: 14 }}>
            {downloading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Download size={20} color="#fff" />}
          </Pressable>
          <Pressable hitSlop={8} onPress={onClose} style={{ padding: 6 }}>
            <X size={22} color="#fff" />
          </Pressable>
        </View>
        {/* 大图翻页 */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {images.map((src, i) => (
            <Pressable key={`${src}-${i}`} onPress={onClose} style={{ width, justifyContent: 'center' }}>
              <Image source={{ uri: src }} resizeMode="contain" style={{ width, height: '100%' }} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {/* 保存方式选择(保存到设备/系统分享) */}
      <DownloadModeSheet visible={sheetOpen} title="保存图片" onMode={runDownload} onClose={() => setSheetOpen(false)} />
    </Modal>
  );
}

/** 附件查看器:缩略图网格 → 点图进入全屏预览;非图片附件显示文件名块;每个附件带下载 */
export function AttachmentViewer({ visible, attachments, onClose }: {
  visible: boolean;
  attachments: AttachmentItem[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // 待保存附件(先弹保存方式选择)
  const [dlTarget, setDlTarget] = useState<AttachmentItem | null>(null);

  useEffect(() => {
    if (!visible) setPreviewIdx(null);
  }, [visible]);

  if (!visible || attachments.length === 0) return null;

  // 图片类附件的完整地址集合(全屏预览用)
  const imageUrls = attachments.filter((a) => isImageUrl(a.url)).map((a) => resolveRemoteUrl(a.url));
  // 网格顺序中的某项在 imageUrls 中的下标(预览翻页定位用)
  const previewIndexOf = (att: AttachmentItem) =>
    attachments.filter((a) => isImageUrl(a.url)).findIndex((a) => a.id === att.id);

  const runDownload = async (mode: DownloadMode) => {
    const att = dlTarget;
    if (!att) return;
    setDlTarget(null);
    setDownloadingId(att.id);
    try {
      await downloadAttachment(att.url, att.originalFilename, mode);
    } catch (e: any) {
      Alert.alert('下载失败', e?.message || '未知错误');
    } finally {
      setDownloadingId(null);
    }
  };

  const dlBtn = (att: AttachmentItem, small?: boolean) => (
    <Pressable
      hitSlop={8}
      onPress={() => setDlTarget(att)}
      style={{
        position: 'absolute', right: -5, bottom: -5,
        width: small ? 24 : 26, height: small ? 24 : 26, borderRadius: 13,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.card,
      }}
    >
      {downloadingId === att.id
        ? <ActivityIndicator size={11} color="#fff" />
        : <Download size={small ? 11 : 12} color="#fff" />}
    </Pressable>
  );

  return (
    <>
      <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
        <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 18, paddingBottom: 28, maxHeight: '72%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 14 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', flex: 1 }}>查看附件 ({attachments.length})</Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <X size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 20 }}>
              {attachments.map((att) =>
                isImageUrl(att.url) ? (
                  <View key={att.id}>
                    <Pressable onPress={() => setPreviewIdx(previewIndexOf(att))}>
                      <Image source={{ uri: resolveRemoteUrl(att.url) }} style={{ width: 76, height: 76, borderRadius: 10, backgroundColor: colors.muted }} />
                    </Pressable>
                    {dlBtn(att)}
                  </View>
                ) : (
                  <View key={att.id}>
                    <Pressable onPress={() => setDlTarget(att)} style={{
                      width: 132, height: 76, borderRadius: 10, backgroundColor: colors.muted,
                      alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 6,
                    }}>
                      <FileText size={18} color={colors.mutedForeground} />
                      <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.mutedForeground, maxWidth: '100%' }}>
                        {att.originalFilename}
                      </Text>
                    </Pressable>
                    {dlBtn(att)}
                  </View>
                ),
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>
      {/* 全屏预览层(位于网格之上) */}
      {previewIdx !== null && imageUrls.length > 0 && (
        <ImageLightbox images={imageUrls} initialIndex={Math.max(previewIdx, 0)} onClose={() => setPreviewIdx(null)} />
      )}
      {/* 保存方式选择(保存到设备/系统分享) */}
      <DownloadModeSheet visible={!!dlTarget} title="保存附件" onMode={runDownload} onClose={() => setDlTarget(null)} />
    </>
  );
}
