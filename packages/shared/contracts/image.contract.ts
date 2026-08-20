export type ImageTask = 'describe_product' | 'ocr' | 'general';

export interface ImageUnderstandingRequest {
  tenantId?: string;
  imageUrl?: string | null;
  imageBase64?: string | null;
  mimeType?: string | null;
  task?: ImageTask;
}

export interface ImageUnderstandingMetadata {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

export interface ImageUnderstandingResult {
  success: boolean;
  description: string | null;
  objects: string[];
  visibleText: string | null;
  category: string | null;
  confidence: number;
  provider: string;
  model: string;
  latencyMs: number;
  error: string | null;
  metadata?: ImageUnderstandingMetadata;
}

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function isPrivateOrBlockedIp(ip: string): boolean {
  let cleanIp = ip.trim().toLowerCase();

  // Strip brackets if any
  if (cleanIp.startsWith('[') && cleanIp.endsWith(']')) {
    cleanIp = cleanIp.slice(1, -1);
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1 or ::ffff:a9fe:a9fe)
  if (cleanIp.startsWith('::ffff:')) {
    const remainder = cleanIp.substring(7);
    if (remainder.includes('.')) {
      cleanIp = remainder;
    } else {
      const hexParts = remainder.split(':');
      if (hexParts.length === 2) {
        const high = parseInt(hexParts[0], 16);
        const low = parseInt(hexParts[1], 16);
        if (!isNaN(high) && !isNaN(low)) {
          const o0 = (high >> 8) & 0xff;
          const o1 = high & 0xff;
          const o2 = (low >> 8) & 0xff;
          const o3 = low & 0xff;
          cleanIp = `${o0}.${o1}.${o2}.${o3}`;
        }
      }
    }
  }

  // Check IPv4
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = cleanIp.match(ipv4Regex);
  if (match) {
    const octets = match.slice(1, 5).map(Number);
    if (octets.some(o => o < 0 || o > 255)) return true;

    const [o0, o1, o2, o3] = octets;

    // 0.0.0.0/8 (Current network)
    if (o0 === 0) return true;
    // 10.0.0.0/8 (Private)
    if (o0 === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (o0 === 127) return true;
    // 169.254.0.0/16 (Link-local / AWS & GCP IMDS)
    if (o0 === 169 && o1 === 254) return true;
    // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
    if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (o0 === 192 && o1 === 168) return true;
    // 100.64.0.0/10 (Shared Address Space / CGNAT: 100.64.0.0 - 100.127.255.255)
    if (o0 === 100 && o1 >= 64 && o1 <= 127) return true;
    // 224.0.0.0/4 (Multicast) and 240.0.0.0/4 (Reserved)
    if (o0 >= 224) return true;

    return false;
  }

  // Check IPv6
  const lowerIp = cleanIp.toLowerCase();
  if (lowerIp === '::1' || lowerIp === '::' || lowerIp === '0:0:0:0:0:0:0:1' || lowerIp === '0:0:0:0:0:0:0:0') {
    return true;
  }
  // Unique Local Address fc00::/7 (fc00... or fd00...)
  if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) {
    return true;
  }
  // Link-Local fe80::/10 (fe8, fe9, fea, feb)
  if (lowerIp.startsWith('fe8') || lowerIp.startsWith('fe9') || lowerIp.startsWith('fea') || lowerIp.startsWith('feb')) {
    return true;
  }
  // Any remaining ::ffff: IPv4-mapped
  if (lowerIp.startsWith('::ffff:')) {
    return true;
  }

  return false;
}

export function validateImageUrlSync(urlStr: string): { valid: boolean; error?: string; parsedUrl?: URL } {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }

  // 1. Protocol check
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: `Disallowed URL protocol '${parsed.protocol}'. Only http: and https: are allowed.` };
  }

  // 2. Port check
  const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
  if (parsed.protocol === 'https:' && port !== 443) {
    return { valid: false, error: `Disallowed port ${port} for HTTPS. Only port 443 is permitted.` };
  }
  if (parsed.protocol === 'http:' && port !== 80) {
    return { valid: false, error: `Disallowed port ${port} for HTTP. Only port 80 is permitted.` };
  }

  // 3. Hostname check
  const hostname = parsed.hostname.toLowerCase().trim();
  if (!hostname) {
    return { valid: false, error: 'Invalid or empty hostname.' };
  }

  const blockedHostnames = ['localhost', 'localhost.localdomain', '0.0.0.0', '127.0.0.1'];
  if (blockedHostnames.includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
    return { valid: false, error: 'Access to local or internal hostnames is prohibited.' };
  }

  // 4. Literal IP check
  let ipToCheck = hostname;
  if (ipToCheck.startsWith('[') && ipToCheck.endsWith(']')) {
    ipToCheck = ipToCheck.slice(1, -1);
  }

  if (isPrivateOrBlockedIp(ipToCheck)) {
    return { valid: false, error: 'Access to private, loopback, or cloud metadata IP addresses is prohibited.' };
  }

  return { valid: true, parsedUrl: parsed };
}

export function validateImageRequest(req: ImageUnderstandingRequest): { valid: boolean; error?: string } {
  const hasUrl = typeof req.imageUrl === 'string' && req.imageUrl.trim().length > 0;
  const hasBase64 = typeof req.imageBase64 === 'string' && req.imageBase64.trim().length > 0;

  if (!hasUrl && !hasBase64) {
    return { valid: false, error: 'Invalid request: Exactly one of imageUrl or imageBase64 must be provided (neither provided).' };
  }

  if (hasUrl && hasBase64) {
    return { valid: false, error: 'Invalid request: Exactly one of imageUrl or imageBase64 must be provided (both provided).' };
  }

  if (hasUrl) {
    const urlValidation = validateImageUrlSync(req.imageUrl!);
    if (!urlValidation.valid) {
      return { valid: false, error: `Invalid image URL: ${urlValidation.error}` };
    }
  }

  if (hasBase64) {
    // Basic base64 size check
    const base64Data = req.imageBase64!.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
    const approxBytes = (base64Data.length * 3) / 4;
    if (approxBytes > MAX_IMAGE_SIZE_BYTES) {
      return { valid: false, error: `Image exceeds maximum allowed size of 5MB (${(approxBytes / (1024 * 1024)).toFixed(2)}MB).` };
    }
  }

  return { valid: true };
}
