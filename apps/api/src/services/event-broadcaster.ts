import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import type { TaskEventBroadcaster, TaskEventEnvelope } from '@personal-ai-os/shared';

export type { TaskEventBroadcaster };

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

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

export interface RedisBroadcasterOptions {
  redisUrl?: string | undefined;
  publisher?: Redis | undefined;
  subscriber?: Redis | undefined;
  channelPrefix?: string | undefined;
}

export class RedisTaskEventBroadcaster implements TaskEventBroadcaster {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly prefix: string;
  private readonly ownsPub: boolean;
  private readonly ownsSub: boolean;

  private readonly userListeners = new Map<string, Set<(event: TaskEventEnvelope) => void>>();
  private readonly globalListeners = new Set<(event: TaskEventEnvelope) => void>();
  private readonly subscribedChannels = new Set<string>();

  constructor(options: RedisBroadcasterOptions = {}) {
    this.prefix = options.channelPrefix ?? 'personal-ai-os:events';

    if (options.publisher) {
      this.pub = options.publisher;
      this.ownsPub = false;
    } else if (options.subscriber) {
      this.pub = options.subscriber.duplicate();
      this.ownsPub = true;
    } else if (options.redisUrl) {
      this.pub = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
      this.ownsPub = true;
    } else {
      throw new Error('RedisTaskEventBroadcaster requires redisUrl, publisher, or subscriber');
    }

    if (options.subscriber) {
      this.sub = options.subscriber;
      this.ownsSub = false;
    } else if (options.publisher) {
      this.sub = options.publisher.duplicate();
      this.ownsSub = true;
    } else if (options.redisUrl) {
      this.sub = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
      this.ownsSub = true;
    } else {
      throw new Error('RedisTaskEventBroadcaster requires redisUrl, publisher, or subscriber');
    }

    // Suppress unhandled redis connection error events
    this.pub.on('error', (err) => {
      console.error('[RedisTaskEventBroadcaster PUB error]', err?.message ?? err);
    });
    this.sub.on('error', (err) => {
      console.error('[RedisTaskEventBroadcaster SUB error]', err?.message ?? err);
    });

    this.setupMessageListener();
  }

  private setupMessageListener(): void {
    this.sub.on('message', (channel: string, rawMessage: string) => {
      let event: TaskEventEnvelope;
      try {
        event = JSON.parse(rawMessage) as TaskEventEnvelope;
      } catch (err) {
        console.error('[RedisTaskEventBroadcaster] Failed to parse message JSON:', err);
        return;
      }

      if (channel === `${this.prefix}:all`) {
        for (const listener of this.globalListeners) {
          try {
            listener(event);
          } catch (err) {
            console.error('[RedisTaskEventBroadcaster] Error in global listener:', err);
          }
        }
      }

      const userPrefix = `${this.prefix}:user:`;
      if (channel.startsWith(userPrefix)) {
        const userId = channel.slice(userPrefix.length);
        const listeners = this.userListeners.get(userId);
        if (listeners) {
          for (const listener of listeners) {
            try {
              listener(event);
            } catch (err) {
              console.error(`[RedisTaskEventBroadcaster] Error in user listener (${userId}):`, err);
            }
          }
        }
      }
    });
  }

  publish(event: TaskEventEnvelope): Promise<void> {
    const publishPromise = this.doPublish(event);
    publishPromise.catch((err) => {
      console.error('[RedisTaskEventBroadcaster] Publish failed:', err);
    });
    return publishPromise;
  }

  private async doPublish(event: TaskEventEnvelope): Promise<void> {
    const raw = JSON.stringify(event);
    const userChannel = `${this.prefix}:user:${event.userId}`;
    const allChannel = `${this.prefix}:all`;
    const taskChannel = `${this.prefix}:task:${event.taskId}`;

    await Promise.all([
      this.pub.publish(userChannel, raw),
      this.pub.publish(allChannel, raw),
      this.pub.publish(taskChannel, raw),
    ]);
  }

  subscribe(listener: (event: TaskEventEnvelope) => void): () => void {
    this.globalListeners.add(listener);
    const channel = `${this.prefix}:all`;

    if (!this.subscribedChannels.has(channel)) {
      this.subscribedChannels.add(channel);
      this.sub.subscribe(channel).catch((err) => {
        console.error(`[RedisTaskEventBroadcaster] Failed to subscribe to ${channel}:`, err);
      });
    }

    return () => {
      this.globalListeners.delete(listener);
      if (this.globalListeners.size === 0) {
        this.subscribedChannels.delete(channel);
        this.sub.unsubscribe(channel).catch((err) => {
          console.error(`[RedisTaskEventBroadcaster] Failed to unsubscribe from ${channel}:`, err);
        });
      }
    };
  }

  subscribeUser(userId: string, listener: (event: TaskEventEnvelope) => void): () => void {
    let listeners = this.userListeners.get(userId);
    if (!listeners) {
      listeners = new Set();
      this.userListeners.set(userId, listeners);
    }
    listeners.add(listener);

    const channel = `${this.prefix}:user:${userId}`;
    if (!this.subscribedChannels.has(channel)) {
      this.subscribedChannels.add(channel);
      this.sub.subscribe(channel).catch((err) => {
        console.error(`[RedisTaskEventBroadcaster] Failed to subscribe to ${channel}:`, err);
      });
    }

    return () => {
      const current = this.userListeners.get(userId);
      if (current) {
        current.delete(listener);
        if (current.size === 0) {
          this.userListeners.delete(userId);
          this.subscribedChannels.delete(channel);
          this.sub.unsubscribe(channel).catch((err) => {
            console.error(
              `[RedisTaskEventBroadcaster] Failed to unsubscribe from ${channel}:`,
              err,
            );
          });
        }
      }
    };
  }

  async close(forceAll = false): Promise<void> {
    this.userListeners.clear();
    this.globalListeners.clear();
    this.subscribedChannels.clear();

    const closers: Promise<unknown>[] = [];
    if (this.ownsSub || forceAll) {
      closers.push(this.sub.quit().catch(() => this.sub.disconnect()));
    }
    if (this.ownsPub || forceAll) {
      closers.push(this.pub.quit().catch(() => this.pub.disconnect()));
    }
    await Promise.all(closers);
  }
}
