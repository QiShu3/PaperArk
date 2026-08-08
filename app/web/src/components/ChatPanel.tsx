import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { Send, Sparkles, Trash2, X, Cpu, Loader2, Plus, Square, Undo2 } from 'lucide-react';
import { Button } from './ui/button';
import { api } from '@/api';
import { useChatContext } from '@/context/ChatContext';
import { useDirection, GLOBAL_DIRECTION } from '@/context/DirectionContext';
import type { ChatMessage, ToolCall, ToolCallDelta } from '@/types';
import { TOOL_DEFINITIONS, createToolHandlers } from '@/tools';
import { GLOBAL_TOOL_DEFINITIONS, createGlobalToolHandlers } from '@/tools/globalTools';
import { remarkLatexDelimiters } from '@/lib/markdownPlugins';

const GLOBAL_PAPER_ID = '__global__';

const QUICK_PROMPTS = ['总结本文要点', '核心贡献是什么', '关键方法的优劣', '本文的局限性'];

const GLOBAL_QUICK_PROMPTS = ['列出所有论文', '搜索 transformer 相关论文', '对比两篇论文的方法', '总结某个领域的研究现状'];

function resolveImage(src?: string): string {
  if (!src) return '';
  if (/^https?:\/\//.test(src) || src.startsWith('/') || src.startsWith('data:')) return src;
  const clean = src.replace(/^(\.\/)?images\/?/, '').split('/').pop() ?? src;
  return `/MD/images/${clean}`;
}

function rehypeResolveImages() {
  return (tree: any) => {
    function walk(node: any) {
      if (node.type === 'element' && node.tagName === 'img' && node.properties?.src) {
        node.properties.src = resolveImage(String(node.properties.src));
      }
      if (node.children) {
        node.children.forEach(walk);
      }
    }
    walk(tree);
  };
}

function buildGlobalSystemPrompt(quoteTexts?: string[], direction?: string): string {
  const quoteBlock = quoteTexts && quoteTexts.length > 0
    ? `\n\n用户已选中以下文本作为额外上下文：\n---\n${quoteTexts.join('\n---\n')}\n---\n请结合上述选中内容回答问题。`
    : '';
  const directionBlock =
    direction && direction !== GLOBAL_DIRECTION
      ? `\n\n当前用户处于「${direction}」研究方向视图，论文库工具默认只检索该方向下的论文。`
      : '';

  return `你是一名专业的论文研究助手，同时也是一个通用的 AI 助手。

你可以：
- 进行日常对话、回答问题、协助写作编程等
- 调用工具在论文库中搜索、阅读任意论文的任意段落

工具：
- search_papers(query) — 全库关键词搜索
- list_papers() — 列出所有论文概览
- get_paper_chunk(paper_id, target) — 读取指定论文的段落
- list_paper_chunks(paper_id) — 查看论文目录
- semantic_search_library(query) — 全库语义检索（适合概念性、跨语言问题）

回答规则：
1. 无论文上下文时正常对话
2. 需要论文信息时主动调用工具
3. 引用论文内容时注明：论文标题 + 段落标题
4. 中文回答
5. 展示图片时请直接用 Markdown 语法 ![](路径)${quoteBlock}${directionBlock}`;
}

function buildSystemPrompt(
  content: string,
  isChunk: boolean,
  chunkHeading: string | undefined,
  quoteTexts: string[] | undefined,
  paperTitle?: string,
  chunkDirectory?: string,
): string {
  const quoteBlock = quoteTexts && quoteTexts.length > 0
    ? `\n\n用户已选中以下文本作为额外上下文：\n---\n${quoteTexts.join('\n---\n')}\n---\n请结合上述选中内容回答问题。`
    : '';

  const toolList = `你可以调用以下工具来获取更多信息：
- search_chunks(query) — 在论文分段中全文搜索
- semantic_search_chunks(query) — 按语义检索论文分段（适合概念性、跨语言问题，如中文问题查英文论文）
- get_chunk(target) — 获取指定分段的完整内容
- get_current_chunk() — 获取用户当前浏览的分段内容
- list_chunks() — 列出所有分段标题
- list_images() — 列出论文中所有图片（返回 Markdown 格式，可直接嵌入回复）
- search_papers(query) — 搜索其他论文
- get_paper_chunk(paper_id, target) — 获取指定论文的分段
- list_paper_chunks(paper_id) — 列出指定论文的所有分段
请在需要时主动调用工具，而不要猜测或编造内容。`;

  if (isChunk) {
    return `你是一名专业的论文阅读助手。当前处于**分块浏览模式**。

用户正在查看以下段落：

## ${chunkHeading ?? '当前段落'}
${content}

${toolList}

请严格遵守以下规则：
1. 只基于以上段落内容回答问题。如果答案无法从该段落得出，可以使用工具查找其他段落。
2. 回答中使用中文。
3. 引用论文中的具体语句来支撑你的回答。
4. 回答简洁清晰，结构分明。
5. 展示图片时请直接用 Markdown 语法 ![](路径)，不要只写纯文本路径。${quoteBlock}`;
  }

  return `你是一名专业的论文阅读助手。当前处于**全文浏览模式**。

论文信息：
标题：${paperTitle ?? '未知'}
${chunkDirectory ?? ''}

${toolList}

请严格遵守以下规则：
1. 只基于论文内容回答问题。如果问题与论文无关，可以自由回答，但需要说明。如需具体段落内容，使用 get_chunk、search_chunks 等工具主动检索，不要编造。
2. 回答中使用中文。
3. 引用论文中的具体语句来支撑你的回答。
4. 回答简洁清晰，结构分明。
5. 展示图片时请直接用 Markdown 语法 ![](路径)，不要只写纯文本路径。${quoteBlock}`;
}

function estimateTokens(text: string): number {
  return Math.round((text ?? '').length / 3);
}

function serializeMessages(msgs: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of msgs) {
    if (m.role === 'user') {
      lines.push(`[用户]: ${m.content}`);
    } else if (m.role === 'assistant') {
      if (m.content) lines.push(`[助手]: ${m.content}`);
      if (m.tool_calls?.length) {
        const calls = m.tool_calls
          .map((tc) => `${tc.function.name}(${tc.function.arguments})`)
          .join('; ');
        lines.push(`[工具调用]: ${calls}`);
      }
    } else if (m.role === 'tool') {
      const text = m.content ?? '';
      const truncated =
        text.length > 2000
          ? text.slice(0, 2000) + `\n... (剩余 ${text.length - 2000} 字符已截断)`
          : text;
      lines.push(`[工具结果 (${m.name})]: ${truncated}`);
    }
  }
  return lines.join('\n\n');
}

