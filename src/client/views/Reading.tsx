import { Fragment, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ClientHost } from '../adapter/host';
import type {
  RssBootstrap, RssDigest, RssEntry, RssEntryItem, RssEntryPage, RssFeed, RssFolder, RssSettings,
} from '../../shared/rss';
import { call, cancelPending, readable } from '../rpc-client';
import { Icon, State } from '../components/States';
import { t, tFormat } from '../i18n';
import { frameDocument } from '../sanitize/html-allowlist';
import type { ArticleStyle } from '../sanitize/html-allowlist';
import { ReadingDiscover } from './ReadingDiscover';
function relative(ts: number) {
  const date = new Date(ts), now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  if (date.toDateString() === now.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return t('昨天');
  if (now.getTime() - ts < 604800000) return t('周') + ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
  return tFormat('{m}/{d}', { m: date.getMonth() + 1, d: date.getDate() });
}
function ArticleFrame({ html, remoteImages, articleStyle, onPrevious, onNext }: {
  html: string; remoteImages: boolean; articleStyle?: Partial<ArticleStyle>;
  onPrevious?: () => void; onNext?: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const previousRef = useRef(onPrevious), nextRef = useRef(onNext);
  previousRef.current = onPrevious; nextRef.current = onNext;
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let doc: Document | undefined, armedPrevious = false, armedNext = false;
    const onWheel = (event: WheelEvent) => {
      const root = doc?.scrollingElement || doc?.documentElement;
      if (!root) return;
      if (event.deltaY < 0) {
        const atTop = root.scrollTop <= 24;
        if (!atTop) { armedPrevious = false; return; }
        if (armedPrevious) return;
        armedPrevious = true;
        previousRef.current?.();
        return;
      }
      if (event.deltaY === 0) return;
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 24;
      if (!atBottom) { armedNext = false; return; }
      if (armedNext) return;
      armedNext = true;
      nextRef.current?.();
    };
    const detach = () => doc?.removeEventListener('wheel', onWheel);
    const bind = () => {
      detach();
      doc = frame.contentDocument || undefined;
      if (doc) {
        armedPrevious = false; armedNext = false;
        doc.addEventListener('wheel', onWheel, { passive: true });
      }
    };
    frame.addEventListener('load', bind);
    bind();
    return () => { frame.removeEventListener('load', bind); detach(); };
  }, []);
  const srcDoc = frameDocument(html, remoteImages, 'article', articleStyle);
  return <div className="article-frame"><iframe ref={frameRef} title="文章正文" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    referrerPolicy="no-referrer" srcDoc={srcDoc}/></div>;
}
function FeedAvatar({ feed }: { feed?: { title?: string; icon?: string } }) {
  return <span className="feed-avatar" aria-hidden="true">
    <b>{(feed?.title?.[0] || 'R').toUpperCase()}</b>
    {feed?.icon && <img src={feed.icon} alt="" loading="lazy" referrerPolicy="no-referrer"
      onError={event => { event.currentTarget.style.display = 'none'; }}/>}
  </span>;
}
export function Reading({ ctx }: { ctx: ClientHost }) {
  const [data, setData] = useState<RssBootstrap>();
  const [page, setPage] = useState<RssEntryPage>({ items: [], total: 0, unread: 0 });
  const [view, setView] = useState<'all' | 'unread' | 'starred'>('unread');
  const [folderId, setFolderId] = useState('');
  const [feedId, setFeedId] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false), [moreBusy, setMoreBusy] = useState(false);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [error, setError] = useState<any>();
  const [selectedId, setSelectedId] = useState(''), [entry, setEntry] = useState<RssEntry>();
  const [detailBusy, setDetailBusy] = useState(false), [summaryBusy, setSummaryBusy] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false), [summaryError, setSummaryError] = useState<any>();
  const [assistantOffset, setAssistantOffset] = useState({ x: 0, y: 0 });
  const [digestBusy, setDigestBusy] = useState(false);
  const [showDigest, setShowDigest] = useState(false);
  const [addOpen, setAddOpen] = useState(false), [feedUrl, setFeedUrl] = useState('');
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 980);
  const [addingFolder, setAddingFolder] = useState(false), [folderName, setFolderName] = useState('');
  const [importing, setImporting] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; feedId?: string; folderId?: string }>();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [sortState, setSortState] = useState<{ kind: 'feed' | 'folder'; scope: string; id: string; overId?: string }>();
  const alive = useRef(true), generation = useRef(0), inFlight = useRef(false), advanceAt = useRef(0);
  const selectedRef = useRef(''), listRef = useRef<HTMLDivElement>(null), sentinelRef = useRef<HTMLDivElement>(null);
  const autoReadSeen = useRef(new Set<string>()), autoReadQueue = useRef<string[]>([]);
  const autoReadTimer = useRef(0), scanTimer = useRef(0);
  const sortDrag = useRef<{ kind: 'feed' | 'folder'; scope: string; id: string; x: number; y: number; active: boolean } | undefined>(undefined);
  const sortOver = useRef(''), sortClickGuard = useRef(false);
  const assistantRef = useRef<HTMLElement>(null), assistantLayerRef = useRef<HTMLDivElement>(null);
  const assistantDrag = useRef<{ id: number; x: number; y: number; ox: number; oy: number } | undefined>(undefined);
  const opmlRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  const settings = data?.settings;
  const rssCall = <T,>(name: string, input: Record<string, unknown> = {}) =>
    call<T>(ctx, name, { ...input, __owner: 'reading' });

  async function bootstrap() {
    const value = await rssCall<RssBootstrap>('rss.bootstrap');
    if (!alive.current) return;
    setData(value); setError(undefined);
  }
  async function load(reset = false, more = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    const version = ++generation.current;
    if (!more) setBusy(true); else setMoreBusy(true);
    try {
      const value = await rssCall<RssEntryPage>('rss.entries.list', {
        view, folderId: folderId || undefined, feedId: feedId || undefined,
        query: query.trim() || undefined, cursor: more ? page.nextCursor : undefined, limit: 30,
      });
      if (alive.current && version === generation.current) {
        setPage(old => ({ ...value, items: more ? [...old.items, ...value.items] : value.items }));
        return value;
      }
    } catch (reason) { if (alive.current && version === generation.current) setError(readable(reason)); }
    finally {
      inFlight.current = false;
      if (alive.current) { setBusy(false); setMoreBusy(false); }
    }
  }
  loadMoreRef.current = () => { if (page.nextCursor && !inFlight.current) void load(false, true); };
  useEffect(() => {
    alive.current = true;
    void bootstrap().catch(reason => { if (alive.current) setError(readable(reason)); });
    return () => {
      alive.current = false; generation.current++; cancelPending(ctx, 'reading');
      window.clearTimeout(autoReadTimer.current); window.clearTimeout(scanTimer.current);
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(true); }, 220);
    return () => window.clearTimeout(timer);
  }, [view, folderId, feedId, query]);
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    let timer = 0;
    const maybeLoad = () => {
      if (!root.clientHeight) return;
      if (root.scrollHeight - root.scrollTop - root.clientHeight <= 280) loadMoreRef.current();
    };
    const onScroll = () => {
      if (timer) return;
      timer = window.setTimeout(() => { timer = 0; maybeLoad(); }, 40);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    const node = sentinelRef.current;
    const observer = typeof IntersectionObserver !== 'undefined' && node
      ? new IntersectionObserver(items => { if (items.some(item => item.isIntersecting)) maybeLoad(); },
        { root, rootMargin: '280px 0px' })
      : undefined;
    observer?.observe(node!);
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(maybeLoad) : undefined;
    resize?.observe(root);
    const initial = window.setTimeout(maybeLoad, 120);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.clearTimeout(initial);
      root.removeEventListener('scroll', onScroll);
      observer?.disconnect();
      resize?.disconnect();
    };
  }, [page.nextCursor]);
  useEffect(() => {
    if (!assistantOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setAssistantOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assistantOpen]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu]);
  useEffect(() => ctx.messages.on('rss.updated', () => {
    void bootstrap().catch(() => {});
    if (!inFlight.current) void load(true);
  }), [ctx, view, folderId, feedId, query]);
  async function openEntry(item: RssEntryItem) {
    setShowDigest(false);
    setAssistantOpen(false); setSummaryError(undefined);
    selectedRef.current = item.id; setSelectedId(item.id); setEntry(undefined); setDetailBusy(true);
    setPage(old => ({ ...old, items: old.items.map(value => value.id === item.id ? { ...value, read: true } : value) }));
    try {
      const value = await rssCall<RssEntry>('rss.entry.get', { id: item.id });
      if (selectedRef.current === item.id) {
        setEntry(value);
        if (settings?.autoSummary && !value.summary) void summarizeById(item.id);
      }
    } catch (reason) {
      if (selectedRef.current === item.id) {
        selectedRef.current = ''; setSelectedId(''); setDetailBusy(false); setError(readable(reason));
      }
    } finally {
      if (selectedRef.current === item.id) setDetailBusy(false);
      void bootstrap().catch(() => {});
    }
  }
  async function openById(id: string) {
    setShowDigest(false);
    setAssistantOpen(false); setSummaryError(undefined);
    selectedRef.current = id; setSelectedId(id); setEntry(undefined); setDetailBusy(true);
    setPage(old => ({ ...old, items: old.items.map(value => value.id === id ? { ...value, read: true } : value) }));
    try {
      const value = await rssCall<RssEntry>('rss.entry.get', { id });
      if (selectedRef.current === id) {
        setEntry(value);
        if (settings?.autoSummary && !value.summary) void summarizeById(id);
      }
    } catch (reason) {
      if (selectedRef.current === id) {
        selectedRef.current = ''; setSelectedId(''); setDetailBusy(false); setError(readable(reason));
      }
    } finally {
      if (selectedRef.current === id) setDetailBusy(false);
      void bootstrap().catch(() => {});
    }
  }
  async function openNext() {
    if (!entry) return;
    const now = Date.now();
    if (now - advanceAt.current < 650) return;
    advanceAt.current = now;
    const index = page.items.findIndex(item => item.id === entry.id);
    if (index < 0) return;
    let next: RssEntryItem | undefined = page.items[index + 1];
    if (!next && page.nextCursor) {
      const value = await load(false, true);
      next = value?.items[0];
    }
    if (next) await openEntry(next);
  }
  async function openPrevious() {
    if (!entry) return;
    const now = Date.now();
    if (now - advanceAt.current < 650) return;
    advanceAt.current = now;
    const index = page.items.findIndex(item => item.id === entry.id);
    if (index > 0) await openEntry(page.items[index - 1]);
  }
  async function markUnread() {
    if (!entry) return;
    const id = entry.id;
    autoReadSeen.current.delete(id);
    setEntry({ ...entry, read: false });
    setPage(old => ({ ...old, items: old.items.map(item => item.id === id ? { ...item, read: false } : item) }));
    try { await rssCall('rss.entry.mark-read', { id, read: false }); await bootstrap(); }
    catch (reason) { setError(readable(reason)); }
  }
  function scanAutoRead() {
    const root = listRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    const ids: string[] = [];
    root.querySelectorAll<HTMLElement>('.reading-row[data-read="0"]').forEach(row => {
      if (row.getBoundingClientRect().bottom > top + 1) return;
      const id = row.dataset.id;
      if (!id || autoReadSeen.current.has(id)) return;
      autoReadSeen.current.add(id);
      ids.push(id);
    });
    if (!ids.length) return;
    setPage(old => {
      let changed = 0;
      const items = old.items.map(item => {
        if (item.read || !ids.includes(item.id)) return item;
        changed++;
        return { ...item, read: true };
      });
      return changed ? { ...old, items, unread: Math.max(0, old.unread - changed) } : old;
    });
    autoReadQueue.current.push(...ids);
    if (!autoReadTimer.current) {
      autoReadTimer.current = window.setTimeout(() => { void flushAutoRead(); }, 400);
    }
  }
  async function flushAutoRead() {
    autoReadTimer.current = 0;
    const ids = autoReadQueue.current.splice(0);
    if (!ids.length) return;
    const results = await Promise.allSettled(ids.map(id => rssCall('rss.entry.mark-read', { id, read: true })));
    const failed = ids.filter((_, index) => results[index].status === 'rejected');
    if (failed.length) {
      for (const id of failed) autoReadSeen.current.delete(id);
      setPage(old => ({
        ...old,
        items: old.items.map(item => failed.includes(item.id) ? { ...item, read: false } : item),
        unread: old.unread + failed.length,
      }));
      const reason = (results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason;
      setError(readable(reason));
      return;
    }
    void bootstrap().catch(() => {});
  }
  function scheduleAutoRead() {
    if (scanTimer.current) return;
    scanTimer.current = window.setTimeout(() => { scanTimer.current = 0; scanAutoRead(); }, 120);
  }
  async function markAllRead() {
    if (markAllBusy || busy || !page.unread) return;
    setMarkAllBusy(true); setError(undefined);
    try {
      await rssCall('rss.entries.mark-all-read', {
        view, folderId: folderId || undefined, feedId: feedId || undefined, query: query.trim() || undefined,
      });
      await bootstrap();
      await load(true);
    } catch (reason) { setError(readable(reason)); }
    finally { setMarkAllBusy(false); }
  }
  async function toggleStar() {
    if (!entry) return;
    const starred = !entry.starred;
    setEntry({ ...entry, starred });
    setPage(old => ({ ...old, items: old.items.map(item => item.id === entry.id ? { ...item, starred } : item) }));
    try { await rssCall('rss.entry.star', { id: entry.id, starred }); await bootstrap(); }
    catch (reason) {
      setEntry(current => current ? { ...current, starred: !starred } : current);
      setError(readable(reason));
    }
  }
  async function summarizeById(id: string) {
    if (!settings) return;
    setSummaryBusy(true); setSummaryError(undefined);
    try {
      const result = await rssCall<{ summary: RssEntry['summary'] }>('rss.entry.summarize', { id, lang: settings.summaryLang });
      if (result.summary) {
        if (selectedRef.current === id) setEntry(current => current ? { ...current, summary: result.summary, hasSummary: true } : current);
        setPage(old => ({ ...old, items: old.items.map(item => item.id === id ? { ...item, hasSummary: true } : item) }));
      }
    } catch (reason) { if (selectedRef.current === id) setSummaryError(readable(reason)); }
    finally { setSummaryBusy(false); }
  }
  function openAssistant() {
    if (!entry) return;
    setAssistantOpen(true); setSummaryError(undefined); setAssistantOffset({ x: 0, y: 0 });
    if (!entry.summary && !summaryBusy) void summarizeById(entry.id);
  }
  function startAssistantDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    assistantDrag.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      ox: assistantOffset.x, oy: assistantOffset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveAssistantDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = assistantDrag.current, panel = assistantRef.current, layer = assistantLayerRef.current;
    if (!drag || drag.id !== event.pointerId || !panel || !layer) return;
    const maxLeft = Math.max(0, layer.clientWidth - panel.offsetWidth - 32);
    const maxDown = Math.max(0, layer.clientHeight - panel.offsetHeight - 32);
    setAssistantOffset({
      x: Math.min(0, Math.max(-maxLeft, drag.ox + event.clientX - drag.x)),
      y: Math.min(maxDown + 16, Math.max(-16, drag.oy + event.clientY - drag.y)),
    });
  }
  function endAssistantDrag(event: ReactPointerEvent<HTMLElement>) {
    if (assistantDrag.current?.id !== event.pointerId) return;
    assistantDrag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  async function refresh() {
    setBusy(true); setError(undefined);
    try {
      const result = await rssCall<{ checked: number; newEntries: number; failed: number }>('rss.feed.refresh', {});
      await bootstrap(); await load(true);
      ctx.ui.notify(result.newEntries > 0 ? tFormat('收到 {count} 篇新文章', { count: result.newEntries }) : t('已是最新'), 'success');
    } catch (reason) { setError(readable(reason)); }
    finally { setBusy(false); }
  }
  async function addFeed() {
    const url = feedUrl.trim(); if (!url) return;
    setBusy(true); setError(undefined);
    try {
      await rssCall('rss.feed.add', { url, folderId: folderId || undefined });
      setFeedUrl(''); setAddOpen(false); await bootstrap(); await load(true);
      ctx.ui.notify(t('订阅已添加'), 'success');
    } catch (reason) { setError(readable(reason)); }
    finally { setBusy(false); }
  }
  async function addFolder() {
    const name = folderName.trim(); if (!name) return;
    try { await rssCall('rss.folder.add', { name }); setFolderName(''); setAddingFolder(false); await bootstrap(); }
    catch (reason) { setError(readable(reason)); }
  }
  async function removeFeed(feed: RssFeed) {
    if (!(await ctx.ui.confirm(tFormat('删除订阅“{name}”及其本地文章？', { name: feed.title })))) return;
    try {
      await rssCall('rss.feed.remove', { id: feed.id });
      if (feedId === feed.id) setFeedId('');
      await bootstrap(); await load(true);
    } catch (reason) { setError(readable(reason)); }
  }
  async function moveFeedToFolder(id: string, targetFolderId: string) {
    const feed = feeds.find(item => item.id === id);
    if (!feed || (feed.folderId || '') === targetFolderId) return;
    try {
      await rssCall('rss.feed.move', { id, folderId: targetFolderId || undefined });
      await bootstrap(); await load(true);
      setExpandedFolders(current => {
        if (!targetFolderId) return current;
        const next = new Set(current); next.delete(targetFolderId); return next;
      });
      const name = folders.find(folder => folder.id === targetFolderId)?.name;
      ctx.ui.notify(name ? tFormat('已移动到“{name}”', { name }) : t('已移到未分组'), 'success');
    } catch (reason) { setError(readable(reason)); }
  }
  async function removeFolder(folder: RssFolder) {
    if (!(await ctx.ui.confirm(tFormat('删除分组“{name}”？分组内的订阅会移到未分组。', { name: folder.name })))) return;
    setMenu(undefined);
    try {
      await rssCall('rss.folder.remove', { id: folder.id });
      if (folderId === folder.id) setFolderId('');
      await bootstrap(); await load(true);
      ctx.ui.notify(t('分组已删除'), 'success');
    } catch (reason) { setError(readable(reason)); }
  }
  async function refreshFeed(feed: RssFeed) {
    setMenu(undefined);
    try {
      await rssCall('rss.feed.refresh', { id: feed.id });
      await bootstrap(); await load(true);
      ctx.ui.notify(t('订阅已刷新'), 'success');
    } catch (reason) { setError(readable(reason)); }
  }
  async function markFeedRead(feed: RssFeed) {
    setMenu(undefined);
    try {
      await rssCall('rss.entries.mark-all-read', { feedId: feed.id });
      await bootstrap();
      if (feedId === feed.id) await load(true);
      ctx.ui.notify(t('已全部标为已读'), 'success');
    } catch (reason) { setError(readable(reason)); }
  }
  function startSort(event: ReactPointerEvent<HTMLElement>, kind: 'feed' | 'folder', scope: string, id: string) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.reading-folder-toggle')) return;
    sortDrag.current = { kind, scope, id, x: event.clientX, y: event.clientY, active: false };
    window.addEventListener('pointermove', moveSort);
    window.addEventListener('pointerup', endSort);
    window.addEventListener('pointercancel', endSort);
  }
  function moveSort(event: PointerEvent) {
    const drag = sortDrag.current;
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
      drag.active = true;
      sortClickGuard.current = true;
      document.body.style.userSelect = 'none';
      setSortState({ kind: drag.kind, scope: drag.scope, id: drag.id });
    }
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-sort-id]');
    const overId = row && row.dataset.sortKind === drag.kind && row.dataset.sortScope === drag.scope
      ? row.dataset.sortId || '' : '';
    sortOver.current = overId;
    setSortState(current => current ? { ...current, overId: overId || undefined } : current);
  }
  function endSort() {
    const drag = sortDrag.current;
    sortDrag.current = undefined;
    window.removeEventListener('pointermove', moveSort);
    window.removeEventListener('pointerup', endSort);
    window.removeEventListener('pointercancel', endSort);
    document.body.style.userSelect = '';
    const overId = sortOver.current;
    sortOver.current = '';
    setSortState(undefined);
    if (!drag?.active) { sortClickGuard.current = false; return; }
    window.setTimeout(() => { sortClickGuard.current = false; }, 0);
    if (overId && overId !== drag.id) void applySort(drag.kind, drag.scope, drag.id, overId);
  }
  async function applySort(kind: 'feed' | 'folder', scope: string, id: string, overId: string) {
    const source = kind === 'folder'
      ? folders.map(folder => folder.id)
      : feeds.filter(feed => (feed.folderId || '') === scope).map(feed => feed.id);
    const from = source.indexOf(id), to = source.indexOf(overId);
    if (from < 0 || to < 0) return;
    const ids = [...source];
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    try {
      await rssCall(kind === 'folder' ? 'rss.folder.reorder' : 'rss.feed.reorder', { ids });
      await bootstrap();
    } catch (reason) { setError(readable(reason)); }
  }
  function feedMenu(event: ReactMouseEvent, feed: RssFeed) {
    event.preventDefault(); event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, feedId: feed.id });
  }
  function folderMenu(event: ReactMouseEvent, folder: RssFolder) {
    event.preventDefault(); event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, folderId: folder.id });
  }
  async function importOpml(file?: File) {
    if (!file) return;
    setImporting(true); setError(undefined);
    try {
      const content = await file.text();
      const result = await rssCall<{ imported: number; skipped: number }>('rss.opml.import', { content });
      await bootstrap(); await load(true);
      ctx.ui.notify(tFormat('已导入 {imported} 个订阅，跳过 {skipped} 个', result), 'success');
    } catch (reason) { setError(readable(reason)); }
    finally { setImporting(false); }
  }
  async function exportOpml() {
    try {
      const result = await rssCall<{ content: string }>('rss.opml.export');
      const url = URL.createObjectURL(new Blob([result.content], { type: 'application/xml' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ekko-reading.opml'; anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(readable(reason)); }
  }
  async function generateDigest() {
    setDigestBusy(true); setError(undefined);
    try {
      const result = await rssCall<{ digest: RssDigest }>('rss.digest.generate', { period: 'day' });
      setData(current => current ? { ...current, digest: result.digest } : current);
      setSelectedId(''); selectedRef.current = ''; setEntry(undefined);
      setFocus(false);
      setShowDigest(true);
    } catch (reason) { setError(readable(reason)); }
    finally { setDigestBusy(false); }
  }
  const feeds = data?.feeds || [], folders = data?.folders || [], counts = data?.counts;
  function selectView(next: 'all' | 'unread' | 'starred') {
    setView(next); setFolderId(''); setFeedId('');
    setFocus(false); setAssistantOpen(false); setSummaryError(undefined);
    setSelectedId(''); selectedRef.current = ''; setEntry(undefined); setShowDigest(false);
  }
  function selectFolder(id: string) {
    setFolderId(current => current === id ? '' : id); setFeedId(''); setView('all');
    setFocus(false); setAssistantOpen(false); setSummaryError(undefined);
    setSelectedId(''); selectedRef.current = ''; setEntry(undefined); setShowDigest(false);
  }
  function selectFeed(id: string) {
    setFeedId(current => current === id ? '' : id); setFolderId(''); setView('all');
    setFocus(false); setAssistantOpen(false); setSummaryError(undefined);
    setSelectedId(''); selectedRef.current = ''; setEntry(undefined); setShowDigest(false);
  }
  function toggleFolder(id: string) {
    setExpandedFolders(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function backToList() {
    selectedRef.current = ''; setSelectedId(''); setEntry(undefined); setDetailBusy(false);
    setShowDigest(false); setFocus(false); setAssistantOpen(false); setSummaryError(undefined);
  }
  const readerMode = !!selectedId && !showDigest;
  const articleStyle: Partial<ArticleStyle> = {
    theme: settings?.articleTheme, font: settings?.articleFont,
    fontSize: settings?.articleFontSize, lineHeight: settings?.articleLineHeight,
    width: settings?.articleWidth, customCss: settings?.articleCustomCss,
  };
  const menuFeed = menu?.feedId ? feeds.find(feed => feed.id === menu.feedId) : undefined;
  const menuFolder = menu?.folderId ? folders.find(folder => folder.id === menu.folderId) : undefined;
  const ungroupedFeeds = feeds.filter(feed => !feed.folderId);
  function renderFeed(feed: RssFeed, nested = false) {
    const scope = feed.folderId || '';
    const sorting = sortState?.kind === 'feed' && sortState.id === feed.id;
    const over = sortState?.kind === 'feed' && sortState.overId === feed.id;
    return <div key={feed.id} data-sort-id={feed.id} data-sort-kind="feed" data-sort-scope={scope}
      className={'reading-feed' + (nested ? ' nested' : '') + (feedId === feed.id ? ' active' : '') + (sorting ? ' sorting' : '') + (over ? ' sort-over' : '')}
      onContextMenu={event => feedMenu(event, feed)} onPointerDown={event => startSort(event, 'feed', scope, feed.id)}
      onClickCapture={event => { if (sortClickGuard.current) { event.preventDefault(); event.stopPropagation(); } }}>
      <button className="reading-feed-main" aria-pressed={feedId === feed.id} onClick={() => selectFeed(feed.id)}>
        <FeedAvatar feed={feed}/><span className="truncate" title={feed.title}>{feed.title}</span>
        {!!feed.unread && <b>{feed.unread}</b>}
      </button>
    </div>;
  }
  return <section className={'reading-view' + (focus ? ' focus' : '') + (readerMode ? ' article-open' : '')
    + (sourcesOpen ? ' sources-open' : ' sources-collapsed')}
    role="tabpanel" aria-label={t('阅读')}>
    <button className="reading-sources-scrim" aria-label={t('收起订阅源')} tabIndex={-1}
      onClick={() => setSourcesOpen(false)}/>
    <aside className="reading-sources" aria-label={t('阅读导航')}>
      <div className="reading-brand">
        <span className="reading-brand-icon"><Icon name="rss"/></span>
        <div><strong>{t('阅读')}</strong><span className="small">{data
          ? tFormat('{feeds} 个订阅 · {unread} 未读', { feeds: counts?.feeds || 0, unread: counts?.unread || 0 })
          : t('正在加载…')}</span></div>
      </div>
      <nav className="reading-nav" aria-label={t('阅读筛选')}>
        <button aria-pressed={view === 'all' && !folderId && !feedId && !showDigest} className={view === 'all' && !folderId && !feedId && !showDigest ? 'active' : ''} onClick={() => selectView('all')}><Icon name="book" sm/><span>{t('全部')}</span><b>{counts?.feeds || 0}</b></button>
        <button aria-pressed={view === 'unread'} className={view === 'unread' ? 'active' : ''} onClick={() => selectView('unread')}><Icon name="dot" sm/><span>{t('未读')}</span><b>{counts?.unread || 0}</b></button>
        <button aria-pressed={view === 'starred'} className={view === 'starred' ? 'active' : ''} onClick={() => selectView('starred')}><Icon name="star" sm/><span>{t('收藏')}</span><b>{counts?.starred || 0}</b></button>
        <button aria-pressed={showDigest} className={showDigest ? 'active' : ''} onClick={() => { setFocus(false); setShowDigest(true); setEntry(undefined); setSelectedId(''); selectedRef.current = ''; }}><Icon name="spark" sm/><span>{t('今日简报')}</span></button>
      </nav>
      <div className="reading-scroll">
        <div className="reading-section-head"><h3>{t('分组')}</h3><button className="ibtn" aria-label={t('添加分组')} title={t('添加分组')} onClick={() => setAddingFolder(value => !value)}><Icon name="plus" sm/></button></div>
        {folders.map(folder => {
          const open = expandedFolders.has(folder.id);
          const children = feeds.filter(feed => feed.folderId === folder.id);
          return <Fragment key={folder.id}>
            <div className={'reading-folder' + (folderId === folder.id ? ' active' : '')
              + (sortState?.kind === 'folder' && sortState.id === folder.id ? ' sorting' : '')
              + (sortState?.kind === 'folder' && sortState.overId === folder.id ? ' sort-over' : '')}
              data-sort-id={folder.id} data-sort-kind="folder" data-sort-scope=""
              onContextMenu={event => folderMenu(event, folder)}
              onPointerDown={event => startSort(event, 'folder', '', folder.id)}
              onClickCapture={event => { if (sortClickGuard.current) { event.preventDefault(); event.stopPropagation(); } }}>
              <button className="reading-folder-toggle" aria-expanded={open}
                aria-label={open ? tFormat('收起“{name}”', { name: folder.name }) : tFormat('展开“{name}”', { name: folder.name })}
                onClick={() => toggleFolder(folder.id)}><Icon name={open ? 'chevron-down' : 'chevron-right'} sm/></button>
              <button className="reading-folder-main" aria-pressed={folderId === folder.id}
                onClick={() => {
                  selectFolder(folder.id);
                  if (children.length) setExpandedFolders(current => new Set(current).add(folder.id));
                }}>
                <Icon name="folder" sm/><span className="truncate">{folder.name}</span>{!!folder.unread && <b>{folder.unread}</b>}
              </button>
            </div>
            {open && children.length > 0 && <div className="reading-folder-feeds">{children.map(feed => renderFeed(feed, true))}</div>}
          </Fragment>;
        })}
        {addingFolder && <form className="reading-add-form" onSubmit={event => { event.preventDefault(); void addFolder(); }}>
          <input value={folderName} onChange={event => setFolderName(event.target.value)} maxLength={30} placeholder={t('分组名称')} aria-label={t('分组名称')}/>
          <button className="primary" disabled={!folderName.trim()}>{t('添加')}</button>
        </form>}
        <div className="reading-section-head"><h3>{t('订阅源')}</h3><div className="reading-section-actions">
          <button className="ibtn" aria-label={t('发现订阅源')} title={t('发现订阅源')} onClick={() => setDiscoverOpen(true)}><Icon name="grid" sm/></button>
          <button className="ibtn" aria-label={t('添加订阅')} title={t('添加订阅')} onClick={() => setAddOpen(value => !value)}><Icon name="plus" sm/></button>
        </div></div>
        <div className="reading-feed-list">
          {ungroupedFeeds.map(feed => renderFeed(feed))}
        </div>
        {addOpen && <form className="reading-add-form" onSubmit={event => { event.preventDefault(); void addFeed(); }}>
          <input value={feedUrl} onChange={event => setFeedUrl(event.target.value)} type="url" placeholder="https://example.com/feed.xml" aria-label={t('订阅地址')} autoFocus/>
          <button className="primary" disabled={busy || !feedUrl.trim()}>{busy ? t('添加中…') : t('添加')}</button>
          <button type="button" className="reading-discover-link" onClick={() => { setAddOpen(false); setDiscoverOpen(true); }}>{t('浏览精选订阅源')}</button>
        </form>}
        {!feeds.length && !addOpen && <div className="reading-subscribe-actions">
          <button className="reading-subscribe-cta" onClick={() => setAddOpen(true)}><Icon name="plus" sm/>{t('添加第一个订阅')}</button>
          <button className="reading-subscribe-cta" onClick={() => setDiscoverOpen(true)}><Icon name="grid" sm/>{t('浏览精选订阅')}</button>
        </div>}
      </div>
      <div className="reading-sources-foot">
        <button onClick={() => opmlRef.current?.click()} disabled={importing}><Icon name="upload" sm/>{importing ? t('导入中…') : t('导入 OPML')}</button>
        <button onClick={() => void exportOpml()} disabled={!feeds.length}><Icon name="arrow-down" sm/>{t('导出')}</button>
        <input ref={opmlRef} className="reading-file" type="file" accept=".opml,.xml,text/xml,application/xml" onChange={event => { void importOpml(event.target.files?.[0]); event.currentTarget.value = ''; }}/>
      </div>
    </aside>
    <section className="reading-list-pane" aria-label={t('文章列表')}>
      <div className="reading-list-head">
        <button className="ibtn sources-toggle" aria-pressed={sourcesOpen}
          aria-label={sourcesOpen ? t('收起订阅源') : t('展开订阅源')}
          title={sourcesOpen ? t('收起订阅源') : t('展开订阅源')}
          onClick={() => setSourcesOpen(value => !value)}><Icon name="book" sm/></button>
        <div className="field"><Icon name="search" sm/><input type="search" value={query} aria-label={t('搜索文章')} placeholder={t('搜索标题、摘要')} onChange={event => setQuery(event.target.value)}/></div>
        <button className="ibtn" aria-label={t('全部标为已读')} title={t('全部标为已读')} disabled={busy || markAllBusy || !page.unread} onClick={() => void markAllRead()}><Icon name="check" sm/></button>
        <button className="ibtn" aria-label={t('刷新订阅')} title={t('刷新订阅')} disabled={busy} onClick={() => void refresh()}><Icon name="refresh" sm/></button>
      </div>
      {error && <div className="state bad" role="alert"><Icon name="alert"/><div><strong>{t('操作未完成')}</strong><p>{error.message}</p>
        <button className="compact" onClick={() => setError(undefined)}>{t('关闭提示')}</button></div></div>}
      <div className="reading-list" ref={listRef} aria-busy={busy || moreBusy} onScroll={scheduleAutoRead}>
        {busy && !page.items.length && <div className="reading-loading" role="status"><span className="spin"/><span>{t('正在加载…')}</span></div>}
        {!busy && !page.items.length && <div className="reading-empty">
          <span className="ring"><Icon name={feeds.length ? 'search' : 'rss'}/></span>
          <h3>{feeds.length ? t('没有符合条件的文章') : t('还没有订阅')}</h3>
          {feeds.length
            ? <button className="compact" onClick={() => { setQuery(''); selectView('all'); }}>{t('清除筛选')}</button>
            : <button className="primary" onClick={() => setAddOpen(true)}>{t('添加订阅')}</button>}
        </div>}
        {page.items.map(item => <button key={item.id} data-id={item.id} data-read={item.read ? '1' : '0'} className={'reading-row' + (selectedId === item.id ? ' sel' : '') + (item.read ? '' : ' unread')} onClick={() => void openEntry(item)} aria-current={selectedId === item.id || undefined}>
          <span className="reading-row-top"><span className="source truncate">{item.feedTitle}</span><time>{relative(item.publishedAt)}</time></span>
          <span className="reading-row-body">
            {item.image && settings?.remoteImages !== false && <img className="reading-thumb" src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer"
              onError={event => { event.currentTarget.style.display = 'none'; }}/>}
            <span className="reading-row-main">
              <span className="reading-row-title">{item.title}</span>
              {item.snippet && <span className="reading-row-snippet">{item.snippet}</span>}
              <span className="reading-row-meta">{item.hasSummary && <span className="tag">{t('AI 摘要')}</span>}{item.starred && <Icon name="star" sm/>}{item.author && <span className="truncate">{item.author}</span>}</span>
            </span>
          </span>
        </button>)}
        <div ref={sentinelRef} className="reading-sentinel" aria-hidden="true"/>
        {moreBusy && <div className="reading-loading" role="status"><span className="spin"/></div>}
        {!busy && !moreBusy && page.items.length > 0 && !page.nextCursor &&
          <div className="reading-list-end">{tFormat('已加载全部 {count} 篇', { count: page.total })}</div>}
      </div>
      <div className="sbar" role="status"><Icon name="rss" sm/><span>{tFormat('{total} 篇 · {unread} 未读', { total: page.total, unread: page.unread })}</span>
        <span className="spacer"/><span>{data?.lastSyncAt ? tFormat('已同步 · {time}', { time: relative(data.lastSyncAt) }) : t('仅本地缓存')}</span></div>
    </section>
    <section className="reading-detail-pane" aria-label={t('阅读详情')}>
      {detailBusy && !entry
        ? <div className="reading-detail-loading">
          <button className="reading-back" aria-label={t('返回列表')} title={t('返回列表')}
            onClick={backToList}>
            <span className="reading-back-icon" aria-hidden="true"><Icon name="arrow-left" sm/></span>
            <span>{t('返回列表')}</span>
          </button>
          <div className="reading-loading" role="status"><span className="spin"/><span>{t('正在打开…')}</span></div>
        </div>
        : entry ? <>
          <header className="reading-detail-head">
            <div className="reading-detail-nav">
              <button className="reading-back" aria-label={t('返回列表')} title={t('返回列表')}
                onClick={backToList}>
                <span className="reading-back-icon" aria-hidden="true"><Icon name="arrow-left" sm/></span>
                <span>{t('返回列表')}</span>
              </button>
              <div className="reading-detail-actions">
                <button className={focus ? 'active' : ''} aria-pressed={focus}
                  aria-label={focus ? t('退出专注阅读') : t('专注阅读')}
                  title={focus ? t('退出专注阅读') : t('专注阅读')}
                  onClick={() => setFocus(value => !value)}><Icon name={focus ? 'collapse' : 'expand'} sm/></button>
                <button className={assistantOpen ? 'active' : ''} aria-pressed={assistantOpen}
                  aria-label={assistantOpen ? t('关闭 AI 解读') : t('AI 解读')} aria-expanded={assistantOpen}
                  title={assistantOpen ? t('关闭 AI 解读') : t('AI 解读')}
                  onClick={() => assistantOpen ? setAssistantOpen(false) : openAssistant()}><Icon name="spark" sm/></button>
                <button className={entry.starred ? 'active' : ''} aria-pressed={entry.starred} aria-label={entry.starred ? t('取消收藏') : t('收藏')} title={entry.starred ? t('取消收藏') : t('收藏')} onClick={() => void toggleStar()}><Icon name="star" sm/></button>
                <button aria-label={t('标为未读')} title={t('标为未读')} onClick={() => void markUnread()}><Icon name="dot" sm/></button>
                <a href={entry.url} target="_blank" rel="noreferrer noopener" aria-label={t('查看原文')} title={t('查看原文')}><Icon name="external" sm/></a>
              </div>
            </div>
            <div className="reading-detail-title">
              <div className="reading-detail-body">
                <FeedAvatar feed={{ title: entry.feedTitle, icon: entry.feedIcon }}/>
                <div><h2>{entry.title}</h2>
                  <p className="meta">{entry.author && <span>{entry.author} · </span>}
                    <span className="source truncate">{entry.feedTitle}</span>
                    <time>{new Date(entry.publishedAt).toLocaleString('zh-CN')}</time></p></div>
              </div>
            </div>
          </header>
          <div className="reading-article">
            {entry.contentHtml
              ? <ArticleFrame html={entry.contentHtml} remoteImages={settings?.remoteImages !== false}
                articleStyle={articleStyle}
                onPrevious={() => void openPrevious()} onNext={() => void openNext()}/>
              : <p className="reading-plain" onWheel={event => {
                const node = event.currentTarget;
                if (event.deltaY < 0 && node.scrollTop <= 24) void openPrevious();
                else if (event.deltaY > 0 && node.scrollTop + node.clientHeight >= node.scrollHeight - 24) void openNext();
              }}>{entry.contentText || entry.snippet}</p>}
          </div>
        </> : showDigest ? <div className="reading-digest">
          <header className="reading-digest-head">
            <span className="eyebrow">AI · {t('今日简报')}</span>
            <h2>{data?.digest?.title || t('今日简报')}</h2>
            {data?.digest?.overview && <p className="reading-digest-overview">{data.digest.overview}</p>}
            <div className="row wrap"><button className="primary" disabled={digestBusy} onClick={() => void generateDigest()}><Icon name="spark" sm/>{digestBusy ? t('生成中…') : data?.digest ? t('重新生成') : t('生成今日简报')}</button>
              {data?.digest && <span className="small">{new Date(data.digest.createdAt).toLocaleString('zh-CN')}</span>}</div>
          </header>
          {data?.digest?.sections.map((section, index) => <section key={index} className="reading-digest-section">
            <h3>{section.name}</h3>
            {section.items.map(item => <button key={item.entryId} className="reading-digest-item" onClick={() => void openById(item.entryId)}>
              <span className="source truncate">{item.source}</span><strong>{item.title}</strong>{item.line && <span className="line">{item.line}</span>}
            </button>)}
          </section>)}
        </div> : <div className="reading-empty">
          <span className="ring"><Icon name="book"/></span><h3>{t('选择一篇文章')}</h3>
        </div>}
    </section>
    {assistantOpen && entry && <div className="reading-assistant-layer" ref={assistantLayerRef}>
      <aside className="reading-assistant" ref={assistantRef} aria-label={t('AI 解读')}
        style={{ transform: `translate(${assistantOffset.x}px, ${assistantOffset.y}px)` }}>
        <header className="reading-assistant-head" onPointerDown={startAssistantDrag}
          onPointerMove={moveAssistantDrag} onPointerUp={endAssistantDrag} onPointerCancel={endAssistantDrag}>
          <div><span className="eyebrow">EKKO AI</span><h3>{t('AI 解读')}</h3></div>
          <button className="ibtn" aria-label={t('关闭面板')} title={t('关闭面板')} onClick={() => setAssistantOpen(false)}><Icon name="close" sm/></button>
        </header>
        <div className="reading-assistant-body" aria-busy={summaryBusy}>
          {summaryError
            ? <div className="state bad" role="alert"><Icon name="alert"/><div>
              <strong>{t('操作未完成')}</strong><p>{summaryError.message}</p>
              {summaryError.category === 'configuration' && <p className="small">{t('请在阅读设置中配置 AI 服务。')}</p>}
              <button className="compact" onClick={() => void summarizeById(entry.id)}>{t('重试')}</button>
            </div></div>
            : summaryBusy && !entry.summary
              ? <div className="reading-assistant-loading" role="status"><span className="spin"/><span>{t('生成中…')}</span></div>
              : entry.summary
                ? <article className="reading-assistant-summary">
                  <p className="reading-tldr">{entry.summary.tldr}</p>
                  <ul>{entry.summary.points.map((point, index) => <li key={index}>{point}</li>)}</ul>
                  {entry.summary.whyRead && <p className="reading-why"><strong>{t('值得一读')}</strong>{entry.summary.whyRead}</p>}
                  {!!entry.summary.tags.length && <div className="reading-tags">{entry.summary.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
                </article>
                : <div className="reading-assistant-empty">
                  <span className="ring"><Icon name="spark"/></span>
                  <p>{t('生成一句话摘要、要点和推荐理由。')}</p>
                  <button className="primary" onClick={() => void summarizeById(entry.id)}>{t('生成摘要')}</button>
                </div>}
        </div>
        {entry.summary && <footer className="reading-assistant-foot">
          <span>{entry.summary.model}</span>
          <button className="compact" disabled={summaryBusy} onClick={() => void summarizeById(entry.id)}>
            <Icon name="refresh" sm/>{summaryBusy ? t('生成中…') : t('重新生成')}
          </button>
        </footer>}
      </aside>
    </div>}
    {discoverOpen && <ReadingDiscover ctx={ctx} feeds={feeds} folders={folders} defaultFolderId={folderId}
      onClose={() => setDiscoverOpen(false)} onChanged={async () => { await bootstrap(); await load(true); }}/>}
    {menu && createPortal(<div className="reading-menu" role="menu"
      style={{
        left: Math.max(8, Math.min(menu.x, window.innerWidth - 232)),
        top: Math.max(8, Math.min(menu.y, window.innerHeight - 340)),
      }}
      onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
      {menuFeed ? <>
        <div className="reading-menu-title truncate">{menuFeed.title}</div>
        <div className="reading-menu-label">{t('移动到分组')}</div>
        <button role="menuitem" className={menuFeed.folderId ? '' : 'active'}
          onClick={() => { setMenu(undefined); void moveFeedToFolder(menuFeed.id, ''); }}>
          <Icon name="folder" sm/><span>{t('未分组')}</span>
        </button>
        {folders.map(folder => <button key={folder.id} role="menuitem"
          className={menuFeed.folderId === folder.id ? 'active' : ''}
          onClick={() => { setMenu(undefined); void moveFeedToFolder(menuFeed.id, folder.id); }}>
          <Icon name="folder" sm/><span className="truncate">{folder.name}</span>
        </button>)}
        <div className="reading-menu-sep"/>
        <button role="menuitem" onClick={() => void markFeedRead(menuFeed)}>
          <Icon name="check" sm/><span>{t('全部标为已读')}</span>
        </button>
        <button role="menuitem" onClick={() => void refreshFeed(menuFeed)}>
          <Icon name="refresh" sm/><span>{t('刷新此订阅')}</span>
        </button>
        <button role="menuitem" className="danger" onClick={() => { setMenu(undefined); void removeFeed(menuFeed); }}>
          <Icon name="trash" sm/><span>{t('删除订阅')}</span>
        </button>
      </> : menuFolder ? <>
        <div className="reading-menu-title truncate">{menuFolder.name}</div>
        <button role="menuitem" className="danger" onClick={() => void removeFolder(menuFolder)}>
          <Icon name="trash" sm/><span>{t('删除分组')}</span>
        </button>
      </> : null}
    </div>, document.body)}
  </section>;
}
