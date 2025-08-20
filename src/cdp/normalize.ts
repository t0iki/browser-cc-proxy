import type { CDPEvent, ConsoleEvent, RequestEvent, ResponseEvent, LoadingFinishedEvent, LoadingFailedEvent } from './types.js';

const MAX_BODY_BYTES = 64000;

function truncateString(str: string, maxBytes: number): string {
  if (!str) return str;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.length <= maxBytes) return str;
  
  const decoder = new TextDecoder();
  return decoder.decode(bytes.slice(0, maxBytes)) + '...';
}

export function normalizeConsole(
  event: any,
  targetId: string,
  sessionId?: string
): ConsoleEvent {
  const { type, args = [], stackTrace } = event;
  
  const text = args.map((arg: any) => {
    if (arg.type === 'string') return arg.value;
    if (arg.type === 'number') return String(arg.value);
    if (arg.type === 'boolean') return String(arg.value);
    if (arg.type === 'undefined') return 'undefined';
    if (arg.type === 'object' && arg.subtype === 'null') return 'null';
    if (arg.description) return arg.description;
    return JSON.stringify(arg);
  }).join(' ');

  const normalizedArgs = args.map((arg: any) => {
    const str = typeof arg === 'string' ? arg : JSON.stringify(arg);
    return truncateString(str, MAX_BODY_BYTES);
  });

  let stack = null;
  if (stackTrace && stackTrace.callFrames && stackTrace.callFrames.length > 0) {
    const frame = stackTrace.callFrames[0];
    stack = {
      url: frame.url || '',
      line: frame.lineNumber || 0,
      column: frame.columnNumber || 0
    };
  }

  return {
    seq: 0, // Will be set by RingBuffer
    ts: Date.now(),
    targetId,
    sessionId,
    kind: 'console',
    type: type || 'log',
    text: truncateString(text, MAX_BODY_BYTES),
    args: normalizedArgs,
    stack
  };
}

export function normalizeLog(
  event: any,
  targetId: string,
  sessionId?: string
): ConsoleEvent {
  const { level, text, stackTrace } = event;
  
  let stack = null;
  if (stackTrace && stackTrace.callFrames && stackTrace.callFrames.length > 0) {
    const frame = stackTrace.callFrames[0];
    stack = {
      url: frame.url || '',
      line: frame.lineNumber || 0,
      column: frame.columnNumber || 0
    };
  }

  return {
    seq: 0,
    ts: Date.now(),
    targetId,
    sessionId,
    kind: 'log',
    type: level || 'verbose',
    text: truncateString(text || '', MAX_BODY_BYTES),
    stack
  };
}

export function normalizeRequest(
  event: any,
  targetId: string,
  sessionId?: string
): RequestEvent {
  const { requestId, request, initiator } = event;
  const { url, method, headers, postData } = request;

  const postDataPreview = postData
    ? truncateString(postData, 1000)
    : null;

  return {
    seq: 0,
    ts: Date.now(),
    targetId,
    sessionId,
    kind: 'request',
    requestId,
    url,
    method,
    headers: headers || {},
    postDataPreview,
    initiator: initiator?.type || 'other'
  };
}

export function normalizeResponse(
  event: any,
  targetId: string,
  sessionId?: string
): ResponseEvent {
  const { requestId, response } = event;
  const {
    url,
    status,
    statusText,
    mimeType,
    fromDiskCache,
    fromServiceWorker,
    remoteIPAddress,
    remotePort,
    timing
  } = response;

  const remoteAddress = remoteIPAddress && remotePort
    ? `${remoteIPAddress}:${remotePort}`
    : undefined;

  return {
    seq: 0,
    ts: Date.now(),
    targetId,
    sessionId,
    kind: 'response',
    requestId,
    url,
    status,
    statusText,
    mimeType: mimeType || 'unknown',
    fromDiskCache: fromDiskCache || false,
    fromServiceWorker: fromServiceWorker || false,
    remoteAddress,
    timing: timing ? { receiveHeadersEnd: timing.receiveHeadersEnd } : undefined
  };
}

export function normalizeLoadingFinished(
  event: any,
  targetId: string,
  sessionId?: string
): LoadingFinishedEvent {
  const { requestId, encodedDataLength } = event;

  return {
    seq: 0,
    ts: Date.now(),
    targetId,
    sessionId,
    kind: 'loadingFinished',
    requestId,
    encodedDataLength: encodedDataLength || 0
  };
}

export function normalizeLoadingFailed(
  event: any,
  targetId: string,
  sessionId?: string
): LoadingFailedEvent {
  const { requestId, errorText, canceled } = event;

  return {
    seq: 0,
    ts: Date.now(),
    targetId,
    sessionId,
    kind: 'loadingFailed',
    requestId,
    errorText: errorText || 'Unknown error',
    canceled: canceled || false
  };
}