function groupTurns(messages: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user' && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(m);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

function findCutIndex(messages: ChatMessage[], keepTokens: number): number {
  const turns = groupTurns(messages);
  let tokens = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turnTokens = turns[i].reduce(
      (sum, m) => sum + estimateTokens(m.content ?? '') + (m.tool_calls?.length ? 50 : 0),
      0,
    );
    tokens += turnTokens;
    if (tokens >= keepTokens) {
      let idx = 0;
      for (let j = 0; j < i + 1; j++) idx += turns[j].length;
      return Math.min(idx, messages.length);
    }
  }
  return 0;
}

async function compactConversation(
  oldMessages: ChatMessage[],
  previousSummary: string,
  apiKey: string,
): Promise<string> {
  const text = serializeMessages(oldMessages);
  const systemContent = `你是一个对话历史摘要助手。请将以下论文阅读对话的历史提炼为结构化摘要。

输出格式：
## 用户关注主题
[概括用户在询问什么]

## 助手检索的关键内容
- [论文中涉及的相关段落和发现]

## 用户偏好与上下文
- [用户表达过的约束、偏好、反馈]`;

  const userContent = `请总结以下对话历史：\n\n${previousSummary ? `之前的摘要：\n${previousSummary}\n\n---\n\n` : ''}${text}`;

  const msgs: ChatMessage[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];

  let summary = '';
  const gen = api.chat('v4-flash', msgs, apiKey, undefined);
  for await (const chunk of gen) {
    if (chunk.type === 'content') summary += chunk.text;
  }
  return summary;
}

