import type { GeneratedImage, ImageGenerationRequest } from "../types.js";
import type { ImageProvider, ProviderGeneration } from "./types.js";

export interface Image2ProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Minimal Image 2 adapter for an OpenAI Images-compatible endpoint. It passes
 * the user's natural-language prompt to Image 2 unchanged, so no separate
 * prompt-engineering LLM is required by the scaffold.
 */
export class Image2Provider implements ImageProvider {
  readonly name = "image2";
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly options: Image2ProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async generate(request: ImageGenerationRequest): Promise<ProviderGeneration> {
    if (!this.options.apiKey || !this.options.baseUrl) {
      throw new Error("Image 2 is not configured. Set IMAGE2_API_KEY and IMAGE2_BASE_URL, or use IMAGE_PROVIDER=fake for local contract tests.");
    }
    const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify({
        model: this.options.model ?? "gpt-image-2",
        prompt: request.prompt,
        size: request.size,
        quality: request.quality,
        n: 1
      })
    });
    const body = await response.json().catch(() => ({})) as { data?: Array<{ b64_json?: string; url?: string }>; error?: { message?: string }; message?: string };
    if (!response.ok) throw new Error(`Image 2 API request failed (${response.status}): ${body.error?.message ?? body.message ?? response.statusText}`);
    const entries = body.data ?? [];
    if (!entries.length) throw new Error("Image 2 API returned no image data");
    const images = await Promise.all(entries.map((entry) => decodeImage(entry, this.fetchImpl)));
    return { status: "succeeded", images };
  }
}

export class FakeImageProvider implements ImageProvider {
  readonly name = "fake";

  async generate(_request: ImageGenerationRequest): Promise<ProviderGeneration> {
    // A valid 1x1 transparent PNG proves upload/reply plumbing without claiming a real generation.
    return {
      status: "succeeded",
      images: [{
        mimeType: "image/png",
        filename: "fake-image.png",
        bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJPAAAAABJRU5ErkJggg==", "base64")
      }]
    };
  }
}

export function createImageProvider(environment: NodeJS.ProcessEnv = process.env): ImageProvider {
  if (environment.IMAGE_PROVIDER === "fake") return new FakeImageProvider();
  if (!environment.IMAGE_PROVIDER || environment.IMAGE_PROVIDER === "image2") {
    return new Image2Provider({ apiKey: environment.IMAGE2_API_KEY, baseUrl: environment.IMAGE2_BASE_URL, model: environment.IMAGE2_MODEL });
  }
  throw new Error(`Unknown image provider: ${environment.IMAGE_PROVIDER}`);
}

async function decodeImage(entry: { b64_json?: string; url?: string }, fetchImpl: typeof globalThis.fetch): Promise<GeneratedImage> {
  if (entry.b64_json) return { bytes: Buffer.from(entry.b64_json, "base64"), mimeType: "image/png", filename: "image2.png" };
  if (!entry.url) throw new Error("Image 2 API response item lacks b64_json and url");
  const response = await fetchImpl(entry.url);
  if (!response.ok) throw new Error(`Image 2 result download failed (${response.status})`);
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0];
  if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp" && mimeType !== "image/gif") {
    throw new Error(`Unsupported generated image content type: ${mimeType ?? "missing"}`);
  }
  return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType, filename: `image2.${mimeType.split("/")[1]}` };
}
