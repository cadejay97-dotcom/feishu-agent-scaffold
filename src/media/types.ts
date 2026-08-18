import type { GeneratedImage, ImageGenerationRequest } from "../types.js";

export type ImageJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface ImageJobSource {
  chatId: string;
  messageId: string;
  senderOpenId: string;
}

export interface ImageJob {
  id: string;
  idempotencyKey: string;
  request: ImageGenerationRequest;
  source: ImageJobSource;
  status: ImageJobStatus;
  provider: string;
  images?: GeneratedImage[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type ProviderGeneration =
  | { status: "succeeded"; images: GeneratedImage[] }
  | { status: "pending"; operationId: string };

/**
 * Image 2 is represented by this small contract. A future image/video
 * provider only needs a new adapter; it must not change Bot or Agent code.
 */
export interface ImageProvider {
  readonly name: string;
  generate(request: ImageGenerationRequest): Promise<ProviderGeneration>;
  poll?(operationId: string): Promise<ProviderGeneration>;
}

export interface ImageJobStore {
  getByIdempotencyKey(key: string): ImageJob | undefined;
  save(job: ImageJob): void;
}

export interface ImageJobCallbacks {
  onSucceeded(job: ImageJob): Promise<void>;
  onFailed(job: ImageJob): Promise<void>;
}