function MessageList({
  messages,
  isStreaming,
  resolveImage,
  collapsedToolGroups,
  onToggleToolGroup,
}: {
  messages: ChatMessage[];
  isStreaming: boolean;
  resolveImage: (src?: string) => string;
  collapsedToolGroups: Record<number, boolean>;
  onToggleToolGroup: (gid: number) => void;
}) {
  const groups = useMemo(() => {
    const result: Array<
      | { type: 'msg'; msg: ChatMessage }
      | { type: 'tools'; tools: ChatMessage[]; groupId: number }
    > = [];
    let groupId = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'assistant' && !(msg.content || '').trim() && msg.tool_calls?.length) {
        continue;
      }

      if (msg.role === 'tool') {
        const batch: ChatMessage[] = [msg];
        while (i + 1 < messages.length && messages[i + 1].role === 'tool') {
          batch.push(messages[++i]);
        }
        result.push({ type: 'tools', tools: batch, groupId: groupId++ });
      } else {
        result.push({ type: 'msg', msg });
      }
    }

    return result;
  }, [messages]);

  return (
    <div className="space-y-4">
      {groups.map((group, i) => {
        if (group.type === 'tools') {
          const isCollapsed = collapsedToolGroups[group.groupId] !== false;
          const hasError = group.tools.some((t) => (t.content ?? '').includes('工具调用出错'));
          return (
            <div key={`tools-${group.groupId}`} className="flex justify-start">
              <div
                className={`max-w-[90%] rounded-lg px-3 py-2 text-xs ${
                  hasError
                    ? 'border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <button
                  onClick={() => onToggleToolGroup(group.groupId)}
                  className="flex w-full items-center gap-1.5 text-left"
                >
                  <span className="font-medium">
                    {group.tools.length} 次工具调用
                  </span>
                  <span className="text-[10px]">{isCollapsed ? '▶' : '▼'}</span>
                </button>
                {!isCollapsed && (
                  <div className="mt-1.5 space-y-1 border-t pt-1.5">
                    {group.tools.map((t, j) => (
                      <div key={j} className="opacity-70">
                        <span className="font-medium">{t.name}</span>
                        {t.content ? (
                          <span className="ml-1">
                            {t.content.slice(0, 120)}
                            {t.content.length > 120 ? '…' : ''}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        }

        const msg = group.msg;
        return (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_pre]:text-xs [&_table]:text-xs">
                  <ReactMarkdown
                    remarkPlugins={[remarkLatexDelimiters, remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeRaw, rehypeResolveImages, rehypeKatex]}
                    components={{
                      img: ({ src, alt }) => (
                        <img
                          src={resolveImage(src)}
                          alt={alt ?? ''}
                          loading="lazy"
                          className="max-w-full rounded-md border"
                        />
                      ),
                    }}
                  >
                    {(msg.content || '').trim()
                      ? msg.content || ''
                      : isStreaming
                        ? '\u200B'
                        : ''}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  paperId?: string;
  paperTitle?: string;
  paperContent?: string;
  apiKey: string;
  model: string;
  onModelChange: (m: string) => void;
  quoteTexts?: string[];
  onQuoteRemove?: (index: number) => void;
  onQuotesClear?: () => void;
  contentMode?: 'full' | 'chunk';
  chunkHeading?: string;
  mode?: 'paper' | 'global';
  inputValue?: string;
  onInputChange?: (value: string) => void;
}

export default function ChatPanel({
  paperId: rawPaperId,
  paperTitle = '',
  paperContent = '',
  apiKey,
  model,
  onModelChange,
  quoteTexts = [],
  onQuoteRemove = () => {},
  onQuotesClear = () => {},
  contentMode = 'full',
  chunkHeading,
  mode = 'paper',
  inputValue,
  onInputChange,
}: Props) {
  const isGlobal = mode === 'global';
  const paperId = isGlobal ? GLOBAL_PAPER_ID : (rawPaperId ?? '');
  const {
    getMessages,
    isLoaded,
    loadHistory,
    activeSessionId,
    sessionList,
    switchSession,
    createNewSession,
    deleteCurrentSession,
    renameSession,
    getLoadError,
    getPersistError,
    clearError,
    appendMessage,
    updateLastAssistant,
    updateLastAssistantToolCalls,
    persistSession,
    setCacheRate,
    clearSession,
    rollbackLastRound,
  } = useChatContext();
  const { direction } = useDirection();

  const sessionId = activeSessionId[paperId] ?? '';
  const sessions = sessionList[paperId] ?? [];
  const currentTitle = sessions.find((s) => s.id === sessionId)?.title ?? '';
  const messages = getMessages(paperId);
  const loaded = isLoaded(paperId);
  const loadError = getLoadError(paperId);
  const persistError = getPersistError(paperId);

  const quoteRef = useRef(quoteTexts);
  quoteRef.current = quoteTexts;

  const [internalInput, setInternalInput] = useState('');
  const input = inputValue !== undefined ? inputValue : internalInput;
  const setInput = onInputChange ?? setInternalInput;
  const [isStreaming, setIsStreaming] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const switchSelectRef = useRef<HTMLSelectElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const undoingRef = useRef(false);
  const compactionSummaryRef = useRef('');
  const [roundStats, setRoundStats] = useState<{
    model: string;
    duration: number;
    toolCount: number;
    toolNames: string[];
    hasToolError: boolean;
    cacheRate: number | null;
    errorMessage: string | null;
    compacted: boolean;
    tokens: number;
  } | null>(null);
  const [collapsedToolGroups, setCollapsedToolGroups] = useState<Record<number, boolean>>({});
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [chunkDirectory, setChunkDirectory] = useState('');

  useEffect(() => {
    if (isGlobal) {
      setChunkDirectory('');
      return;
    }
    api.getChunks(paperId).then((chunks) => {
      const nonEmpty = chunks.filter((c) => c.char_count > 0);
      const dir = nonEmpty
        .map((c) => `[${c.chunk_index}] ${c.heading} (${c.char_count} 字符)`)
        .join('\n');
      setChunkDirectory(`段落目录（共 ${nonEmpty.length} 段）：\n${dir}`);
    }).catch(() => {});
  }, [paperId, isGlobal]);

  useEffect(() => {
    if (sessionId && !loaded) {
      loadHistory(paperId);
    }
    setInput('');
  }, [paperId, sessionId, loaded, loadHistory]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrolled = el.scrollHeight - el.scrollTop - el.clientHeight > 50;
    userScrolledUpRef.current = scrolled;
    setIsScrolledUp(scrolled);
  }, []);

  const scrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    userScrolledUpRef.current = false;
    setIsScrolledUp(false);
  };

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: isStreaming ? 'instant' : 'smooth' });
  }, [messages, isStreaming]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming || !apiKey || !sessionId) return;

      const userMsg: ChatMessage = { role: 'user', content: text };
      const prev = getMessages(paperId);
      const fullHistory: ChatMessage[] = [...prev, userMsg];
      appendMessage(paperId, userMsg);
      appendMessage(paperId, { role: 'assistant', content: '' });
      setInput('');
      setIsStreaming(true);
      setCacheRate(paperId, null);
      setRoundStats(null);

      const controller = new AbortController();
      abortRef.current = controller;

      let systemContent = isGlobal
        ? buildGlobalSystemPrompt(quoteRef.current, direction)
        : buildSystemPrompt(
            paperContent, contentMode === 'chunk', chunkHeading, quoteRef.current,
            paperTitle, chunkDirectory,
          );

      let sendHistory = [...fullHistory];
      let roundCompacted = false;
      let roundTokens = 0;

      const compactionThreshold = 64000;
      const fullTokens = estimateTokens(systemContent) +
        sendHistory.reduce((sum, m) => sum + estimateTokens(m.content ?? '') + (m.tool_calls?.length ? 50 : 0), 0);

      if (fullTokens > compactionThreshold && sendHistory.length > 2) {
        try {
          const cutIdx = findCutIndex(sendHistory, 20000);
          if (cutIdx > 0 && cutIdx < sendHistory.length) {
            const oldMsgs = sendHistory.slice(0, cutIdx);
            updateLastAssistant(paperId, '⏳ 正在压缩对话历史…');
            const summary = await compactConversation(oldMsgs, compactionSummaryRef.current, apiKey);
            updateLastAssistant(paperId, '');
            compactionSummaryRef.current = summary;
            sendHistory = sendHistory.slice(cutIdx);
            roundCompacted = true;
          }
        } catch { /* proceed without compaction */ }
      }

      if (compactionSummaryRef.current) {
        systemContent += `\n\n## 对话历史摘要\n${compactionSummaryRef.current}`;
      }

      const systemMsg: ChatMessage = { role: 'system', content: systemContent };
      const workingMessages: ChatMessage[] = [systemMsg, ...sendHistory];

      const tools = isGlobal ? GLOBAL_TOOL_DEFINITIONS : TOOL_DEFINITIONS;
      const handlers = isGlobal
        ? createGlobalToolHandlers(() => direction)
        : createToolHandlers(
            paperId,
            () => ({
              heading: chunkHeading ?? '',
              content: paperContent,
            }),
            () => direction,
          );

      const roundId = crypto.randomUUID();
      const roundStart = Date.now();
      const roundToolNames: string[] = [];
      const roundToolResults: { name: string; success: boolean; error?: string }[] = [];
      let roundHasToolError = false;
      let roundCacheRate: number | null = null;
      roundTokens = estimateTokens(
        workingMessages.map((m) => m.content ?? '').join('') +
        JSON.stringify(workingMessages.filter((m) => m.tool_calls).map((m) => m.tool_calls)),
      );

      try {
        let isFirstRound = true;
        while (true) {
          if (!isFirstRound) {
            appendMessage(paperId, { role: 'assistant', content: '' });
          }
          isFirstRound = false;
          const gen = api.chat(model, workingMessages, apiKey, controller.signal, tools, paperId, sessionId, roundId);
          let content = '';
          let hasToolCalls = false;
          const toolAcc: Record<number, ToolCall> = {};

          for await (const chunk of gen) {
            if (chunk.type === 'content') {
              content += chunk.text;
              updateLastAssistant(paperId, content);
            } else if (chunk.type === 'tool_calls') {
              hasToolCalls = true;
              updateLastAssistantToolCalls(paperId, chunk.calls);
              for (const delta of chunk.calls) {
                const slot = delta.index;
                const prev = toolAcc[slot] ?? {
                  id: '',
                  type: 'function' as const,
                  function: { name: '', arguments: '' },
                };
                toolAcc[slot] = {
                  id: delta.id ?? prev.id,
                  type: delta.type ?? prev.type,
                  function: {
                    name: delta.function?.name ?? prev.function.name,
                    arguments: prev.function.arguments + (delta.function?.arguments ?? ''),
                  },
                };
              }
            } else if (chunk.type === 'usage') {
              const total = chunk.hit + chunk.miss;
              const rate = total > 0 ? Math.round((chunk.hit / total) * 100) : null;
              roundCacheRate = rate;
              setCacheRate(paperId, rate);
            }
          }

          if (!hasToolCalls) break;

          const localToolCalls = Object.values(toolAcc).filter((c) => c.id);
          if (localToolCalls.length === 0) break;

          workingMessages.push({
            role: 'assistant' as const,
            content: content || null,
            tool_calls: localToolCalls,
          });

          for (const tc of localToolCalls) {
            let result: string;
            let toolFailed = false;
            try {
              const args = JSON.parse(tc.function.arguments);
              const handler = handlers.find(
                (h) => h.definition.function.name === tc.function.name,
              );
              result = handler
                ? await handler.execute(args)
                : `未知工具: ${tc.function.name}`;
            } catch (e) {
              result = `工具调用出错: ${e instanceof Error ? e.message : '参数解析失败'}`;
              toolFailed = true;
            }

            roundToolNames.push(tc.function.name);
            roundToolResults.push({
              name: tc.function.name,
              success: !toolFailed,
              error: toolFailed ? result : undefined,
            });
            if (toolFailed) roundHasToolError = true;

            workingMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.function.name,
              content: result,
            });

            appendMessage(paperId, {
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.function.name,
              content: result,
            });
          }
        }

        await persistSession(paperId);
        if (roundToolResults.length > 0) {
          api.reportRoundLog(paperId, sessionId, { round_id: roundId, tool_results: roundToolResults }).catch(() => {});
        }
        setRoundStats({
          model,
          duration: Date.now() - roundStart,
          toolCount: roundToolNames.length,
          toolNames: roundToolNames,
          hasToolError: roundHasToolError,
          cacheRate: roundCacheRate,
          errorMessage: null,
          compacted: roundCompacted,
          tokens: roundTokens,
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          await persistSession(paperId).catch(() => {});
        } else {
          const err = e instanceof Error ? e.message : '请求失败';
          updateLastAssistant(paperId, `错误：${err}`);
          if (roundToolResults.length > 0) {
            api.reportRoundLog(paperId, sessionId, { round_id: roundId, tool_results: roundToolResults }).catch(() => {});
          }
          setRoundStats({
            model,
            duration: Date.now() - roundStart,
            toolCount: roundToolNames.length,
            toolNames: roundToolNames,
            hasToolError: roundHasToolError,
            cacheRate: roundCacheRate,
            errorMessage: err,
            compacted: roundCompacted,
            tokens: roundTokens,
          });
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [
      paperId,
      isGlobal,
      paperContent,
      paperTitle,
      chunkDirectory,
      chunkHeading,
      contentMode,
      apiKey,
      model,
      sessionId,
      isStreaming,
      getMessages,
      appendMessage,
      updateLastAssistant,
      updateLastAssistantToolCalls,
      setCacheRate,
      persistSession,
    ],
  );

  const doubleEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;

    e.preventDefault();

    if (doubleEnterTimerRef.current) {
      clearTimeout(doubleEnterTimerRef.current);
      doubleEnterTimerRef.current = null;
      handleSend();
    } else {
      setInput(input + '\n');
      doubleEnterTimerRef.current = setTimeout(() => {
        doubleEnterTimerRef.current = null;
      }, 400);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onQuotesClear();
    sendMessage(text);
  };

  const handleQuickPrompt = (prompt: string) => {
    onQuotesClear();
    sendMessage(prompt);
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleUndo = async () => {
    if (undoingRef.current) return;
    undoingRef.current = true;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const lastUserText = lastUser?.content ?? '';
    setRoundStats(null);
    try {
      await rollbackLastRound(paperId);
      setInput(lastUserText);
    } finally {
      undoingRef.current = false;
    }
  };

  const clearChat = async () => {
    setInput('');
    await deleteCurrentSession(paperId);
  };

  const handleSessionChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSid = e.target.value;
    if (newSid === sessionId) return;
    await switchSession(paperId, newSid);
  };

  const handleNewSession = async () => {
    setInput('');
    await createNewSession(paperId);
  };

  const startRename = () => {
    setDraftTitle(currentTitle);
    setEditingTitle(true);
  };

  const confirmRename = async () => {
    setEditingTitle(false);
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== currentTitle && sessionId) {
      renameSession(paperId, sessionId, trimmed);
    }
  };

  const cancelRename = () => {
    setEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmRename();
    } else if (e.key === 'Escape') {
      cancelRename();
    }
  };

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Sparkles className="size-3 shrink-0 text-muted-foreground" />
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={confirmRename}
              onKeyDown={handleTitleKeyDown}
              className="min-w-0 flex-1 rounded border bg-background px-1 py-0 text-xs outline-none ring-1 ring-ring"
            />
          ) : (
            <span
              className="min-w-0 flex-1 cursor-pointer truncate rounded px-1 py-0 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title="点击编辑会话名称"
              onClick={startRename}
            >
              {currentTitle || '无会话'}
            </span>
          )}
          {sessions.length > 1 && (
            <span className="relative shrink-0">
              <select
                ref={switchSelectRef}
                value={sessionId}
                onChange={handleSessionChange}
                disabled={isStreaming || editingTitle}
                className="absolute inset-0 opacity-0 cursor-pointer"
                title="切换会话"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
              <span className="flex size-4 items-center justify-center rounded text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground">
                ▼
              </span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleNewSession}
            disabled={isStreaming}
            title="新建对话"
          >
            <Plus className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={clearChat}
            disabled={isStreaming || sessions.length <= 1}
            title="删除当前对话"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-1.5 border-b px-3 py-2">
        {(isGlobal ? GLOBAL_QUICK_PROMPTS : QUICK_PROMPTS).map((p) => (
          <button
            key={p}
            className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => handleQuickPrompt(p)}
            disabled={isStreaming || !apiKey}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scrollContainerRef} onScroll={handleScroll} className="h-full overflow-y-auto px-3 py-3">
        {!loaded && messages.length === 0 ? (
          <div className="flex items-center justify-center pt-10">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="pt-10 text-center text-sm text-muted-foreground">
            <Sparkles className="mx-auto mb-2 size-6 opacity-40" />
            <p>{isGlobal ? '开始提问，让 AI 帮你探索论文库' : '开始提问，让 AI 帮你阅读论文'}</p>
          </div>
        ) : null}
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          resolveImage={resolveImage}
          collapsedToolGroups={collapsedToolGroups}
          onToggleToolGroup={(gid) => setCollapsedToolGroups((prev) => ({ ...prev, [gid]: !prev[gid] }))}
        />
        {loadError && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span className="flex-1">加载历史记录失败：{loadError}</span>
            <button
              className="shrink-0 underline hover:text-destructive/80"
              onClick={() => loadHistory(paperId)}
            >
              重试
            </button>
          </div>
        )}
        {persistError && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <span className="flex-1">保存失败：{persistError}</span>
            <button
              className="shrink-0 underline hover:opacity-80"
              onClick={() => { clearError(paperId); persistSession(paperId); }}
            >
              重试
            </button>
          </div>
        )}
        {roundStats && (
          <div className={`mt-3 flex justify-center`}>
            <div
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${
                roundStats.errorMessage
                  ? 'border border-destructive/30 bg-destructive/10 text-destructive'
                  : roundStats.hasToolError
                    ? 'border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              <span className="font-mono">{roundStats.model === 'v4-pro' ? 'pro' : 'flash'}</span>
              <span>{(roundStats.duration / 1000).toFixed(1)}s</span>
              {roundStats.toolCount > 0 && (
                <span title={roundStats.toolNames.join(', ')}>
                  {roundStats.toolCount} tool{roundStats.toolCount > 1 ? 's' : ''}
                </span>
              )}
              {roundStats.compacted && (
                <span title="对话历史已压缩">compacted</span>
              )}
              {roundStats.tokens > 0 && (
                <span>~{Math.round(roundStats.tokens / 1000)}K tok</span>
              )}
              {roundStats.cacheRate !== null && (
                <>
                  <Cpu className="size-3" />
                  <span>{roundStats.cacheRate}%</span>
                </>
              )}
              {roundStats.errorMessage && (
                <span className="max-w-[200px] truncate" title={roundStats.errorMessage}>
                  {roundStats.errorMessage}
                </span>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
        </div>
        {isScrolledUp && messages.length > 0 && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-full border bg-background px-3 py-1.5 text-xs shadow-md hover:bg-accent transition-opacity"
          >
            回到底部 ↓
          </button>
        )}
      </div>

      {quoteTexts.length > 0 && (
        <div className="mx-3 rounded-t-md border border-b-0 bg-accent/50 text-xs">
          {quoteTexts.map((q, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-1.5 border-b border-border/50 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                「{q.slice(0, 100)}{q.length > 100 ? '…' : ''}」
              </span>
              <button onClick={() => onQuoteRemove(i)} className="shrink-0 hover:text-foreground">
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="shrink-0 border-t p-3">
        <div className="overflow-hidden rounded-md border bg-background">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={apiKey ? (isGlobal ? '问任何关于论文库的问题...' : '问任何关于这篇论文的问题...') : '请先在设置中配置 API Key'}
            disabled={isStreaming || !apiKey}
            rows={3}
            className="h-24 w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between border-t px-2 py-1">
            <div className="flex items-center gap-1">
              <select
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                className="rounded border bg-transparent px-1.5 py-0.5 text-xs text-muted-foreground outline-none"
              >
                <option value="v4-flash">v4-flash</option>
                <option value="v4-pro">v4-pro</option>
              </select>
              {!isStreaming && messages.some((m) => m.role === 'user') && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleUndo}
                  disabled={undoingRef.current}
                  title="回退上一轮对话"
                >
                  <Undo2 className="size-3" />
                </Button>
              )}
            </div>
            {isStreaming ? (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleStop}
                title="停止生成"
              >
                <Square className="size-3" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleSend}
                disabled={!input.trim() || !apiKey}
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
