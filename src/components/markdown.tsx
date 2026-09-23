import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ChatImage, FileChip } from './media';

// Plain text out of a markdown AST node (link labels are inline children).
function astText(node: any): string {
  if (!node) return '';
  if (typeof node.content === 'string') return node.content;
  if (Array.isArray(node.children)) return node.children.map(astText).join('');
  return '';
}

// Leaf text nodes render selectable so long-press selects partial text.
// A factory (not a constant) because the media rules need the active theme —
// markdown has no styles channel for `dark`.
export const makeSelectableRules = (dark: boolean) => ({
  // Selectable lives ONLY on the outermost textgroup — nested selectable Texts
  // double TextView cost on Android. Leaf text stays plain.
  text: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => (
    <Text key={node.key} style={[inheritedStyles, styles.text]}>
      {node.content}
    </Text>
  ),
  // ^ leaf-only selectable is ignored on Android when nested — the selectable
  // must sit on the OUTERMOST Text of each block (one TextView = one
  // selectable unit). textgroup wraps a paragraph's inline spans.
  textgroup: (node: any, children: any, parent: any, styles: any) => (
    <Text key={node.key} selectable style={styles.textgroup}>
      {children}
    </Text>
  ),
  code_block: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => {
    let { content } = node;
    if (typeof node.content === 'string' && node.content.charAt(node.content.length - 1) === '\n') {
      content = node.content.substring(0, node.content.length - 1);
    }
    return (
      <Text key={node.key} selectable style={[inheritedStyles, styles.code_block]}>
        {content}
      </Text>
    );
  },
  fence: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => {
    let { content } = node;
    if (typeof node.content === 'string' && node.content.charAt(node.content.length - 1) === '\n') {
      content = node.content.substring(0, node.content.length - 1);
    }
    const lang = String(node?.info ?? node?.sourceInfo ?? '').trim() || 'code';
    return (
      <View key={node.key} style={{ marginVertical: 4 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 8,
            marginBottom: 2,
          }}
        >
          <Text style={{ fontSize: 11, color: dark ? '#9aa0a6' : '#8a8a8a' }}>{lang}</Text>
          <Pressable
            onPress={() => void Clipboard.setStringAsync(String(content))}
            hitSlop={8}
            style={{ paddingHorizontal: 4, paddingVertical: 2 }}
          >
            <Text style={{ fontSize: 11, fontWeight: '600', color: dark ? '#7aa7ff' : '#1a73e8' }}>Copy</Text>
          </Pressable>
        </View>
        <Text selectable style={[inheritedStyles, styles.fence]}>
          {content}
        </Text>
      </View>
    );
  },
  // Images: the library default (FitImage) can't carry our cookie and has no
  // viewer — see media.tsx for the resolution rules.
  image: (node: any) => {
    const src = String(node?.attributes?.src ?? '');
    if (!src) return null;
    // markdown-it keeps alt text in the children, not in `attributes.alt`.
    const alt = (String(node?.attributes?.alt ?? '') || astText(node)).trim() || undefined;
    return <ChatImage key={node.key} src={src} alt={alt} dark={dark} />;
  },
  // Web links keep the normal look; anything pointing at a file on the server
  // becomes a chip that previews it in-app (the browser has no session cookie).
  link: (node: any, children: any, _parent: any, styles: any) => {
    const href = String(node?.attributes?.href ?? '');
    if (/^(https?|mailto|tel):/i.test(href)) {
      return (
        <Text
          key={node.key}
          style={styles.link}
          onPress={() => void Linking.openURL(href).catch(() => {})}
        >
          {children}
        </Text>
      );
    }
    if (!href) return <Text key={node.key}>{children}</Text>;
    const label = astText(node).trim() || href;
    return <FileChip key={node.key} href={href} label={label} textStyle={styles.link} />;
  },
});

