import { describe, expect, it, vi } from 'vitest';
import { insertTextIntoDeepSeekPromptInput } from '../entrypoints/content/deepseek-input';

describe('DeepSeek input insertion', () => {
  it('inserts text at the current textarea selection and dispatches input events', () => {
    document.body.innerHTML = '<textarea>hello world</textarea>';
    const textarea = document.querySelector('textarea')!;
    const inputListener = vi.fn();
    const changeListener = vi.fn();
    textarea.selectionStart = 6;
    textarea.selectionEnd = 11;
    textarea.addEventListener('input', inputListener);
    textarea.addEventListener('change', changeListener);

    const ok = insertTextIntoDeepSeekPromptInput(document, 'DeepSeek');

    expect(ok).toBe(true);
    expect(textarea.value).toBe('hello DeepSeek');
    expect(textarea.selectionStart).toBe('hello DeepSeek'.length);
    expect(inputListener).toHaveBeenCalledTimes(1);
    expect(changeListener).toHaveBeenCalledTimes(1);
  });

  it('reports false when the DeepSeek textarea is missing', () => {
    document.body.innerHTML = '<div></div>';

    expect(insertTextIntoDeepSeekPromptInput(document, 'Prompt')).toBe(false);
  });
});
