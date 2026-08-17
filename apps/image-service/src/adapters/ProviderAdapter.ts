import { ImageUnderstandingRequest, ImageUnderstandingResult } from '../../../../packages/shared/contracts/image.contract';

export interface ImageProviderAdapter {
  name: string;
  modelName: string;
  analyze(
    req: ImageUnderstandingRequest,
    imageBuffer: Buffer,
    mimeType: string
  ): Promise<ImageUnderstandingResult>;
}
