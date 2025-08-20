import CDP from 'chrome-remote-interface';
import type { Client } from 'chrome-remote-interface';
import type { CDPTarget } from './types.js';
import { validateSecurityConfig, type Config } from '../config.js';

export async function listTargets(
  host: string,
  port: number,
  config: Config
): Promise<CDPTarget[]> {
  validateSecurityConfig(host, config);
  
  try {
    const targets = await CDP.List({ host, port });
    return targets.map((target: any) => ({
      id: target.id,
      type: target.type,
      title: target.title,
      url: target.url,
      attached: target.attached || false
    }));
  } catch (error) {
    throw new Error(`Failed to list targets: ${error}`);
  }
}

export async function connectToTarget(
  host: string,
  port: number,
  targetId: string,
  config: Config
): Promise<Client> {
  validateSecurityConfig(host, config);
  
  try {
    const client = await CDP({
      host,
      port,
      target: targetId
    });
    
    // Enable necessary domains
    await client.Runtime.enable();
    await client.Log.enable();
    await client.Network.enable({});
    
    // Enable auto-attach for workers and iframes
    await client.Target.setAutoAttach({
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: false
    });
    
    return client;
  } catch (error) {
    throw new Error(`Failed to connect to target ${targetId}: ${error}`);
  }
}

export async function getResponseBody(
  client: Client,
  requestId: string
): Promise<{ body: string; base64Encoded: boolean }> {
  try {
    const response = await client.Network.getResponseBody({ requestId });
    return {
      body: response.body,
      base64Encoded: response.base64Encoded
    };
  } catch (error) {
    throw new Error(`Failed to get response body for ${requestId}: ${error}`);
  }
}