import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { EmojiPickerComponent } from './emoji-picker.component';

describe('EmojiPickerComponent category navigation', () => {
  it('uses compact icons with accessible category labels', async () => {
    await TestBed.configureTestingModule({
      imports: [EmojiPickerComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(EmojiPickerComponent);
    fixture.detectChanges();

    const categories = fixture.nativeElement.querySelectorAll(
      '.emoji-categories button',
    ) as NodeListOf<HTMLButtonElement>;
    expect(categories.length).toBeGreaterThan(1);
    expect(categories[0].getAttribute('aria-label')).toBe('Categoría: Todos');
    expect(categories[0].getAttribute('aria-current')).toBe('location');
    expect(categories[0].title).toBe('Todos');
    expect(categories[0].querySelector('use')?.getAttribute('href')).toBe('#ac-emoji-category-all');
    expect(categories[0].textContent?.trim()).not.toContain('Todos');
  });

  it('scrolls to the selected category bookmark', async () => {
    await TestBed.configureTestingModule({
      imports: [EmojiPickerComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(EmojiPickerComponent);
    fixture.detectChanges();

    const picker = fixture.nativeElement.querySelector('.emoji-picker') as HTMLElement;
    const scrollTo = vi.fn();
    picker.scrollTo = scrollTo;
    const faces = fixture.nativeElement.querySelector(
      'button[aria-label="Categoría: Caras"]',
    ) as HTMLButtonElement;

    faces.click();
    await Promise.resolve();

    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: 'smooth',
      }),
    );
  });

  it('supports arrow and boundary navigation across categories', async () => {
    await TestBed.configureTestingModule({
      imports: [EmojiPickerComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(EmojiPickerComponent);
    fixture.detectChanges();

    const categories = fixture.nativeElement.querySelectorAll(
      '.emoji-categories button',
    ) as NodeListOf<HTMLButtonElement>;
    const picker = fixture.nativeElement.querySelector('.emoji-picker') as HTMLElement;
    picker.scrollTo = vi.fn();
    categories[0].focus();
    categories[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(categories[1]);
    expect(categories[1].getAttribute('aria-current')).toBe('location');

    categories[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(categories[categories.length - 1]);
    expect(categories[categories.length - 1].getAttribute('aria-current')).toBe('location');
    await Promise.resolve();
  });

  it('closes from the keyboard with Escape', async () => {
    await TestBed.configureTestingModule({
      imports: [EmojiPickerComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(EmojiPickerComponent);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.detectChanges();

    const picker = fixture.nativeElement.querySelector('.emoji-picker') as HTMLElement;
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(closed).toHaveBeenCalledOnce();
  });

  it('finds emojis through aliases and accent-insensitive names', async () => {
    await TestBed.configureTestingModule({
      imports: [EmojiPickerComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(EmojiPickerComponent);
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector(
      'input[aria-label="Buscar emoji por nombre, alias o categoría"]',
    ) as HTMLInputElement;
    search.value = 'corazon';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const heart = fixture.nativeElement.querySelector(
      'button[aria-label="corazón rojo"]',
    ) as HTMLButtonElement | null;
    expect(heart).not.toBeNull();
  });

  it('applies the selected skin tone without changing incompatible emojis', async () => {
    await TestBed.configureTestingModule({
      imports: [EmojiPickerComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(EmojiPickerComponent);
    const selected: string[] = [];
    fixture.componentInstance.emojiSelected.subscribe((emoji) => selected.push(emoji));
    fixture.detectChanges();

    const tone = fixture.nativeElement.querySelector(
      'select[aria-label="Tono de piel"]',
    ) as HTMLSelectElement;
    tone.value = '🏿';
    tone.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const hand = fixture.nativeElement.querySelector(
      'button[aria-label="mano levantada"]',
    ) as HTMLButtonElement;
    hand.click();

    const pizza = fixture.nativeElement.querySelector(
      'button[aria-label="pizza"]',
    ) as HTMLButtonElement;
    pizza.click();

    const thumb = fixture.nativeElement.querySelector(
      'button[aria-label="pulgar arriba"]',
    ) as HTMLButtonElement;
    thumb.click();

    const salute = fixture.nativeElement.querySelector(
      'button[aria-label="saludo militar"]',
    ) as HTMLButtonElement;
    salute.click();

    const programmer = fixture.nativeElement.querySelector(
      'button[aria-label="persona programadora"]',
    ) as HTMLButtonElement;
    programmer.click();

    expect(selected).toEqual(['✋🏿', '🍕', '👍🏿', '🫡', '👩🏿‍💻']);
  });

  it('restores and selects a recent composed variant without changing it', async () => {
    const key = 'atomic-chat.recent-emojis.v1';
    localStorage.setItem(key, JSON.stringify(['👩🏽‍💻', '👍🏿']));

    try {
      await TestBed.configureTestingModule({
        imports: [EmojiPickerComponent],
      }).compileComponents();
      const fixture = TestBed.createComponent(EmojiPickerComponent);
      const selected: string[] = [];
      fixture.componentInstance.emojiSelected.subscribe((emoji) => selected.push(emoji));
      fixture.detectChanges();

      const recent = fixture.nativeElement.querySelector('.emoji-section--recent') as HTMLElement;
      const recentButtons = recent.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
      expect(recentButtons).toHaveLength(2);
      expect(recentButtons[0].textContent?.trim()).toBe('👩🏽‍💻');

      recentButtons[0].click();

      expect(selected).toEqual(['👩🏽‍💻']);
    } finally {
      localStorage.removeItem(key);
    }
  });
});
