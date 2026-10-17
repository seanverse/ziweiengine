'use client';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ZiweiChart, Palace, SiHua } from '@/lib/ziwei/types';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import type { TimeView } from './TimeNav';
import { streamInterpret, streamSSE } from '@/lib/api/interpret-client';
import { TOPIC_QUESTIONS } from '@/lib/ai/topic-questions';

const questionFor = (key: string) => (TOPIC_QUESTIONS as Record<string, string>)[key] ?? '';
import MarkdownContent from './MarkdownContent';
import type { SourceItem } from '@/lib/ai/sources/types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  hidden?: boolean; // don't show user bubble for auto/topic messages
}

interface SelectedSiHua {
  starName: string;
  siHua: string;
  view: TimeView;
}

interface InsightPanelProps {
  chart: ZiweiChart;
  selectedPalace?: Palace | null;
  selectedSiHua?: SelectedSiHua | null;
  view?: TimeView;
  liunianYear?: number;
}

const TOPICS = [
  { key: 'overview',     label: '命格' },
  { key: 'love',        label: '感情' },
  { key: 'career',      label: '事业' },
  { key: 'wealth',      label: '财运' },
  { key: 'health',      label: '健康' },
  { key: 'personality', label: '性格' },
] as const;

const PALACE_ROLES: Record<string, string> = {
  '命宫':   '自我、性格、先天格局',
  '兄弟宫': '兄弟关系、合伙人',
  '夫妻宫': '感情关系、婚姻状态',
  '子女宫': '子女缘分、下属关系',
  '财帛宫': '财运来源、收入方式',
  '疾厄宫': '身体健康、意外',
  '迁移宫': '外出机遇、人际格局',
  '交友宫': '朋友圈、贵人、小人',
  '官禄宫': '事业成就、社会地位',
  '田宅宫': '不动产、家庭环境',
  '福德宫': '精神享受、内心福分',
  '父母宫': '父母关系、文书契约',
};

