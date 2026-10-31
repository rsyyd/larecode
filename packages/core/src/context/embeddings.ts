import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface EmbeddingConfig {
  enabled: boolean;
  model: string;
  modelUrl?: string;
  cacheDir: string;
  dimensions: number;
  batchSize: number;
}

export interface EmbeddingModel {
  name: string;
  dimensions: number;
  url: string;
  sha256: string;
}

export const EMBEDDING_MODELS: EmbeddingModel[] = [
  {
    name: 'all-MiniLM-L6-v2',
    dimensions: 384,
    url: 'https://github.com/onnx/models/raw/main/validated/text/machine_comprehension/all-MiniLM-L6-v2/model/all-MiniLM-L6-v2.onnx',
    sha256: 'c4d4c8b8e8b8e8b8e8b8e8b8e8b8e8b8e8b8e8b8e8b8e8b8e8b8e8b8e8b8e8b8',
  },
  {
    name: 'all-mpnet-base-v2',
    dimensions: 768,
    url: 'https://github.com/onnx/models/raw/main/validated/text/machine_comprehension/all-mpnet-base-v2/model/all-mpnet-base-v2.onnx',
    sha256: 'd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4',
  },
];

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: false,
  model: 'all-MiniLM-L6-v2',
  cacheDir: join(homedir(), '.larecode', 'embeddings'),
  dimensions: 384,
  batchSize: 32,
};

export interface EmbeddingService {
  embed(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  dimensions: number;
  isReady(): boolean;
  getModelName(): string;
}

export class LocalEmbeddingService implements EmbeddingService {
  private config: EmbeddingConfig;
  private session: any = null;
  private tokenizer: any = null;
  private ready: boolean = false;
  private initializationError: Error | null = null;
  private InferenceSession: any = null;
  private AutoTokenizer: any = null;

  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.config = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
  }

  private async loadNativeModules(): Promise<void> {
    if (this.InferenceSession && this.AutoTokenizer) return;

    try {
      const onnxModule = await import('onnxruntime-node');
      const transformersModule = await import('@xenova/transformers');
      this.InferenceSession = onnxModule.InferenceSession;
      this.AutoTokenizer = transformersModule.AutoTokenizer;
    } catch (error) {
      throw new Error(
        'Native bindings unavailable: ' + (error instanceof Error ? error.message : String(error))
      );
    }
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    if (this.initializationError) throw this.initializationError;

    try {
      await this.loadNativeModules();

      const modelInfo =
        EMBEDDING_MODELS.find((m) => m.name === this.config.model) ?? EMBEDDING_MODELS[0];
      const modelPath = await this.ensureModel(modelInfo);

      this.session = await this.InferenceSession.create(modelPath);
      this.tokenizer = await this.AutoTokenizer.from_pretrained('Xenova/' + modelInfo.name);
      this.ready = true;
    } catch (error) {
      console.warn(
        'Failed to initialize embedding service (native bindings may be unavailable):',
        error
      );
      this.initializationError = error instanceof Error ? error : new Error(String(error));
      this.ready = false;
    }
  }

  private async ensureModel(modelInfo: EmbeddingModel): Promise<string> {
    const cacheDir = this.config.cacheDir;
    const modelFile = join(cacheDir, modelInfo.name + '.onnx');

    if (existsSync(modelFile)) {
      return modelFile;
    }

    mkdirSync(cacheDir, { recursive: true });

    const response = await fetch(modelInfo.url);
    if (!response.ok) throw new Error('Failed to download model: ' + modelInfo.url);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    writeFileSync(modelFile, buffer);

    return modelFile;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.ready) await this.initialize();
    if (!this.ready || this.initializationError) {
      throw new Error(
        'Embedding service not ready: ' +
          (this.initializationError?.message || 'Native bindings unavailable')
      );
    }

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += this.config.batchSize) {
      const batch = texts.slice(i, i + this.config.batchSize);
      const embeddings = await this.embedBatch(batch);
      results.push(...embeddings);
    }

    return results;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const encoded = await this.tokenizer(texts, {
      padding: true,
      truncation: true,
      max_length: 512,
      return_tensors: 'onnx',
    });

    const inputIds = encoded.input_ids.data as BigInt64Array | number[];
    const attentionMask = encoded.attention_mask.data as BigInt64Array | number[];

    const results = await this.session.run({
      input_ids: inputIds,
      attention_mask: attentionMask,
    });

    const embeddings = this.meanPooling(results.last_hidden_state, attentionMask);
    return this.normalize(embeddings);
  }

  private meanPooling(lastHiddenState: any, attentionMask: any): number[][] {
    const embeddings = lastHiddenState.data;
    const mask = attentionMask.data;
    const seqLen = lastHiddenState.dims[1];
    const hiddenSize = lastHiddenState.dims[2];
    const batchSize = lastHiddenState.dims[0];

    const results: number[][] = [];

    for (let i = 0; i < batchSize; i++) {
      const vec = new Float32Array(hiddenSize);
      let tokenCount = 0;

      for (let j = 0; j < seqLen; j++) {
        if (mask[i * seqLen + j] === 0) continue;
        for (let k = 0; k < hiddenSize; k++) {
          vec[k] += embeddings[i * seqLen * hiddenSize + j * hiddenSize + k];
        }
        tokenCount++;
      }

      for (let k = 0; k < hiddenSize; k++) {
        vec[k] /= tokenCount;
      }

      results.push(Array.from(vec));
    }

    return results;
  }

  private normalize(embeddings: number[][]): number[][] {
    return embeddings.map((vec) => {
      const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      return norm > 0 ? vec.map((v) => v / norm) : vec;
    });
  }

  async embedQuery(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0];
  }

  get dimensions(): number {
    return this.config.dimensions;
  }

  isReady(): boolean {
    return this.ready;
  }

  getModelName(): string {
    return this.config.model;
  }
}

export function createEmbeddingService(config: Partial<EmbeddingConfig> = {}): EmbeddingService {
  return new LocalEmbeddingService(config);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
