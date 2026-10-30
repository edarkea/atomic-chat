import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { BroadcastDialogComponent, BroadcastDialogModel } from './broadcast-dialog.component';

describe('BroadcastDialogComponent', () => {
  const model: BroadcastDialogModel = {
    contacts: [
      { jid: 'one@example.invalid', name: 'Uno', groups: ['Equipo'], source: 'roster' },
      { jid: 'two@example.invalid', name: 'Dos', groups: ['Equipo'], source: 'roster' },
      { jid: 'three@example.invalid', name: 'Tres', groups: [], source: 'roster' },
    ],
    groups: ['Equipo'],
    selectedJids: new Set(['one@example.invalid']),
    body: '',
    mode: 'normal',
    hideOffline: false,
    busy: false,
    error: null,
    result: null,
  };

  it('emits group and individual selection while preserving hidden contacts', async () => {
    await TestBed.configureTestingModule({ imports: [BroadcastDialogComponent] }).compileComponents();
    const fixture: ComponentFixture<BroadcastDialogComponent> = TestBed.createComponent(
      BroadcastDialogComponent,
    );
    fixture.componentRef.setInput('model', model);
    const toggleGroup = vi.fn();
    const toggleContact = vi.fn();
    const hideOffline = vi.fn();
    fixture.componentInstance.toggleGroup.subscribe(toggleGroup);
    fixture.componentInstance.toggleContact.subscribe(toggleContact);
    fixture.componentInstance.hideOfflineChange.subscribe(hideOffline);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.group-chip') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelectorAll('.broadcast-contact')[1] as HTMLLabelElement).click();
    const hide = fixture.nativeElement.querySelector('.broadcast-filter input') as HTMLInputElement;
    hide.click();

    expect(toggleGroup).toHaveBeenCalledWith('Equipo');
    expect(toggleContact).toHaveBeenCalledWith('two@example.invalid');
    expect(hideOffline).toHaveBeenCalledWith(true);
  });
});
