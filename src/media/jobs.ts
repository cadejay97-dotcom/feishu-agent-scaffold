import { randomUUID } from "node:crypto";
import type { ImageGenerationRequest } from "../types.js";
import type { ImageJob, ImageJobCallbacks, ImageJobSource, ImageJobStore, ImageProvider, ProviderGeneration } from "./types.js";

export class InMemoryImageJobStore implements ImageJobStore {
  private readonly jobs = new Map<string, ImageJob>();

  getByIdempotencyKey(key: string): ImageJob | undefined {
    return this.jobs.get(key);
  }

  save(job: ImageJob): void {
    this.jobs.set(job.idempotencyKey, job);
  }
}

export interface SubmitImageJob {
  idempotencyKey: string;
  request: ImageGenerationRequest;
  source: ImageJobSource;
}

/**
 * Deliberately in-process for V1. It gives message-level idempotency and an
 * asynchronous boundary without adding a database or queue before one is needed.
 */
export class ImageJobRunner {
  constructor(
    private readonly provider: ImageProvider,
    private readonly store: ImageJobStore = new InMemoryImageJobStore(),
    private readonly pollIntervalMs = 1_000,
    private readonly sleep: (milliseconds: number) => Promise<void> = delay
  ) {}

  submit(input: SubmitImageJob, callbacks: ImageJobCallbacks): ImageJob {
    const existing = this.store.getByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;

    const now = new Date().toISOString();
    const job: ImageJob = {
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      request: input.request,
      source: input.source,
      status: "queued",
      provider: this.provider.name,
      createdAt: now,
      updatedAt: now
    };
    this.store.save(job);
    void this.run(job, callbacks);
    return job;
  }

  private async run(job: ImageJob, callbacks: ImageJobCallbacks): Promise<void> {
    try {
      this.transition(job, "running");
      let result = await this.provider.generate(job.request);
      while (result.status === "pending") {
        if (!this.provider.poll) throw new Error(`Image provider ${this.provider.name} returned a pending operation without poll()`);
        await this.sleep(this.pollIntervalMs);
        result = await this.provider.poll(result.operationId);
      }
      this.assertImages(result);
      job.images = result.images;
      this.transition(job, "succeeded");
      await callbacks.onSucceeded(job);
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      this.transition(job, "failed");
      try {
        await callbacks.onFailed(job);
      } catch {
        // Preserve the original provider failure; outbound failure is logged by the channel.
      }
    }
  }

  private transition(job: ImageJob, status: ImageJob["status"]): void {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    this.store.save(job);
  }

  private assertImages(result: Extract<ProviderGeneration, { status: "succeeded" }>): void {
    if (!result.images.length) throw new Error(`Image provider ${this.provider.name} returned no images`);
    for (const image of result.images) {
      if (!image.bytes.byteLength) throw new Error("Image provider returned an empty image");
      if (image.bytes.byteLength > 10 * 1024 * 1024) throw new Error("Generated image exceeds Feishu's 10 MB message-image limit");
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
