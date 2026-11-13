export interface PresenceOption {
  readonly id: string;
  readonly mode: 'chat' | 'away' | 'dnd' | 'xa' | undefined;
  readonly label: string;
  readonly dot: string;
}
