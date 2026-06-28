export function insertTextIntoDeepSeekPromptInput(doc: Document, text: string): boolean {
  const textarea = doc.querySelector('textarea');
  if (!(textarea instanceof HTMLTextAreaElement)) return false;

  textarea.focus();
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
