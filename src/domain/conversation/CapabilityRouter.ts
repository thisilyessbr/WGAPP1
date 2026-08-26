import { BusinessConfig, DEFAULT_IMAGE_FALLBACK_MESSAGES } from '../tenant/BusinessConfig';
import { ImageCapabilityGateway } from '../../core/gateway/ImageCapabilityGateway';
import { ImageUnderstandingResult } from '../../../packages/shared/contracts/image.contract';

export type MessageType = 'TEXT' | 'IMAGE' | 'TEXT_AND_IMAGE';

export type ImageRoutingStatus =
  | 'ENABLED'
  | 'IMAGE_DISABLED'
  | 'IMAGE_SERVICE_UNAVAILABLE'
  | 'IMAGE_ANALYSIS_FAILED'
  | 'INVALID_IMAGE';

export interface IncomingMessagePayload {
  text?: string | null;
  imageBase64?: string | null;
  imageUrl?: string | null;
  mimeType?: string | null;
  precomputedImageAnalysis?: ImageUnderstandingResult | null;
}

export interface RoutedMessage {
  type: MessageType;
  allowed: boolean;
  status?: ImageRoutingStatus;
  fallbackMessage?: string;
  effectiveContent: string;
  userDisplayContent: string;
  imageAnalysis?: ImageUnderstandingResult | null;
}

export { DEFAULT_IMAGE_FALLBACK_MESSAGES };

export class CapabilityRouter {
  constructor(private imageGateway: ImageCapabilityGateway) {}

  classifyType(payload: IncomingMessagePayload): MessageType {
    const hasText = Boolean(payload.text && payload.text.trim().length > 0);
    const hasImage = Boolean(payload.imageBase64 || payload.imageUrl);

    if (hasText && hasImage) return 'TEXT_AND_IMAGE';
    if (hasImage) return 'IMAGE';
    return 'TEXT';
  }

  async route(
    tenantId: string,
    payload: IncomingMessagePayload,
    config: BusinessConfig,
    correlationId?: string
  ): Promise<RoutedMessage> {
    const type = this.classifyType(payload);
    const text = (payload.text || '').trim();

    if (type === 'TEXT') {
      return {
        type: 'TEXT',
        allowed: true,
        status: 'ENABLED',
        effectiveContent: text,
        userDisplayContent: text,
        imageAnalysis: null
      };
    }

    // CHANGE 1 & 2: Explicit opt-in capability check + Short-circuit before Image Gateway
    const isImageEnabled = config.capabilities?.imageEnabled === true;
    if (!isImageEnabled) {
      return {
        type,
        allowed: false,
        status: 'IMAGE_DISABLED',
        fallbackMessage: DEFAULT_IMAGE_FALLBACK_MESSAGES.en,
        effectiveContent: text || '[Image]',
        userDisplayContent: text ? `[Image] ${text}` : '[Image]',
        imageAnalysis: null
      };
    }

    // Call Image Capability Gateway or reuse precomputed analysis
    const analysis = payload.precomputedImageAnalysis !== undefined && payload.precomputedImageAnalysis !== null
      ? payload.precomputedImageAnalysis
      : await this.imageGateway.analyzeImage(tenantId, {
          imageBase64: payload.imageBase64,
          imageUrl: payload.imageUrl,
          mimeType: payload.mimeType,
          task: 'describe_product'
        }, correlationId);

    if (!analysis.success) {
      // CHANGE 3: Distinguish image failure states
      let failureStatus: ImageRoutingStatus = 'IMAGE_SERVICE_UNAVAILABLE';
      if (analysis.model === 'validator' || analysis.error?.includes('Invalid request') || analysis.error?.includes('exceeds maximum allowed size')) {
        failureStatus = 'INVALID_IMAGE';
      } else if (analysis.error?.includes('unreachable') || analysis.error?.includes('timed out') || analysis.model === 'unknown') {
        failureStatus = 'IMAGE_SERVICE_UNAVAILABLE';
      } else {
        failureStatus = 'IMAGE_ANALYSIS_FAILED';
      }

      return {
        type,
        allowed: false,
        status: failureStatus,
        fallbackMessage: DEFAULT_IMAGE_FALLBACK_MESSAGES.en,
        effectiveContent: text || '[Image]',
        userDisplayContent: text ? `[Image] ${text}` : '[Image]',
        imageAnalysis: analysis
      };
    }

    // Build structured image descriptor
    const imageDescriptorParts = [
      analysis.category ? `Category: ${analysis.category}` : null,
      analysis.description ? analysis.description : null,
      analysis.visibleText ? `Text: ${analysis.visibleText}` : null,
      analysis.objects && analysis.objects.length > 0 ? `Objects: ${analysis.objects.join(', ')}` : null
    ].filter(Boolean);

    const imageDescriptor = imageDescriptorParts.join(' | ') || 'Product Photo';

    let effectiveContent: string;
    let userDisplayContent: string;

    if (type === 'TEXT_AND_IMAGE') {
      // Neither text nor image is dropped: combined into a single unified query
      effectiveContent = `${text} [Image Context: ${imageDescriptor}]`;
      userDisplayContent = `[Image: ${analysis.description || 'photo'}] ${text}`;
    } else {
      effectiveContent = imageDescriptor;
      userDisplayContent = `[Image: ${analysis.description || 'photo'}]`;
    }

    return {
      type,
      allowed: true,
      status: 'ENABLED',
      effectiveContent,
      userDisplayContent,
      imageAnalysis: analysis
    };
  }
}
