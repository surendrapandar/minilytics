import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SelectDropdown } from '../src/dashboard/components/SelectDropdown';

describe('custom dropdowns', () => {
  it('renders the selected option as an accessible button, not a native select', () => {
    const markup = renderToStaticMarkup(createElement(SelectDropdown, {
      id: 'period-filter',
      ariaLabel: 'Period',
      value: '7d',
      options: [
        { value: '7d', label: 'Last 7 days' },
        { value: '30d', label: 'Last 30 days' },
      ],
      onChange: () => {},
      buttonClassName: 'filter-control',
    }));
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="Period"');
    expect(markup).toContain('Last 7 days');
    expect(markup).toContain('type="button"');
    expect(markup).not.toContain('<select');
  });

  it('keeps unknown values visible as a placeholder instead of selecting another item', () => {
    const markup = renderToStaticMarkup(createElement(SelectDropdown, {
      value: '',
      options: [{ value: 'USD', label: 'USD' }],
      placeholder: 'Choose currency',
      onChange: () => {},
    }));
    expect(markup).toContain('Choose currency');
    expect(markup).toContain('aria-expanded="false"');
  });

  it('never uses native select elements in the dashboard', () => {
    const root = fileURLToPath(new URL('../src/dashboard/', import.meta.url));
    function inspect(directory: string) {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (item.isDirectory()) inspect(path);
        else if (item.name.endsWith('.tsx')) {
          expect(readFileSync(path, 'utf8'), `Native <select> in ${path}`).not.toMatch(/<select(?:\s|>)/);
        }
      }
    }
    inspect(root);
  });
});
