import { EventEmitter } from 'node:events';
import type { TaskEventEnvelope } from '@personal-ai-os/shared';

export interface TaskEventBroadcaster {
  publish(event: TaskEventEnvelope): void;
  subscribe(listener: (event: TaskEventEnvelope) => void): () => void;
  subscribeUser(userId: string, listener: (event: TaskEventEnvelope) => void): () => void;
}

export class InMemoryTaskEventBroadcaster implements TaskEventBroadcaster {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  publish(event: TaskEventEnvelope): void {
    this.emitter.emit('event', event);
    this.emitter.emit(`user:${event.userId}`, event);
    this.emitter.emit(`task:${event.taskId}`, event);
  }

  subscribe(listener: (event: TaskEventEnvelope) => void): () => void {
    this.emitter.on('event', listener);
    return () => {
      this.emitter.off('event', listener);
    };
  }

  subscribeUser(userId: string, listener: (event: TaskEventEnvelope) => void): () => void {
    const channel = `user:${userId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }
}
