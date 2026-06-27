import { buildPushPayload } from '@block65/webcrypto-web-push';

export interface PushSub { endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } }
export interface Vapid { subject: string; publicKey: string; privateKey: string }

export async function sendPush(sub: PushSub, payload: object, vapid: Vapid): Promise<boolean> {
  try {
    const req = await buildPushPayload(
      { data: JSON.stringify(payload), options: { ttl: 600 } },
      sub,
      vapid,
    );
    const res = await fetch(sub.endpoint, req as unknown as RequestInit);
    return res.ok || res.status === 201;
  } catch {
    return false;
  }
}
