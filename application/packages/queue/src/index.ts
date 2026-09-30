export * from './types';
export * from './IQueuePublisher';
export * from './IQueueWorker';
export * from './IQueueEventsListener';

import { BullMQPublisher, BullMQWorker, BullMQEventsListener } from './BullMQService';

export const queuePublisher: import('./IQueuePublisher').IQueuePublisher = new BullMQPublisher();
export const queueEventsListener: import('./IQueueEventsListener').IQueueEventsListener = new BullMQEventsListener();
export const queueWorker: import('./IQueueWorker').IQueueWorker = new BullMQWorker();