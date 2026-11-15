import { describe, expect, it } from 'vitest';
import {
  applySkinTone,
  EMOJI_CATALOG,
  findEmojiEntry,
  matchesEmojiSearch,
  QUICK_REACTION_EMOJIS,
  SKIN_TONE_OPTIONS,
  type EmojiEntry,
} from './emoji-catalog';

describe('EMOJI_CATALOG', () => {
  it('preserves a unique, categorized catalog for the picker', () => {
    expect(EMOJI_CATALOG.length).toBeGreaterThanOrEqual(100);
    expect(EMOJI_CATALOG.length).toBeLessThanOrEqual(150);
    expect(new Set(EMOJI_CATALOG.map((entry) => entry.emoji)).size).toBe(EMOJI_CATALOG.length);
    expect(EMOJI_CATALOG.every((entry) => entry.name && entry.category)).toBe(true);
  });

  it('keeps every quick reaction available in the full catalog', () => {
    expect(QUICK_REACTION_EMOJIS).toEqual(['👍', '❤️', '😂', '😮', '😢', '🙏']);
    expect(
      QUICK_REACTION_EMOJIS.every((emoji) => EMOJI_CATALOG.some((entry) => entry.emoji === emoji)),
    ).toBe(true);
  });

  it('matches aliases without accents and supports multiple search terms', () => {
    const heart = EMOJI_CATALOG.find((entry) => entry.emoji === '❤️') as EmojiEntry;
    const smile = EMOJI_CATALOG.find((entry) => entry.emoji === '😀') as EmojiEntry;

    expect(matchesEmojiSearch(heart, 'corazon')).toBe(true);
    expect(matchesEmojiSearch(smile, 'cara feliz')).toBe(true);
    expect(matchesEmojiSearch(smile, 'contento inexistente')).toBe(false);
  });

  it('matches category alternatives and the emoji itself', () => {
    const pizza = EMOJI_CATALOG.find((entry) => entry.emoji === '🍕') as EmojiEntry;

    expect(matchesEmojiSearch(pizza, 'comida')).toBe(true);
    expect(matchesEmojiSearch(pizza, '🍕')).toBe(true);
    expect(matchesEmojiSearch(pizza, 'viaje')).toBe(false);
  });

  it('generates skin tones in the correct position for simple and compound emojis', () => {
    expect(applySkinTone('✋', '🏿')).toBe('✋🏿');
    expect(applySkinTone('✌️', '🏿')).toBe('✌🏿');
    expect(applySkinTone('👩‍💻', '🏻')).toBe('👩🏻‍💻');
    expect(applySkinTone('👩🏽‍💻', '🏼')).toBe('👩🏼‍💻');
    expect(applySkinTone('✋🏿', '')).toBe('✋');
  });

  it('provides one unique variant for every selectable skin tone', () => {
    const variants = SKIN_TONE_OPTIONS.filter((option) => option.modifier !== '').map((option) =>
      applySkinTone('✋', option.modifier),
    );

    expect(variants).toHaveLength(5);
    expect(new Set(variants).size).toBe(5);
    expect(variants).toEqual(['✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿']);
  });

  it('recognizes stored skin-tone variants as catalog entries', () => {
    expect(findEmojiEntry('👩🏽‍💻')?.emoji).toBe('👩‍💻');
    expect(findEmojiEntry('✋🏿')?.name).toBe('mano levantada');
    expect(findEmojiEntry('🍕')).toBeDefined();
  });
});
