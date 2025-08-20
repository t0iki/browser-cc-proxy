import type { Client } from 'chrome-remote-interface';
import { RingBuffer } from './ringBuffer.js';
import { connectToTarget, listTargets } from '../cdp/connect.js';
import { 
  normalizeConsole, 
  normalizeLog, 
  normalizeRequest, 
  normalizeResponse,
  normalizeLoadingFinished,
  normalizeLoadingFailed
} from '../cdp/normalize.js';
import type { Config } from '../config.js';
import type { CDPEvent } from '../cdp/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface SessionFilters {
  kinds?: ('console' | 'log' | 'network')[];
  urlAllowlist?: string[];
  urlBlocklist?: string[];
  maxBodyBytes?: number;
}

export interface Session {
  targetId: string;
  client: Client;
  buffer: RingBuffer;
  filters: SessionFilters;
  lastUpdateAt: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private server?: Server;
  
  constructor(private config: Config) {}

  setServer(server: Server) {
    this.server = server;
  }

  async observe(params: {
    host: string;
    port: number;
    targetId?: string;
    urlIncludes?: string;
    bufferSize?: number;
    ttlSec?: number;
  }): Promise<Session> {
    const { host, port, targetId, urlIncludes, bufferSize, ttlSec } = params;
    
    // Resolve target
    let resolvedTargetId = targetId;
    if (!resolvedTargetId && urlIncludes) {
      const targets = await listTargets(host, port, this.config);
      const target = targets.find(t => t.url.includes(urlIncludes));
      if (!target) {
        throw new Error(`No target found with URL containing: ${urlIncludes}`);
      }
      resolvedTargetId = target.id;
    }
    
    if (!resolvedTargetId) {
      throw new Error('Target ID could not be resolved');
    }
    
    // Check if already observing
    if (this.sessions.has(resolvedTargetId)) {
      throw new Error(`Already observing target: ${resolvedTargetId}`);
    }
    
    // Connect to target
    const client = await connectToTarget(host, port, resolvedTargetId, this.config);
    const buffer = new RingBuffer(bufferSize || this.config.defaultBufferSize);
    
    // Create session
    const session: Session = {
      targetId: resolvedTargetId,
      client,
      buffer,
      filters: {},
      lastUpdateAt: Date.now()
    };
    
    // Set up event listeners
    this.setupEventListeners(session);
    
    // Store session
    this.sessions.set(resolvedTargetId, session);
    
    return session;
  }

  private setupEventListeners(session: Session) {
    const { client, buffer, targetId } = session;
    
    // Console events
    client.Runtime.consoleAPICalled((params: any) => {
      if (this.shouldFilterEvent('console', session.filters)) return;
      const event = normalizeConsole(params, targetId);
      if (this.passesUrlFilter(event, session.filters)) {
        buffer.push(event);
        this.notifyResourceUpdate(targetId);
      }
    });
    
    // Log events
    client.Log.entryAdded((params: any) => {
      if (this.shouldFilterEvent('log', session.filters)) return;
      const event = normalizeLog(params.entry, targetId);
      if (this.passesUrlFilter(event, session.filters)) {
        buffer.push(event);
        this.notifyResourceUpdate(targetId);
      }
    });
    
    // Network events
    client.Network.requestWillBeSent((params: any) => {
      if (this.shouldFilterEvent('network', session.filters)) return;
      const event = normalizeRequest(params, targetId);
      if (this.passesUrlFilter(event, session.filters)) {
        buffer.push(event);
        this.notifyResourceUpdate(targetId);
      }
    });
    
    client.Network.responseReceived((params: any) => {
      if (this.shouldFilterEvent('network', session.filters)) return;
      const event = normalizeResponse(params, targetId);
      if (this.passesUrlFilter(event, session.filters)) {
        buffer.push(event);
        this.notifyResourceUpdate(targetId);
      }
    });
    
    client.Network.loadingFinished((params: any) => {
      if (this.shouldFilterEvent('network', session.filters)) return;
      const event = normalizeLoadingFinished(params, targetId);
      buffer.push(event);
      this.notifyResourceUpdate(targetId);
    });
    
    client.Network.loadingFailed((params: any) => {
      if (this.shouldFilterEvent('network', session.filters)) return;
      const event = normalizeLoadingFailed(params, targetId);
      buffer.push(event);
      this.notifyResourceUpdate(targetId);
    });
  }

  private shouldFilterEvent(kind: string, filters: SessionFilters): boolean {
    if (!filters.kinds || filters.kinds.length === 0) return false;
    return !filters.kinds.includes(kind as any);
  }

  private passesUrlFilter(event: CDPEvent, filters: SessionFilters): boolean {
    const url = (event as any).url;
    if (!url) return true;
    
    // Check blocklist first
    if (filters.urlBlocklist) {
      for (const block of filters.urlBlocklist) {
        if (url.includes(block)) return false;
      }
    }
    
    // Check allowlist
    if (filters.urlAllowlist && filters.urlAllowlist.length > 0) {
      for (const allow of filters.urlAllowlist) {
        if (url.includes(allow)) return true;
      }
      return false;
    }
    
    return true;
  }

  private notifyResourceUpdate(targetId: string) {
    if (this.server) {
      const uri = `cdp://events/${targetId}`;
      // MCP SDK may not have this method yet
      // this.server.sendResourceUpdated(uri);
    }
  }

  async stopObserve(targetId: string, dropBuffer: boolean = false): Promise<void> {
    const session = this.sessions.get(targetId);
    if (!session) {
      throw new Error(`Not observing target: ${targetId}`);
    }
    
    // Close CDP connection
    await session.client.close();
    
    // Remove or clear session
    if (dropBuffer) {
      this.sessions.delete(targetId);
    } else {
      // Keep buffer but mark as disconnected
      session.client = null as any;
    }
  }

  getSession(targetId: string): Session | undefined {
    return this.sessions.get(targetId);
  }

  setFilters(targetId: string, filters: SessionFilters): void {
    const session = this.sessions.get(targetId);
    if (!session) {
      throw new Error(`Session not found: ${targetId}`);
    }
    session.filters = filters;
  }

  getFilters(targetId: string): SessionFilters {
    const session = this.sessions.get(targetId);
    if (!session) {
      throw new Error(`Session not found: ${targetId}`);
    }
    return session.filters;
  }

  clearEvents(targetId: string): void {
    const session = this.sessions.get(targetId);
    if (!session) {
      throw new Error(`Session not found: ${targetId}`);
    }
    session.buffer.clear();
  }

  // Garbage collection for expired sessions
  gc(): void {
    const ttlMs = this.config.defaultTtlSec * 1000;
    const now = Date.now();
    
    for (const [targetId, session] of this.sessions.entries()) {
      if (session.buffer.isExpired(ttlMs)) {
        if (session.client) {
          session.client.close().catch(() => {});
        }
        this.sessions.delete(targetId);
      }
    }
  }
}