import { useEffect, useState } from 'react';
import type { ClientHost } from '../../adapter/host';
import type { RssSettings } from '../../../shared/rss';
import { defaultRssSettings } from '../../../shared/rss';
import { call, readable } from '../../rpc-client';
import { Icon } from '../../components/States';
import { t } from '../../i18n';

const aiPresets = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { id: 'ollama', label: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1' },
] as const;
const articleThemes = [
  { id: 'paper', label: '纸白' },
  { id: 'sepia', label: '暖褐' },
  { id: 'dark', label: '深色' },
] as const;
const articleFonts = [
  { id: 'serif', label: '衬线' },
  { id: 'sans', label: '无衬线' },
  { id: 'mono', label: '等宽' },
] as const;

function validProxy(mode: RssSettings['proxyMode'], value: string) {
  if (mode !== 'custom') return true;
  const input = value.trim();
  if (!input) return false;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`);
    return /^https?:$/.test(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function ReadingSettings({ ctx }: { ctx: ClientHost }) {
  const [draft, setDraft] = useState<RssSettings>(defaultRssSettings);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(), [saved, setSaved] = useState(false);
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState(''), [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiConfigured, setOpenaiConfigured] = useState(false), [presetId, setPresetId] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      call<{ settings: RssSettings; aiConfigured?: boolean }>(ctx, 'rss.settings.get', { __owner: 'reading' }),
      call<{ openaiBaseUrl?: string }>(ctx, 'settings.get'),
    ])
      .then(([rss, ai]) => {
        if (!active) return;
        setDraft({ ...defaultRssSettings, ...rss.settings }); setOpenaiBaseUrl(ai.openaiBaseUrl || '');
        setOpenaiConfigured(rss.aiConfigured === true); setLoading(false);
      })
      .catch(reason => { if (active) { setError(readable(reason)); setLoading(false); } });
    return () => { active = false; };
  }, []);

  function change(next: Partial<RssSettings>) {
    setDraft(current => ({ ...current, ...next }));
    setSaved(false);
  }
  function resetArticleStyle() {
    change({
      articleTheme: defaultRssSettings.articleTheme, articleFont: defaultRssSettings.articleFont,
      articleFontSize: defaultRssSettings.articleFontSize, articleLineHeight: defaultRssSettings.articleLineHeight,
      articleWidth: defaultRssSettings.articleWidth, articleCustomCss: '',
    });
  }

  async function save() {
    setBusy(true); setError(undefined); setSaved(false);
    try {
      if (!validProxy(draft.proxyMode, draft.proxyUrl)) {
        setError({ message: t('请填写有效的代理地址。') });
        return;
      }
      if (draft.summaryProvider === 'openai') {
        await call(ctx, 'settings.save', {
          openaiBaseUrl: openaiBaseUrl.trim(), openaiApiKey: openaiApiKey.trim(),
        });
      }
      const result = await call<{ settings: RssSettings; aiConfigured?: boolean }>(ctx, 'rss.settings.save', { ...draft, __owner: 'reading' });
      setDraft(result.settings); setOpenaiConfigured(result.aiConfigured === true);
      if (openaiApiKey) setOpenaiApiKey('');
      setSaved(true); ctx.ui.notify(t('阅读设置已保存'), 'success');
    } catch (reason) { setError(readable(reason)); }
    finally { setBusy(false); }
  }

  return <section className="settings-section" aria-label={t('阅读设置')}>
    <div className="section-heading"><div><h2>{t('阅读设置')}</h2><p className="small">{t('订阅抓取、全文提取与 AI 摘要。')}</p></div></div>
    <div className="card settings-form reading-settings" aria-busy={loading}>
      <div className="reading-settings-grid">
        <label>{t('摘要服务')}
          <select value={draft.summaryProvider} onChange={event => change({ summaryProvider: event.target.value as RssSettings['summaryProvider'] })}>
            <option value="hostModel">{t('宿主模型')}</option>
            <option value="openai">{t('OpenAI 兼容')}</option>
          </select>
        </label>
        {draft.summaryProvider === 'openai'
          ? <>
            <label className="span-2">{t('接口地址')}
              <input value={openaiBaseUrl} onChange={event => { setPresetId(''); setOpenaiBaseUrl(event.target.value); }} placeholder="https://api.openai.com/v1" autoComplete="off"/>
            </label>
            <label className="span-2">{t('快速填入服务')}
              <select value={presetId} onChange={event => {
                setPresetId(event.target.value);
                const preset = aiPresets.find(item => item.id === event.target.value);
                if (preset) { setOpenaiBaseUrl(preset.baseUrl); change({ summaryModel: preset.model }); }
              }}>
                <option value="">{t('选择常用服务')}</option>
                {aiPresets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>{t('API Key')}
              <input type="password" value={openaiApiKey} placeholder={openaiConfigured ? t('已保存；留空保持原密钥') : t('填写 API Key（本地服务可留空）')}
                onChange={event => setOpenaiApiKey(event.target.value)} autoComplete="new-password"/>
            </label>
            <label>{t('摘要模型')}
              <input value={draft.summaryModel} maxLength={200} placeholder="gpt-4o-mini / deepseek-chat" onChange={event => change({ summaryModel: event.target.value })}/>
            </label>
          </>
          : <label>{t('摘要模型')}
            <input value={draft.summaryModel} maxLength={200} placeholder={t('留空使用默认模型')} onChange={event => change({ summaryModel: event.target.value })}/>
          </label>}
        <label>{t('摘要语言')}
          <select value={draft.summaryLang} onChange={event => change({ summaryLang: event.target.value as RssSettings['summaryLang'] })}>
            <option value="zh">{t('简体中文')}</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>{t('轮询间隔（分钟）')}
          <input type="number" min={5} max={120} value={draft.pollMinutes} onChange={event => change({ pollMinutes: Number(event.target.value) })}/>
        </label>
        <label>{t('保留天数')}
          <input type="number" min={7} max={365} value={draft.retentionDays} onChange={event => change({ retentionDays: Number(event.target.value) })}/>
        </label>
        <label>{t('每源文章上限')}
          <input type="number" min={50} max={2000} step={50} value={draft.maxEntriesPerFeed} onChange={event => change({ maxEntriesPerFeed: Number(event.target.value) })}/>
        </label>
      </div>
      <label className="notify-row"><span><strong>{t('打开文章时提取全文')}</strong><small>{t('从原文页面提取正文，失败时保留订阅源内容。')}</small></span>
        <input type="checkbox" checked={draft.fullText} onChange={event => change({ fullText: event.target.checked })}/><span className="notify-switch" aria-hidden="true"/></label>
      <label className="notify-row"><span><strong>{t('显示远程图片')}</strong><small>{t('文章内图片直接加载；关闭后只显示内嵌图片。')}</small></span>
        <input type="checkbox" checked={draft.remoteImages} onChange={event => change({ remoteImages: event.target.checked })}/><span className="notify-switch" aria-hidden="true"/></label>
      <label className="notify-row"><span><strong>{t('自动生成摘要')}</strong><small>{t('打开文章时自动生成 AI 摘要。')}</small></span>
        <input type="checkbox" checked={draft.autoSummary} onChange={event => change({ autoSummary: event.target.checked })}/><span className="notify-switch" aria-hidden="true"/></label>
      <div className="reading-style-block">
        <div className="reading-style-head">
          <div><strong>{t('网络代理')}</strong><small>{t('订阅抓取使用的网络代理。')}</small></div>
        </div>
        <div className="reading-settings-grid">
          <label>{t('代理方式')}
            <select value={draft.proxyMode} onChange={event => change({ proxyMode: event.target.value as RssSettings['proxyMode'] })}>
              <option value="system">{t('跟随系统代理')}</option>
              <option value="custom">{t('自定义代理')}</option>
              <option value="none">{t('不使用代理')}</option>
            </select>
          </label>
          {draft.proxyMode === 'custom' && <label className="span-2">{t('代理地址')}
            <input value={draft.proxyUrl} maxLength={2048} placeholder={t('例如 http://127.0.0.1:7890')}
              onChange={event => change({ proxyUrl: event.target.value })} autoComplete="off"/>
          </label>}
        </div>
        <p className="small reading-style-hint">{t('支持 HTTP/HTTPS 代理；系统代理会读取环境变量或操作系统设置。')}</p>
      </div>
      <div className="reading-style-block">
        <div className="reading-style-head">
          <div><strong>{t('正文样式')}</strong><small>{t('只影响阅读文章正文，可覆盖字体、字号、版心、配色与细节。')}</small></div>
          <button type="button" className="compact" onClick={resetArticleStyle}>{t('恢复默认')}</button>
        </div>
        <div className="reading-settings-grid">
          <label>{t('正文主题')}
            <select value={draft.articleTheme} onChange={event => change({ articleTheme: event.target.value as RssSettings['articleTheme'] })}>
              {articleThemes.map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
            </select>
          </label>
          <label>{t('正文字体')}
            <select value={draft.articleFont} onChange={event => change({ articleFont: event.target.value as RssSettings['articleFont'] })}>
              {articleFonts.map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
            </select>
          </label>
          <label>{t('正文字号')}
            <input type="number" min={12} max={24} value={draft.articleFontSize} onChange={event => change({ articleFontSize: Number(event.target.value) })}/>
          </label>
          <label>{t('正文行高')}
            <input type="number" min={1.4} max={2.4} step={0.05} value={draft.articleLineHeight} onChange={event => change({ articleLineHeight: Number(event.target.value) })}/>
          </label>
          <label className="span-2">{t('正文版心宽度')}
            <input type="number" min={520} max={1024} step={20} value={draft.articleWidth} onChange={event => change({ articleWidth: Number(event.target.value) })}/>
          </label>
        </div>
        <label className="reading-style-css">{t('自定义 CSS')}
          <textarea value={draft.articleCustomCss} maxLength={12000} spellCheck={false}
            placeholder={'body { letter-spacing: .01em; }\np:first-of-type::first-letter { font-size: 2.4em; }'}
            onChange={event => change({ articleCustomCss: event.target.value })}/>
        </label>
        <p className="small reading-style-hint">{t('自定义 CSS 会在预设样式之后生效；为安全起见会移除 url()、@import、固定定位与脚本类声明。')}</p>
      </div>
      {error && <p className="state bad" role="alert"><Icon name="alert"/><span>{error.message}</span></p>}
      {saved && <p className="state" role="status"><Icon name="check"/><span>{t('阅读设置已保存')}</span></p>}
      <div className="row wrap"><button type="button" className="primary" disabled={busy || loading} onClick={() => void save()}>{busy ? t('正在保存…') : t('保存设置')}</button></div>
    </div>
  </section>;
}
