import { memo, useEffect, useRef, useState, useCallback } from 'react';

export interface TimelineTurn {
  key: string;
  label: string;
}

interface ChatTimelineProps {
  turns: TimelineTurn[];
  activeTurn: number;
  onSelect: (index: number) => void;
}

/** 悬浮时以目标杠为中心的涟漪宽度档位（dist=距悬浮杠的距离）。 */
const RIPPLE_WIDTH = [26, 20, 15, 10];

const ROW_HEIGHT = 35;
const PANEL_HEIGHT = ROW_HEIGHT * 6;
const FADE_HEIGHT = 24;
const MANUAL_SCROLL_RESET_MS = 1500;

function rippleWidth(dist: number): number {
  return RIPPLE_WIDTH[Math.min(dist, RIPPLE_WIDTH.length - 1)];
}

/**
 * 对话右侧的消息时间线导航条：一轮一杠，点击跳转，当前轮高亮。
 * 悬浮时目标杠最宽并向两侧阶梯衰减（涟漪动效），左侧弹出消息列表面板：
 * 高亮条固定在中部，内容随悬浮平滑滑动，上下边界渐变渐隐；支持手动滚轮。
 */
export const ChatTimeline = memo(function ChatTimeline({ turns, activeTurn, onSelect }: ChatTimelineProps) {
  const [visible, setVisible] = useState(false);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const manualResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const highlightIndex = hoverIndex >= 0 ? hoverIndex : activeTurn;

  // 悬浮位置变化时平滑滑动，使高亮条对齐面板中部（手动滚动未激活时）。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || hoverIndex < 0) return;
    const targetTop = Math.max(0, hoverIndex * ROW_HEIGHT - (PANEL_HEIGHT - ROW_HEIGHT) / 2);
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: targetTop, behavior: 'smooth' });
    } else {
      el.scrollTop = targetTop;
    }
  }, [hoverIndex]);

  // 手动滚轮：标记用户浏览状态，1.5s 后自动清除。
  const handleWheel = useCallback(() => {
    if (manualResetTimer.current) clearTimeout(manualResetTimer.current);
    manualResetTimer.current = setTimeout(() => {
      manualResetTimer.current = null;
    }, MANUAL_SCROLL_RESET_MS);
  }, []);

  const handleBarEnter = useCallback((i: number) => {
    // 切到新横杠：清除手动浏览标记，恢复悬浮跟随。
    if (manualResetTimer.current) {
      clearTimeout(manualResetTimer.current);
      manualResetTimer.current = null;
    }
    setHoverIndex(i);
  }, []);

  const handleLeave = useCallback(() => {
    setVisible(false);
    setHoverIndex(-1);
    if (manualResetTimer.current) {
      clearTimeout(manualResetTimer.current);
      manualResetTimer.current = null;
    }
  }, []);

  if (turns.length === 0) return null;

  return (
    <div
      className="chat-timeline"
      style={{
        position: 'absolute',
        right: 10,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: '8px 2px',
        zIndex: 5,
        alignItems: 'center',
      }}
      role="navigation"
      aria-label="对话时间线"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={handleLeave}
    >
      {/* 消息列表浮动面板 */}
      {visible && (
        <div
          className="chat-timeline-panel"
          style={{
            position: 'absolute',
            right: 24,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 240,
            height: PANEL_HEIGHT,
            border: '1px solid rgba(128,128,128,0.25)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            background: 'var(--timeline-panel-bg, rgba(255,255,255,0.96))',
          }}
        >
          <div
            ref={scrollRef}
            className="chat-timeline-panel-scroll"
            style={{
              height: '100%',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
            }}
            onWheel={handleWheel}
          >
            {turns.map((turn, i) => {
              const highlighted = i === highlightIndex;
              const isActive = i === activeTurn;
              return (
                <div
                  key={turn.key}
                  role="button"
                  className="chat-timeline-item"
                  data-highlight={highlighted ? 'true' : 'false'}
                  data-active={isActive ? 'true' : 'false'}
                  onClick={() => onSelect(i)}
                  onMouseEnter={() => handleBarEnter(i)}
                  style={{
                    height: ROW_HEIGHT,
                    padding: '0 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                    lineHeight: '16px',
                    color: highlighted ? 'rgba(22,119,255,1)' : 'rgba(0,0,0,0.75)',
                    background: highlighted ? 'rgba(22,119,255,0.12)' : 'transparent',
                    borderLeft: isActive ? '3px solid rgba(22,119,255,0.55)' : '3px solid transparent',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    transition: 'background 0.12s ease, color 0.12s ease',
                  }}
                  title={turn.label}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: isActive ? 'rgba(22,119,255,0.85)' : 'rgba(128,128,128,0.4)',
                    }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {turn.label || '用户提问'}
                  </span>
                </div>
              );
            })}
          </div>
          {/* 上下渐变遮罩（固定显示） */}
          <div
            className="chat-timeline-fade"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: FADE_HEIGHT,
              pointerEvents: 'none',
              background:
                'linear-gradient(to bottom, var(--timeline-panel-bg, rgba(255,255,255,0.96)), transparent)',
            }}
          />
          <div
            className="chat-timeline-fade"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: FADE_HEIGHT,
              pointerEvents: 'none',
              background:
                'linear-gradient(to top, var(--timeline-panel-bg, rgba(255,255,255,0.96)), transparent)',
            }}
          />
        </div>
      )}

      {/* 右侧横杠列 */}
      {turns.map((turn, i) => {
        const active = i === activeTurn;
        const dist = hoverIndex < 0 ? -1 : Math.abs(i - hoverIndex);
        const ripple = dist < 0 ? 10 : rippleWidth(dist);
        const width = active ? 15 : ripple;
        const isHoverTarget = i === hoverIndex;
        return (
          <div
            key={turn.key}
            role="button"
            className="chat-timeline-bar"
            data-active={active ? 'true' : 'false'}
            data-hover={isHoverTarget ? 'true' : 'false'}
            aria-label={`跳到第 ${i + 1} 轮`}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(i)}
            onMouseEnter={() => handleBarEnter(i)}
            style={{
              width,
              height: 5,
              borderRadius: 3,
              background: active
                ? 'rgba(22,119,255,0.6)'
                : isHoverTarget
                  ? 'rgba(22,119,255,0.45)'
                  : 'rgba(0,0,0,0.25)',
              cursor: 'pointer',
              transition: 'width 0.18s ease, background 0.15s ease',
            }}
          />
        );
      })}
    </div>
  );
});
