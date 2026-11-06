import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ConversationViewComponent } from './conversation-view.component';

describe('ConversationViewComponent profile search target', () => {
  it('uses the complete selected-user profile as the search target', async () => {
    await TestBed.configureTestingModule({ imports: [ConversationViewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ConversationViewComponent);
    fixture.componentRef.setInput('selectedJid', 'contact@example.invalid');
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    fixture.componentRef.setInput('timeline', []);
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('historyLoading', false);
    fixture.componentRef.setInput('hasOlderMessages', false);
    fixture.componentRef.setInput('hasNewerMessages', false);
    fixture.detectChanges();

    const profile = fixture.nativeElement.querySelector('.conversation-profile') as HTMLButtonElement;
    expect(profile.disabled).toBe(false);
    profile.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-message-search')).toBeTruthy();
  });
});
