import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import NotFound from '../pages/NotFound';

describe('NotFound', () => {
  it('shows 404 and navigation actions for unknown routes', () => {
    render(
      <MemoryRouter initialEntries={['/scivers']}>
        <Routes>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/sciverse" element={<div>Sciverse</div>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('页面不存在')).toBeInTheDocument();
    expect(screen.getByText('回到首页')).toBeInTheDocument();
  });

  it('does not match valid routes', () => {
    render(
      <MemoryRouter initialEntries={['/sciverse']}>
        <Routes>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/sciverse" element={<div>Sciverse</div>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Sciverse')).toBeInTheDocument();
    expect(screen.queryByText('404')).not.toBeInTheDocument();
  });
});
