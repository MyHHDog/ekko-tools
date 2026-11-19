import { useEffect, useMemo, useState } from 'react';
import type { ClientHost } from '../adapter/host';
import type { RssFeed, RssFolder } from '../../shared/rss';
import {
  feedCatalog, feedCategories, feedHost, normalizeFeedUrl,
  type FeedCatalogItem, type FeedCategoryId,
} from '../../shared/feed-catalog';
import { call, readable } from '../rpc-client';
import { Icon } from '../components/States';
import { t, tFormat } from '../i18n';

function categoryName(id: FeedCategoryId) {
  return feedCategories.find(item => item.id === id)?.name || id;
}

export function ReadingDiscover({ ctx, feeds, folders, defaultFolderId, onClose, onChanged }: {
  ctx: ClientHost; feeds: RssFeed[]; folders: RssFolder[]; defaultFolderId: string;
  onClose: () => void; onChanged: () => Promise<void> | void;
}) {
  const [category, setCategory] = useState<'all' | FeedCategoryId>('all');
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [pending, setPending] = useState('');
  const [error, setError] = useState<any>();
  const subscribed = useMemo(() => new Set(feeds.map(feed => normalizeFeedUrl(feed.url))), [feeds]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return feedCatalog.filter(item => {
      if (category !== 'all' && item.category !== category) return false;
      if (!needle) return true;
      return [item.title, item.description, categoryName(item.category), feedHost(item.url)]
        .some(value => value.toLocaleLowerCase().includes(needle));
    });
  }, [category, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function subscribe(item: FeedCatalogItem) {
    setPending(item.url); setError(undefined);
    try {
      await call(ctx, 'rss.feed.add', { url: item.url, folderId: folderId || undefined, __owner: 'reading' });
      await onChanged();
      ctx.ui.notify(tFormat('已订阅“{name}”', { name: item.title }), 'success');
    } catch (reason) {
      setError(readable(reason));
    } finally {
      setPending('');
    }
  }

  return <div className="reading-discover" role="dialog" aria-modal="true" aria-label={t('发现订阅源')}>
    <div className="reading-discover-panel">
    <header className="reading-discover-head">
      <div className="reading-discover-title">
        <span className="reading-brand-icon"><Icon name="rss"/></span>
        <div><h2>{t('发现订阅源')}</h2>
          <p className="small">{tFormat('{count} 个精选源，已验证可用。', { count: feedCatalog.length })}</p></div>
      </div>
      <button className="ibtn" aria-label={t('关闭面板')} title={t('关闭面板')} onClick={onClose}><Icon name="close" sm/></button>
    </header>
    <div className="reading-discover-tools">
      <div className="field"><Icon name="search" sm/><input type="search" value={query} aria-label={t('搜索订阅源')}
        placeholder={t('搜索订阅源')} onChange={event => setQuery(event.target.value)}/></div>
      {folders.length > 0 && <label className="reading-discover-folder"><span>{t('订阅到')}</span>
        <select value={folderId} aria-label={t('订阅到')} onChange={event => setFolderId(event.target.value)}>
          <option value="">{t('不分组')}</option>
          {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select></label>}
    </div>
    <div className="reading-discover-cats" role="tablist" aria-label={t('订阅分类')}>
      <button role="tab" aria-selected={category === 'all'} className={category === 'all' ? 'active' : ''}
        onClick={() => setCategory('all')}>{t('全部')}<b>{feedCatalog.length}</b></button>
      {feedCategories.map(item => <button key={item.id} role="tab" aria-selected={category === item.id}
        className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>
        {t(item.name)}<b>{feedCatalog.filter(feed => feed.category === item.id).length}</b>
      </button>)}
    </div>
    {error && <div className="reading-discover-error" role="alert"><Icon name="alert" sm/>
      <span>{error.message}</span><button className="compact" onClick={() => setError(undefined)}>{t('关闭提示')}</button></div>}
    <div className="reading-discover-scroll">
      {filtered.length ? <div className="reading-discover-grid">
        {filtered.map(item => {
          const added = subscribed.has(normalizeFeedUrl(item.url));
          const busy = pending === item.url;
          return <article key={item.id} className={'reading-discover-card' + (added ? ' added' : '')} aria-label={item.title}>
            <div className="reading-discover-card-head">
              <span className="feed-avatar" aria-hidden="true"><b>{item.title[0]}</b></span>
              <div className="reading-discover-card-name"><h3>{item.title}</h3><span>{feedHost(item.url)}</span></div>
            </div>
            <p>{item.description}</p>
            <div className="reading-discover-card-foot">
              <div className="reading-discover-tags"><span className="tag">{t(categoryName(item.category))}</span>
                {item.via && <span className="tag via">{item.via}</span>}</div>
              <div className="reading-discover-actions">
                <a href={item.siteUrl} target="_blank" rel="noreferrer noopener"
                  aria-label={tFormat('预览 {name}', { name: item.title })}>{t('预览')}</a>
                {added ? <span className="reading-discover-added"><Icon name="check" sm/>{t('已订阅')}</span>
                  : <button className="primary" disabled={busy} aria-label={tFormat('订阅 {name}', { name: item.title })}
                    onClick={() => void subscribe(item)}>{busy ? t('订阅中…') : t('订阅')}</button>}
              </div>
            </div>
          </article>;
        })}
      </div> : <div className="reading-discover-empty"><span className="ring"><Icon name="search"/></span>
        <h3>{t('没有匹配的订阅源')}</h3>
        <button className="compact" onClick={() => { setQuery(''); setCategory('all'); }}>{t('清除筛选')}</button>
      </div>}
    </div>
    </div>
  </div>;
}
