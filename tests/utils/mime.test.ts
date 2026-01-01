import { describe, it, expect } from 'vitest';
import { getMimeType } from '../../src/utils/mime.js';

describe('getMimeType', () => {
  it('returns correct MIME type for common extensions', () => {
    expect(getMimeType('document.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(getMimeType('spreadsheet.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(getMimeType('presentation.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(getMimeType('image.png')).toBe('image/png');
    expect(getMimeType('image.jpg')).toBe('image/jpeg');
    expect(getMimeType('data.json')).toBe('application/json');
    expect(getMimeType('page.html')).toBe('text/html');
    expect(getMimeType('style.css')).toBe('text/css');
    expect(getMimeType('script.js')).toBe('application/javascript');
    expect(getMimeType('readme.txt')).toBe('text/plain');
    expect(getMimeType('document.pdf')).toBe('application/pdf');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
    expect(getMimeType('noextension')).toBe('application/octet-stream');
  });

  it('handles uppercase extensions', () => {
    expect(getMimeType('IMAGE.PNG')).toBe('image/png');
    expect(getMimeType('DOC.DOCX')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
});
