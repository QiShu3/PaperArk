import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DirectionProvider, useDirection, GLOBAL_DIRECTION } from '../context/DirectionContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DirectionProvider>{children}</DirectionProvider>
);

describe('DirectionContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to global', () => {
    const { result } = renderHook(() => useDirection(), { wrapper });
    expect(result.current.direction).toBe(GLOBAL_DIRECTION);
  });

  it('updates the selection and persists it', () => {
    const { result } = renderHook(() => useDirection(), { wrapper });
    act(() => result.current.setDirection('基于扩散模型的对抗攻击'));
    expect(result.current.direction).toBe('基于扩散模型的对抗攻击');
    expect(localStorage.getItem('papers-direction')).toBe('基于扩散模型的对抗攻击');
  });

  it('restores a saved selection on mount', () => {
    localStorage.setItem('papers-direction', '图像分类');
    const { result } = renderHook(() => useDirection(), { wrapper });
    expect(result.current.direction).toBe('图像分类');
  });
});
