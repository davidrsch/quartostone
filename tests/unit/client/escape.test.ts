import { describe, it, expect } from 'vitest';
import { escHtml, escAttr } from '../../../src/client/utils/escape.js';

describe('escHtml', () => {
  it('escapes & to &amp;', () => {
    expect(escHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes < to &lt;', () => {
    expect(escHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes > to &gt;', () => {
    expect(escHtml('1 > 0')).toBe('1 &gt; 0');
  });

  it('escapes " to &quot;', () => {
    expect(escHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes all special chars in one string', () => {
    expect(escHtml('<div class="a&b">x > y</div>')).toBe(
      '&lt;div class=&quot;a&amp;b&quot;&gt;x &gt; y&lt;/div&gt;'
    );
  });

  it('leaves safe strings unchanged', () => {
    expect(escHtml('Hello World')).toBe('Hello World');
  });

  it('coerces non-string input via String()', () => {
    // @ts-expect-error testing runtime coercion
    expect(escHtml(42)).toBe('42');
  });

  it('handles empty string', () => {
    expect(escHtml('')).toBe('');
  });

  it('prevents XSS via script injection pattern', () => {
    const xss = '<script>alert("xss")</script>';
    const escaped = escHtml(xss);
    expect(escaped).not.toContain('<script>');
    expect(escaped).not.toContain('</script>');
  });
});

describe('escAttr', () => {
  it('is equivalent to escHtml for double-quoted attributes', () => {
    const input = 'a < b & c > "d"';
    expect(escAttr(input)).toBe(escHtml(input));
  });

  it('escapes all special characters', () => {
    expect(escAttr('<b class="x">')).toBe('&lt;b class=&quot;x&quot;&gt;');
  });
});