/** Render AI markdown: **【Title】** → gold header, **bold** → strong */
export default function InsightPanel({ chart, selectedPalace, selectedSiHua, view, liunianYear }: InsightPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTopic, setActiveTopic] = useState<string>('overview');
  const messagesRef = useRef<Message[]>([]); // always-current copy for closures
  const loadingRef = useRef(false);
  const autoLoaded = useRef(false);
  const lastPalaceBranch = useRef<number | undefined>(undefined);
  const lastSiHuaKey = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);
  const activeTopicRef = useRef<TopicKey>('overview');
  const sourcesRef = useRef<SourceItem[]>([]);
  const topicCacheRef = useRef<Partial<Record<TopicKey, { text: string; sources: SourceItem[] }>>>({});

  // Keep refs in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sourcesRef.current = sources; }, [sources]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { activeTopicRef.current = activeTopic as TopicKey; }, [activeTopic]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 首次进入：一次请求生成全部 Tab
  useEffect(() => {
    if (autoLoaded.current) return;
    autoLoaded.current = true;
    loadBatch(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Inject palace analysis when palace selected
  useEffect(() => {
    if (!selectedPalace || selectedPalace.branch === lastPalaceBranch.current) return;
    lastPalaceBranch.current = selectedPalace.branch;

    const majorStars = selectedPalace.stars.filter(s => s.type === 'major');
    const starDesc = majorStars.length > 0
      ? majorStars.map(s => `${s.name}${s.siHua ? '化' + s.siHua : ''}`).join('、')
      : '空宫（借对宫）';
    const role = PALACE_ROLES[selectedPalace.name] ?? '';

    const prompt = `请重点分析【${selectedPalace.name}】（主管：${role}），该宫主星为${starDesc}，按以下结构输出：

**【宫位定性】**
${selectedPalace.name}在命盘中的意义，以及这种星曜配置的整体判断。

**【主星解读】**
主星在此宫的倪海厦体系解读，引用具体观点。

**【三方四正联动】**
三方四正宫位对此宫的影响。

**【实际建议】**
基于此宫的具体建议。`;

    sendMessage(prompt, true);
  }, [selectedPalace]); // eslint-disable-line react-hooks/exhaustive-deps

  // 注入四化飞化分析
  useEffect(() => {
    if (!selectedSiHua) return;
    const key = `${selectedSiHua.starName}-${selectedSiHua.siHua}-${selectedSiHua.view}`;
    if (key === lastSiHuaKey.current) return;
    lastSiHuaKey.current = key;

    // 找出该星所在宫位
    const palaceOfStar = chart.palaces.find(p =>
      p.stars.some(s => s.name === selectedSiHua.starName)
    );
    const palaceName = palaceOfStar?.name ?? '未知宫位';
    const viewLabel = selectedSiHua.view === 'daxian' ? '大限' : '流年';

    const prompt = `请分析【${viewLabel}${selectedSiHua.starName}化${selectedSiHua.siHua}】的飞化影响，按以下结构输出：

**【化${selectedSiHua.siHua}基本含义】**
化${selectedSiHua.siHua}在倪海厦体系中的核心含义，以及${selectedSiHua.starName}化${selectedSiHua.siHua}的特殊含义。

**【落宫影响】**
${selectedSiHua.starName}化${selectedSiHua.siHua}落在【${palaceName}】，该宫主管的领域受到何种影响，倪师如何解读。

**【三方四正飞化路径】**
化${selectedSiHua.siHua}入${palaceName}后，对其三方四正（对宫、两个三合宫）的联动影响。

**【当前运势影响】**
在${viewLabel}时间维度下，此化${selectedSiHua.siHua}对命主近期运势的具体影响。

**【实际建议】**
基于此四化的具体可操作建议。`;

    sendMessage(prompt, true);
  }, [selectedSiHua]); // eslint-disable-line react-hooks/exhaustive-deps

  const streamResponse = async (
    apiMessages: { role: 'user' | 'assistant'; content: string }[],
    topicOverride: TopicKey | undefined,
    requestId: number,
  ) => {
    const topic = topicOverride
      ?? (['overview', 'love', 'career', 'wealth', 'health', 'personality'] as const)
        .find(t => t === activeTopic);
    const hua = selectedSiHua && (['禄', '权', '科', '忌'] as const).find(h => h === selectedSiHua.siHua) as SiHua | undefined;
    const siHuaView = selectedSiHua?.view === 'liunian' ? 'liunian' : selectedSiHua?.view === 'daxian' ? 'daxian' : undefined;

    let assistantText = '';
    let failed = false;
    const isCurrent = () => requestSeq.current === requestId;

    try {
      await streamInterpret(
        {
          chart,
          messages: apiMessages,
          context: {
            view,
            liunianYear,
            topic,
            palaceName: selectedPalace?.name,
            palaceBranch: selectedPalace?.branch,
            siHua: selectedSiHua && hua && siHuaView
              ? { starName: selectedSiHua.starName, hua, view: siHuaView }
              : undefined,
          },
        },
        {
          onDelta: text => {
            if (!isCurrent()) return;
            assistantText += text;
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: assistantText };
              messagesRef.current = updated;
              return updated;
            });
          },
          onSources: next => {
            if (!isCurrent()) return;
            sourcesRef.current = next;
            setSources(next);
          },
          onError: (code, message) => {
            if (!isCurrent()) return;
            failed = true;
            const content = code === 'not_implemented'
              ? '开源版不含 AI 解读接口（/api/interpret），需要你自己实现后才能用，详见 README「快速开始」。排盘本身不需要任何 API Key。'
              : message;
            setMessages(prev => {
              const updated = [...prev];
              if (updated[updated.length - 1]?.role === 'assistant' && !updated[updated.length - 1].content) {
                updated[updated.length - 1] = { role: 'assistant', content };
              } else {
                updated.push({ role: 'assistant', content });
              }
              messagesRef.current = updated;
              return updated;
            });
          },
        },
        abortRef.current?.signal,
      );
      if (isCurrent() && !failed && topicOverride && assistantText) {
        topicCacheRef.current[topicOverride] = {
          text: assistantText,
          sources: sourcesRef.current,
        };
      }
    } finally {
      if (isCurrent()) {
        setLoading(false);
        loadingRef.current = false;
      }
    }
  };

  const loadBatch = async (refresh: boolean) => {
    abortRef.current?.abort();
    batchAbortRef.current?.abort();
    const controller = new AbortController();
    batchAbortRef.current = controller;
    requestSeq.current += 1;

    topicCacheRef.current = {};
    setMessages([]);
    messagesRef.current = [];
    setSources([]);
    sourcesRef.current = [];
    setActiveTopic('overview');
    activeTopicRef.current = 'overview';
    setLoading(true);
    loadingRef.current = true;

    let currentSources: SourceItem[] = [];
    let gotSection = false;

    await streamSSE(
      '/api/interpret/batch',
      { chart, context: { view, liunianYear }, refresh },
      {
        onSources: next => {
          if (batchAbortRef.current !== controller) return;
          currentSources = next;
          sourcesRef.current = next;
          setSources(next);
        },
        onSection: (topic, text, sectionSources) => {
          if (batchAbortRef.current !== controller) return;
          const key = topic as TopicKey;
          if (!questionFor(key)) return;
          gotSection = true;
          const sourcesForTopic = sectionSources?.length ? sectionSources : currentSources;
          topicCacheRef.current[key] = { text, sources: sourcesForTopic };
          if (activeTopicRef.current === key) {
            sourcesRef.current = sourcesForTopic;
            setSources(sourcesForTopic);
          }
          if (activeTopicRef.current === key) {
            const restored: Message[] = [
              { role: 'user', content: questionFor(key), hidden: true },
              { role: 'assistant', content: text },
            ];
            messagesRef.current = restored;
            setMessages(restored);
          }
        },
        onError: (code, message) => {
          if (batchAbortRef.current !== controller) return;
          if (gotSection) return;
          const content = code === 'not_implemented'
            ? '开源版不含 AI 解读接口，需要先配置模型 Key。'
            : message;
          const failed: Message[] = [{ role: 'assistant', content }];
          messagesRef.current = failed;
          setMessages(failed);
        },
      },
      controller.signal,
    );

    if (batchAbortRef.current === controller) {
      if (!topicCacheRef.current[activeTopicRef.current]) {
        const fallbackKey = (Object.keys(topicCacheRef.current) as TopicKey[])[0];
        if (fallbackKey) {
          const fallback = topicCacheRef.current[fallbackKey];
          if (fallback) {
            activeTopicRef.current = fallbackKey;
            setActiveTopic(fallbackKey);
            const restored: Message[] = [
              { role: 'user', content: questionFor(fallbackKey), hidden: true },
              { role: 'assistant', content: fallback.text },
            ];
            messagesRef.current = restored;
            setMessages(restored);
            sourcesRef.current = fallback.sources;
            setSources(fallback.sources);
          }
        }
      }
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const sendMessage = (
    text: string,
    hidden = false,
    topicOverride?: TopicKey,
    resetHistory = false,
  ) => {
    if (!text.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestSeq.current;

    loadingRef.current = true;
    setLoading(true);
    setSources([]);
    sourcesRef.current = [];

    const userMsg: Message = { role: 'user', content: text, hidden };
    const base = resetHistory ? [] : messagesRef.current;
    const apiMessages = [...base, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }));

    setMessages(prev => {
      const next = resetHistory ? [] : [...prev];
      next.push(userMsg, { role: 'assistant', content: '' });
      return next;
    });
    messagesRef.current = [...base, userMsg, { role: 'assistant', content: '' }];
    setInput('');
    void streamResponse(apiMessages, topicOverride, requestId);
  };

  const handleTopicClick = (topicKey: string) => {
    const key = topicKey as TopicKey;
    const cached = topicCacheRef.current[key];
    if (cached?.text) {
      abortRef.current?.abort();
      requestSeq.current += 1;
      loadingRef.current = false;
      setLoading(false);
      setActiveTopic(key);
      const restored: Message[] = [
        { role: 'user', content: questionFor(topicKey), hidden: true },
        { role: 'assistant', content: cached.text },
      ];
      setMessages(restored);
      messagesRef.current = restored;
      setSources(cached.sources);
      sourcesRef.current = cached.sources;
      return;
    }
    setActiveTopic(key);
    activeTopicRef.current = key;
    if (loadingRef.current && batchAbortRef.current) {
      setMessages([]);
      messagesRef.current = [];
      return;
    }
    sendMessage(questionFor(topicKey), true, key, true);
  };

  const handleSend = () => {
    sendMessage(input);
  };

  return (
    <div className="flex flex-col h-full rounded-xl overflow-hidden card-glass">

      {/* ── Topic buttons ── */}
      <div className="flex-shrink-0 px-2 pt-2.5 pb-2" style={{ borderBottom: '1px solid var(--t-border)' }}>
        <div className="flex items-center gap-1.5">
          <div className="grid grid-cols-6 gap-1 flex-1">
          {TOPICS.map(t => {
            const isActive = activeTopic === t.key;
            return (
              <button
                key={t.key}
                onClick={() => handleTopicClick(t.key)}
                className="py-1.5 text-[10px] font-medium rounded-lg transition-all duration-150"
                style={{
                  background: isActive ? 'rgba(212,168,67,0.12)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(212,168,67,0.3)' : 'var(--t-border)'}`,
                  color: isActive ? 'var(--t-gold)' : 'var(--t-faint)',
                }}
              >
                {t.label}
              </button>
            );
          })}
          </div>
          <button
            type="button"
            onClick={() => loadBatch(true)}
            disabled={loading}
            title="重新解盘并刷新缓存"
            aria-label="重新解盘"
            className="flex-shrink-0 rounded-lg transition-all disabled:opacity-30"
            style={{
              width: 26,
              height: 26,
              border: '1px solid var(--t-border)',
              background: 'transparent',
              color: 'var(--t-faint)',
              fontSize: 14,
              lineHeight: 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            ↻
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">

        {/* Loading state */}
        {loading && (messages.length === 0 || messages[messages.length - 1]?.content === '') && (
          <div className="flex flex-col items-center justify-center h-full text-center py-10">
            <div className="text-3xl mb-3" style={{ color: 'var(--t-gold)', opacity: 0.25 }}>✦</div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block rounded-full"
                style={{
                  width: 14, height: 14,
                  border: '2px solid rgba(212,168,67,0.2)',
                  borderTopColor: 'var(--t-gold)',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <p className="text-[11px]" style={{ color: 'var(--t-text2)' }}>正在解读命盘…</p>
            </div>
            <p className="text-[10px] mt-2" style={{ color: 'var(--t-faint)' }}>命理分析需要一点时间，请稍候</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg, i) => {
            if (msg.role === 'user' && msg.hidden) return null;

            if (msg.role === 'user') {
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-end"
                >
                  <div
                    className="max-w-[85%] rounded-xl px-3 py-2 text-[11px]"
                    style={{
                      background: 'rgba(212,168,67,0.08)',
                      border: '1px solid rgba(212,168,67,0.18)',
                      color: 'var(--t-gold)',
                    }}
                  >
                    {msg.content}
                  </div>
                </motion.div>
              );
            }

            // Assistant message
            const isLastMsg = i === messages.length - 1;
            if (isLastMsg && !msg.content && loading) return null;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div
                  className="text-[9px] tracking-widest mb-2 flex items-center gap-1.5"
                  style={{ color: 'var(--t-faint)' }}
                >
                  <span style={{ color: 'var(--t-gold)', opacity: 0.4 }}>✦</span>
                  命理解读
                </div>
                <MarkdownContent text={msg.content} streaming={loading && isLastMsg} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* ── Sources ── */}
      {sources.length > 0 && (
        <div className="flex-shrink-0 px-3 pb-1">
          <details>
            <summary className="cursor-pointer text-[10px]" style={{ color: 'var(--t-faint)' }}>
              依据（{sources.length}）
            </summary>
            <ul className="mt-1 space-y-1 max-h-28 overflow-y-auto">
              {sources.map(source => (
                <li key={source.id} className="text-[10px] leading-relaxed">
                  {source.url ? (
                    <a href={source.url} target="_blank" rel="noreferrer" style={{ color: 'var(--t-gold)' }}>
                      {source.work} · {source.citation}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--t-text2)' }}>{source.work} · {source.citation}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {/* ── Input ── */}
      <div className="flex-shrink-0 px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--t-border)' }}>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="继续追问，如：今年适合换工作吗？"
            disabled={loading}
            className="flex-1 rounded-lg px-3 py-2 text-[11px] focus:outline-none transition-colors"
            style={{
              background: 'var(--t-card)',
              border: '1px solid var(--t-border)',
              color: 'var(--t-text)',
            }}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-3 py-2 rounded-lg text-[11px] font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(212,168,67,0.15)',
              border: '1px solid rgba(212,168,67,0.25)',
              color: 'var(--t-gold)',
            }}
          >
            {loading ? '…' : '追问'}
          </button>
        </div>
      </div>

    </div>
  );
}
