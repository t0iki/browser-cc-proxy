import type { Client } from 'chrome-remote-interface';

export interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
}

export interface CDPSession {
  client: Client;
  targetId: string;
  sessionId?: string;
}

export interface NormalizedEvent {
  seq: number;
  ts: number;
  targetId: string;
  sessionId?: string;
  kind: 'console' | 'log' | 'request' | 'response' | 'loadingFinished' | 'loadingFailed' | 'websocket' | 'other';
}

export interface ConsoleEvent extends NormalizedEvent {
  kind: 'console' | 'log';
  type: string;
  text: string;
  args?: string[];
  stack?: {
    url: string;
    line: number;
    column: number;
  } | null;
}

export interface RequestEvent extends NormalizedEvent {
  kind: 'request';
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postDataPreview?: string | null;
  initiator: string;
}

export interface ResponseEvent extends NormalizedEvent {
  kind: 'response';
  requestId: string;
  url: string;
  status: number;
  statusText: string;
  mimeType: string;
  fromDiskCache: boolean;
  fromServiceWorker: boolean;
  remoteAddress?: string;
  timing?: {
    receiveHeadersEnd: number;
  };
}

export interface LoadingFinishedEvent extends NormalizedEvent {
  kind: 'loadingFinished';
  requestId: string;
  encodedDataLength: number;
}

export interface LoadingFailedEvent extends NormalizedEvent {
  kind: 'loadingFailed';
  requestId: string;
  errorText: string;
  canceled: boolean;
}

export type CDPEvent = ConsoleEvent | RequestEvent | ResponseEvent | LoadingFinishedEvent | LoadingFailedEvent;