export const mdAi = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21, color: '#111' },
  heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: '#111' },
  heading2: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: '#111' },
  heading3: { fontSize: 16, fontWeight: '700', marginVertical: 4, color: '#111' },
  paragraph: { marginVertical: 4 },
  link: { color: '#1a73e8' },
  blockquote: { backgroundColor: '#e8eef7', borderLeftWidth: 3, borderLeftColor: '#1a73e8', paddingHorizontal: 8, paddingVertical: 4 },
  code_inline: { backgroundColor: '#e4e4e8', borderRadius: 4, paddingHorizontal: 4, fontSize: 13 },
  fence: { backgroundColor: '#1e1e24', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  code_block: { backgroundColor: '#1e1e24', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { flexDirection: 'row', marginVertical: 2 },
  bullet_list_content: { flex: 1 },
  ordered_list_content: { flex: 1 },
  hr: { backgroundColor: '#ddd', height: 1, marginVertical: 8 },
  table: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6 },
  th: { padding: 6, fontWeight: '700' },
  td: { padding: 6 },
  tr: { borderBottomWidth: 1, borderColor: '#eee' },
});

export const mdAiDark = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21, color: '#e8e8ea' },
  heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: '#e8e8ea' },
  heading2: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: '#e8e8ea' },
  heading3: { fontSize: 16, fontWeight: '700', marginVertical: 4, color: '#e8e8ea' },
  paragraph: { marginVertical: 4 },
  link: { color: '#7aa7ff' },
  blockquote: { backgroundColor: '#232a3a', borderLeftWidth: 3, borderLeftColor: '#7aa7ff', paddingHorizontal: 8, paddingVertical: 4 },
  code_inline: { backgroundColor: '#2b2b31', borderRadius: 4, paddingHorizontal: 4, fontSize: 13, color: '#e8e8ea' },
  fence: { backgroundColor: '#212121', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  code_block: { backgroundColor: '#212121', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { flexDirection: 'row', marginVertical: 2 },
  bullet_list_content: { flex: 1 },
  ordered_list_content: { flex: 1 },
  hr: { backgroundColor: '#333', height: 1, marginVertical: 8 },
  table: { borderWidth: 1, borderColor: '#333', borderRadius: 6 },
  th: { padding: 6, fontWeight: '700' },
  td: { padding: 6 },
  tr: { borderBottomWidth: 1, borderColor: '#222' },
});

export const mdUserDark = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21, color: '#f3f4f6' },
  heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: '#f3f4f6' },
  heading2: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: '#f3f4f6' },
  heading3: { fontSize: 16, fontWeight: '700', marginVertical: 4, color: '#f3f4f6' },
  paragraph: { marginVertical: 4 },
  link: { color: '#93c5fd' },
  blockquote: { backgroundColor: 'rgba(147,197,253,.12)', borderLeftWidth: 3, borderLeftColor: '#93c5fd', paddingHorizontal: 8, paddingVertical: 4 },
  code_inline: { backgroundColor: 'rgba(255,255,255,.1)', borderRadius: 4, paddingHorizontal: 4, fontSize: 13, color: '#f3f4f6' },
  fence: { backgroundColor: '#1e1e24', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  code_block: { backgroundColor: '#1e1e24', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { flexDirection: 'row', marginVertical: 2 },
  bullet_list_content: { flex: 1 },
  ordered_list_content: { flex: 1 },
  hr: { backgroundColor: 'rgba(255,255,255,.2)', height: 1, marginVertical: 8 },
});

export const mdUser = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21, color: '#041e49' },
  heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: '#041e49' },
  heading2: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: '#041e49' },
  heading3: { fontSize: 16, fontWeight: '700', marginVertical: 4, color: '#041e49' },
  paragraph: { marginVertical: 4 },
  link: { color: '#0b57d0' },
  blockquote: { backgroundColor: 'rgba(4,30,73,.08)', borderLeftWidth: 3, borderLeftColor: '#0b57d0', paddingHorizontal: 8, paddingVertical: 4 },
  code_inline: { backgroundColor: 'rgba(4,30,73,.1)', borderRadius: 4, paddingHorizontal: 4, fontSize: 13, color: '#041e49' },
  fence: { backgroundColor: '#1e1e24', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  code_block: { backgroundColor: '#1e1e24', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { flexDirection: 'row', marginVertical: 2 },
  bullet_list_content: { flex: 1 },
  ordered_list_content: { flex: 1 },
  hr: { backgroundColor: 'rgba(4,30,73,.2)', height: 1, marginVertical: 8 },
});
