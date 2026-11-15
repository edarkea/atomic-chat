import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { UserProfileDialogComponent } from './user-profile-dialog.component';

describe('UserProfileDialogComponent tabs', () => {
  it('separates personal, business and home profile fields', async () => {
    await TestBed.configureTestingModule({
      imports: [UserProfileDialogComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(UserProfileDialogComponent);
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    fixture.componentRef.setInput('profile', {
      accountId: 'operator@example.invalid',
      jid: 'operator@example.invalid',
      source: 'vcard-temp',
      displayName: 'Operator',
      company: 'Atomic Chat',
      jobTitle: 'Product Engineer',
      homeAddress: 'Atomic Street 42',
      fetchedAt: '2026-11-15T00:00:00.000Z',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const tabs = fixture.nativeElement.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(4);
    expect(fixture.nativeElement.querySelector('[aria-selected="true"]')?.textContent).toContain(
      'Personal',
    );
    expect(fixture.nativeElement.querySelector('input[autocomplete="name"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('input[autocomplete="organization"]')).toBeNull();

    (tabs[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[aria-selected="true"]')?.textContent).toContain(
      'Negocio',
    );
    expect(fixture.nativeElement.querySelector('input[autocomplete="organization"]')?.value).toBe(
      'Atomic Chat',
    );
    expect(fixture.nativeElement.querySelector('input[autocomplete="name"]')).toBeNull();

    (tabs[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[aria-selected="true"]')?.textContent).toContain(
      'Hogar',
    );
    expect(fixture.nativeElement.querySelector('input[autocomplete="street-address"]')?.value).toBe(
      'Atomic Street 42',
    );

    (tabs[3] as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[aria-selected="true"]')?.textContent).toContain(
      'Avatar',
    );
    expect(fixture.nativeElement.querySelector('button')?.textContent).toBeTruthy();
  });

  it('keeps the tabbed editor close action available while saving is false', async () => {
    await TestBed.configureTestingModule({
      imports: [UserProfileDialogComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(UserProfileDialogComponent);
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('[aria-label="Cerrar Mi perfil"]') as HTMLButtonElement
    ).click();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('keeps the editor open when clicking outside the panel', async () => {
    await TestBed.configureTestingModule({
      imports: [UserProfileDialogComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(UserProfileDialogComponent);
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.user-profile-backdrop') as HTMLDivElement).click();

    expect(cancelled).not.toHaveBeenCalled();
  });
});
