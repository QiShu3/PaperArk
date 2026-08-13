import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatTimeline, type TimelineTurn } from '../components/ChatTimeline';

const turns: TimelineTurn[] = [
  { key: 'turn-0', label: '第一问' },
  { key: 'turn-1', label: '第二问' },
  { key: 'turn-2', label: '第三问' },
  { key: 'turn-3', label: '第四问' },
  { key: 'turn-4', label: '第五问' },
  { key: 'turn-5', label: '第六问' },
  { key: 'turn-6', label: '第七问' },
  { key: 'turn-7', label: '第八问' },
];

function renderTimeline(props?: Partial<React.ComponentProps<typeof ChatTimeline>>) {
  return render(<ChatTimeline turns={turns} activeTurn={0} onSelect={() => {}} {...props} />);
}

function timeline() {
  return document.querySelector('.chat-timeline') as HTMLElement;
}

function bars() {
  return Array.from(document.querySelectorAll('.chat-timeline-bar')) as HTMLElement[];
}

function panel() {
  return document.querySelector('.chat-timeline-panel') as HTMLElement | null;
}

function panelItems() {
  return Array.from(document.querySelectorAll('.chat-timeline-item')) as HTMLElement[];
}

function openPanel(index = 0) {
  fireEvent.mouseEnter(timeline());
  fireEvent.mouseEnter(bars()[index]);
}

describe('ChatTimeline', () => {
  it('renders one bar per turn', () => {
    renderTimeline();
    expect(bars()).toHaveLength(turns.length);
    for (const b of bars()) {
      expect(b.classList.contains('chat-timeline-bar')).toBe(true);
    }
  });

  it('shows the message list panel with turn summaries on hover', () => {
    renderTimeline();
    expect(panel()).toBeNull();
    openPanel(1);
    expect(panel()).not.toBeNull();
    expect(panelItems()).toHaveLength(turns.length);
    expect(panelItems()[1].textContent).toContain('第二问');
  });

  it('hides the panel when leaving the timeline', () => {
    renderTimeline();
    openPanel(0);
    expect(panel()).not.toBeNull();
    fireEvent.mouseLeave(timeline());
    expect(panel()).toBeNull();
  });

  it('highlights the hovered bar entry in the panel', () => {
    renderTimeline({ activeTurn: 0 });
    openPanel(3);
    const highlighted = panelItems().filter((el) => el.dataset.highlight === 'true');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].textContent).toContain('第四问');
  });

  it('marks the active turn distinctly', () => {
    renderTimeline({ activeTurn: 2 });
    openPanel(0);
    const activeItem = panelItems().find((el) => el.dataset.active === 'true');
    expect(activeItem?.textContent).toContain('第三问');
  });

  it('calls onSelect when a panel item is clicked', () => {
    const onSelect = vi.fn();
    renderTimeline({ onSelect });
    openPanel(0);
    fireEvent.click(panelItems()[5]);
    expect(onSelect).toHaveBeenCalledWith(5);
  });

  it('calls onSelect when a bar is clicked', () => {
    const onSelect = vi.fn();
    renderTimeline({ onSelect });
    fireEvent.click(bars()[2]);
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('keeps the active bar fixed width and semi-transparent blue', () => {
    renderTimeline({ activeTurn: 0 });
    expect(Number(bars()[0].style.width.replace('px', ''))).toBe(15);
    expect(bars()[0].style.background).toBe('rgba(22, 119, 255, 0.6)');
  });

  it('ripples width around the hovered bar', () => {
    renderTimeline({ activeTurn: -1 });
    expect(Number(bars()[1].style.width.replace('px', ''))).toBe(10);
    fireEvent.mouseEnter(bars()[1]);
    expect(Number(bars()[1].style.width.replace('px', ''))).toBe(26);
    expect(Number(bars()[0].style.width.replace('px', ''))).toBe(20);
    expect(Number(bars()[2].style.width.replace('px', ''))).toBe(20);
    fireEvent.mouseLeave(timeline());
    expect(Number(bars()[1].style.width.replace('px', ''))).toBe(10);
  });

  it('renders nothing when there are no turns', () => {
    const { container } = render(<ChatTimeline turns={[]} activeTurn={-1} onSelect={() => {}} />);
    expect(container.querySelector('.chat-timeline')).toBeNull();
  });
});
