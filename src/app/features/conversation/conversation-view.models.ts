export type { ConversationTimelineItem } from '../../core/timeline/conversation-timeline.models';

export interface OlderMessagesRequest {
  readonly conversation: string;
  readonly accountId: string;
  readonly previousHeight: number;
  readonly anchor?: {
    readonly id: string;
    readonly offsetTop: number;
  };
}
