import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { App, Avatar, Button, Dropdown, Flex, Space, Tag, Typography } from 'antd';
import {
  Bubble,
  Conversations,
  Prompts,
  Sender,
  Suggestion,
  ThoughtChain,
  Welcome,
  type BubbleItemType,
  type ThoughtChainItemType,
} from '@ant-design/x';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  UndoOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api } from '@/api';
import { useChatContext } from '@/context/ChatContext';
import { useDirection, GLOBAL_DIRECTION } from '@/context/DirectionContext';
import type { ChatMessage, ToolCall, ToolCallDelta } from '@/types';
import { TOOL_DEFINITIONS, createToolHandlers } from '@/tools';
import { GLOBAL_TOOL_DEFINITIONS, createGlobalToolHandlers } from '@/tools/globalTools';
import { Markdown } from '@/lib/markdown';

const GLOBAL_PAPER_ID = '__global__';

const QUICK_PROMPTS = ['总结本文要点', '核心贡献是什么', '关键方法的优劣', '本文的局限性'];

const GLOBAL_QUICK_PROMPTS = ['列出所有论文', '搜索 transformer 相关论文', '对比两篇论文的方法', '总结某个领域的研究现状'];

function buildGlobalSystemPrompt(quoteTexts?: string[], direction?: string): string {
  const quoteBlock =
    quoteTexts && quoteTexts.length > 0
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
  const quoteBlock =
    quoteTexts && quoteTexts.length > 0
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

interface RoundStats {
  model: string;
  duration: number;
  toolCount: number;
  toolNames: string[];
  hasToolError: boolean;
  cacheRate: number | null;
  errorMessage: string | null;
  compacted: boolean;
  tokens: number;
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

const roles = {
  user: {
    placement: 'end' as const,
    avatar: <Avatar icon={<UserOutlined />} />,
    variant: 'filled' as const,
  },
  assistant: {
    placement: 'start' as const,
    avatar: <Avatar icon={<RobotOutlined />} />,
    variant: 'borderless' as const,
  },
};

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
  const { message, modal } = App.useApp();
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
  const [roundStats, setRoundStats] = useState<RoundStats | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const undoingRef = useRef(false);
  const compactionSummaryRef = useRef('');
  const [chunkDirectory, setChunkDirectory] = useState('');

  useEffect(() => {
    if (isGlobal) {
      setChunkDirectory('');
      return;
    }
    api
      .getChunks(paperId)
      .then((chunks) => {
        const nonEmpty = chunks.filter((c) => c.char_count > 0);
        const dir = nonEmpty
          .map((c) => `[${c.chunk_index}] ${c.heading} (${c.char_count} 字符)`)
          .join('\n');
        setChunkDirectory(`段落目录（共 ${nonEmpty.length} 段）：\n${dir}`);
      })
      .catch(() => {});
  }, [paperId, isGlobal]);

  useEffect(() => {
    if (sessionId && !loaded) {
      loadHistory(paperId);
    }
    setInput('');
  }, [paperId, sessionId, loaded, loadHistory, setInput]);

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
            paperContent,
            contentMode === 'chunk',
            chunkHeading,
            quoteRef.current,
            paperTitle,
            chunkDirectory,
          );

      let sendHistory = [...fullHistory];
      let roundCompacted = false;
      let roundTokens = 0;

      const compactionThreshold = 64000;
      const fullTokens =
        estimateTokens(systemContent) +
        sendHistory.reduce(
          (sum, m) => sum + estimateTokens(m.content ?? '') + (m.tool_calls?.length ? 50 : 0),
          0,
        );

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
        } catch {
          /* proceed without compaction */
        }
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
          api
            .reportRoundLog(paperId, sessionId, { round_id: roundId, tool_results: roundToolResults })
            .catch(() => {});
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
            api
              .reportRoundLog(paperId, sessionId, { round_id: roundId, tool_results: roundToolResults })
              .catch(() => {});
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

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onQuotesClear();
    void sendMessage(text);
  };

  const handleQuickPrompt = (prompt: string) => {
    onQuotesClear();
    void sendMessage(prompt);
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

  const handleClearChat = () => {
    modal.confirm({
      title: '删除当前会话？',
      content: '会话及其消息记录将被永久删除，此操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setInput('');
        await deleteCurrentSession(paperId);
      },
    });
  };

  // ---- Build bubble items from messages ----
  const bubbleItems = useMemo(() => {
    const items: NonNullable<React.ComponentProps<typeof Bubble.List>['items']> = [];
    let toolGroupKey = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Skip assistant messages that are pure tool_calls (no content)
      if (msg.role === 'assistant' && !(msg.content || '').trim() && msg.tool_calls?.length) {
        continue;
      }

      if (msg.role === 'tool') {
        // Group consecutive tool messages into a ThoughtChain bubble
        const batch: ChatMessage[] = [msg];
        while (i + 1 < messages.length && messages[i + 1].role === 'tool') {
          batch.push(messages[++i]);
        }
        const key = `tools-${toolGroupKey++}`;
        const hasError = batch.some((t) => (t.content ?? '').includes('工具调用出错'));
        const chainItems: ThoughtChainItemType[] = batch.map((t, j) => ({
          key: `${key}-${j}`,
          title: t.name,
          description: (t.content ?? '').slice(0, 80),
          status: (t.content ?? '').includes('工具调用出错') ? ('error' as const) : ('success' as const),
          collapsible: true,
        }));
        items.push({
          key,
          role: 'assistant',
          placement: 'start',
          content: (
            <div style={{ maxWidth: 560 }}>
              <ThoughtChain items={chainItems} />
              {hasError && (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  <CloseCircleOutlined /> 部分工具调用失败，AI 已基于已有信息继续回答。
                </Typography.Text>
              )}
            </div>
          ),
        });
        continue;
      }

      if (msg.role === 'user') {
        items.push({
          key: `${i}-${msg.content}`,
          role: 'user',
          content: msg.content ?? '',
        });
        continue;
      }

      if (msg.role === 'assistant') {
        const content = msg.content ?? '';
        const isLast = i === messages.length - 1;
        const streaming = isLast && isStreaming && !content;
        items.push({
          key: `${i}-${content.slice(0, 32)}`,
          role: 'assistant',
          content: content || (streaming ? '…' : ''),
          loading: isLast && isStreaming && !content,
          contentRender: (c) =>
            typeof c === 'string' && c ? (
              <Markdown content={c} />
            ) : (
              c as React.ReactNode
            ),
        });
      }
    }
    return items;
  }, [messages, isStreaming]);

  // ---- Conversations items ----
  const conversationItems = useMemo(
    () =>
      sessions.map((s) => ({
        key: s.id,
        label: s.title || '未命名会话',
      })),
    [sessions],
  );

  const handleRename = useCallback(
    (sid: string) => {
      const s = sessions.find((x) => x.id === sid);
      if (!s) return;
      let title = s.title || '';
      modal.confirm({
        title: '重命名会话',
        content: (
          <input
            autoFocus
            defaultValue={title}
            onChange={(e) => {
              title = e.target.value;
            }}
            placeholder="输入新名称"
            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d9d9d9' }}
          />
        ),
        onOk: () => {
          const trimmed = title.trim();
          if (trimmed) renameSession(paperId, sid, trimmed);
        },
      });
    },
    [sessions, modal, paperId, renameSession],
  );

  const isEmpty = messages.length === 0;

  return (
    <Flex vertical style={{ height: '100%', minHeight: 0 }} className="chat-panel">
      {/* Toolbar */}
      <Flex align="center" justify="space-between" style={{ padding: '8px 16px', borderBottom: '1px solid rgba(5,5,5,0.06)' }}>
        <Flex align="center" gap={8} style={{ minWidth: 0, flex: 1 }}>
          <RobotOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          <Typography.Text
            ellipsis
            style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', cursor: 'pointer' }}
            onClick={() => handleRename(sessionId)}
          >
            {currentTitle || '无会话'}
          </Typography.Text>
          {sessions.length > 1 && (
            <Tag style={{ fontSize: 11, marginLeft: 4 }} color="default">
              {sessions.length} 会话
            </Tag>
          )}
        </Flex>
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => void createNewSession(paperId)}
            disabled={isStreaming}
            title="新建对话"
          />
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            onClick={handleClearChat}
            disabled={isStreaming || sessions.length <= 1}
            title="删除当前对话"
          />
        </Space>
      </Flex>

      {/* Suggestion quick prompts */}
      <Flex style={{ padding: '8px 16px', borderBottom: '1px solid rgba(5,5,5,0.06)' }} wrap gap={8}>
        <Prompts
          items={(isGlobal ? GLOBAL_QUICK_PROMPTS : QUICK_PROMPTS).map((p, idx) => ({
            key: String(idx),
            label: p,
            disabled: isStreaming || !apiKey,
          }))}
          wrap
          onItemClick={(info) => handleQuickPrompt(info.data.label as string)}
        />
      </Flex>

      {/* Main area */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {!loaded && messages.length === 0 ? (
          <Flex align="center" justify="center" style={{ height: '100%' }}>
            <Button type="text" loading />
          </Flex>
        ) : isEmpty ? (
          <Flex vertical align="center" justify="center" gap={16} style={{ height: '100%', padding: 24 }}>
            <Welcome
              variant="borderless"
              title={isGlobal ? '全局 AI 助手' : '论文阅读助手'}
              description={
                isGlobal
                  ? '跨论文提问，让 AI 帮你探索论文库'
                  : '针对当前论文提问，AI 会检索分段与图片'
              }
            />
            <Prompts
              items={(isGlobal ? GLOBAL_QUICK_PROMPTS : QUICK_PROMPTS).map((p, idx) => ({
                key: String(idx),
                label: p,
              }))}
              wrap
              onItemClick={(info) => handleQuickPrompt(info.data.label as string)}
            />
          </Flex>
        ) : (
          <Bubble.List
            items={bubbleItems}
            role={roles}
            autoScroll
            style={{ height: '100%', padding: 16, overflowY: 'auto' }}
          />
        )}

        {loadError && (
          <div style={{ padding: '0 16px 8px' }}>
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              加载历史记录失败：{loadError}{' '}
              <Button type="link" size="small" onClick={() => void loadHistory(paperId)}>
                重试
              </Button>
            </Typography.Text>
          </div>
        )}
        {persistError && (
          <div style={{ padding: '0 16px 8px' }}>
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              保存失败：{persistError}{' '}
              <Button
                type="link"
                size="small"
                onClick={() => {
                  clearError(paperId);
                  void persistSession(paperId);
                }}
              >
                重试
              </Button>
            </Typography.Text>
          </div>
        )}
      </div>

      {/* Round stats */}
      {roundStats && (
        <Flex justify="center" style={{ padding: '0 16px 8px' }}>
          <Space size={8} wrap>
            <Tag style={{ fontSize: 11 }}>
              {roundStats.model === 'v4-pro' ? 'pro' : 'flash'}
            </Tag>
            <Tag style={{ fontSize: 11 }}>{(roundStats.duration / 1000).toFixed(1)}s</Tag>
            {roundStats.toolCount > 0 && (
              <Tag style={{ fontSize: 11 }} title={roundStats.toolNames.join(', ')}>
                {roundStats.toolCount} tool{roundStats.toolCount > 1 ? 's' : ''}
              </Tag>
            )}
            {roundStats.compacted && <Tag style={{ fontSize: 11 }}>compacted</Tag>}
            {roundStats.tokens > 0 && (
              <Tag style={{ fontSize: 11 }}>~{Math.round(roundStats.tokens / 1000)}K tok</Tag>
            )}
            {roundStats.cacheRate !== null && (
              <Tag style={{ fontSize: 11 }}>
                <ThunderboltOutlined /> {roundStats.cacheRate}%
              </Tag>
            )}
            {roundStats.hasToolError && (
              <Tag color="warning" style={{ fontSize: 11 }}>
                有工具错误
              </Tag>
            )}
            {roundStats.errorMessage && (
              <Tag color="error" style={{ fontSize: 11 }} title={roundStats.errorMessage}>
                出错
              </Tag>
            )}
          </Space>
        </Flex>
      )}

      {/* Quote context bar */}
      {quoteTexts.length > 0 && (
        <Flex vertical gap={4} style={{ padding: '8px 16px 0', margin: '0 16px', borderTop: '1px solid rgba(5,5,5,0.06)' }}>
          {quoteTexts.map((q, i) => (
            <Flex key={i} align="center" gap={8} justify="space-between" style={{ background: 'rgba(0,0,0,0.03)', borderRadius: 6, padding: '4px 8px' }}>
              <Typography.Text
                ellipsis
                style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', flex: 1 }}
                title={q}
              >
                「{q.slice(0, 100)}{q.length > 100 ? '…' : ''}」
              </Typography.Text>
              <Button type="text" size="small" icon={<DeleteOutlined />} onClick={() => onQuoteRemove(i)} />
            </Flex>
          ))}
        </Flex>
      )}

      {/* Sender */}
      <div style={{ padding: 12 }}>
        <Suggestion
          items={[
            { value: '/总结', label: '/总结 — 总结本文要点' },
            { value: '/贡献', label: '/贡献 — 核心贡献' },
            { value: '/方法', label: '/方法 — 关键方法' },
          ]}
          onSelect={(val) => setInput(val)}
        >
          {({ onTrigger, onKeyDown }) => (
            <Sender
              value={input}
              onChange={setInput}
              onKeyDown={onKeyDown}
              placeholder={
                apiKey
                  ? isGlobal
                    ? '问任何关于论文库的问题…'
                    : '问任何关于这篇论文的问题…'
                  : '请先在设置中配置 API Key'
              }
              disabled={!apiKey}
              loading={isStreaming}
              onCancel={handleStop}
              onSubmit={() => {
                if (input.trim()) handleSend();
              }}
              footer={
                <Space size={4}>
                  <select
                    value={model}
                    onChange={(e) => onModelChange(e.target.value)}
                    style={{ fontSize: 12, border: '1px solid #d9d9d9', borderRadius: 6, padding: '2px 6px', background: 'transparent', color: 'rgba(0,0,0,0.65)' }}
                  >
                    <option value="v4-flash">v4-flash</option>
                    <option value="v4-pro">v4-pro</option>
                  </select>
                  {!isStreaming && messages.some((m) => m.role === 'user') && (
                    <Button type="text" size="small" icon={<UndoOutlined />} onClick={() => void handleUndo()} title="回退上一轮对话" />
                  )}
                </Space>
              }
            />
          )}
        </Suggestion>
      </div>
    </Flex>
  );
}
