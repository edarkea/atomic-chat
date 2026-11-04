import { insertTextAtSelection } from './message-composer.component';

describe('insertTextAtSelection', () => {
  it('inserts a complex Unicode sequence without fragmenting it', () => {
    const result = insertTextAtSelection('hola mundo', 5, 5, '👩🏽‍💻');
    expect(result.text).toBe('hola 👩🏽‍💻mundo');
    expect(result.cursor).toBe(5 + '👩🏽‍💻'.length);
  });

  it('replaces the selected range and preserves the remaining text', () => {
    const result = insertTextAtSelection('uno dos tres', 4, 7, '✅');
    expect(result.text).toBe('uno ✅ tres');
  });
});
