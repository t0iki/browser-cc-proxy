export interface Config {
  cdpHost: string;
  cdpPort: number;
  cdpSecurityLocalOnly: boolean;
  logLevel: string;
  defaultBufferSize: number;
  defaultTtlSec: number;
}

export function loadConfig(): Config {
  return {
    cdpHost: process.env.CDP_HOST || '127.0.0.1',
    cdpPort: parseInt(process.env.CDP_PORT || '9222', 10),
    cdpSecurityLocalOnly: process.env.CDP_SECURITY_LOCALONLY !== 'false',
    logLevel: process.env.LOG_LEVEL || 'info',
    defaultBufferSize: parseInt(process.env.DEFAULT_BUFFER_SIZE || '10000', 10),
    defaultTtlSec: parseInt(process.env.DEFAULT_TTL_SEC || '3600', 10)
  };
}

export function validateSecurityConfig(host: string, config: Config): void {
  if (config.cdpSecurityLocalOnly && host === '0.0.0.0') {
    throw new Error('Connection to 0.0.0.0 is blocked by security policy');
  }
}