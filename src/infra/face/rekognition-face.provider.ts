import { randomUUID } from 'node:crypto';

import {
  CompareFacesCommand,
  CreateFaceLivenessSessionCommand,
  DetectFacesCommand,
  GetFaceLivenessSessionResultsCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';

import { type FaceComparison, FaceProvider, FaceProviderError, type FaceSession, type FaceSessionResult, type FaceSessionStatus } from './face.provider';

/** Rekognition expires a liveness session 3 minutes after it is created. */
export const REKOGNITION_SESSION_LIFETIME_MS = 3 * 60 * 1000;

/** DetectFaces quality (0–100) below which the reference frame is "poor quality". */
export const MIN_FACE_BRIGHTNESS = 25;
export const MIN_FACE_SHARPNESS = 20;

const STATUS: Record<string, FaceSessionStatus> = {
  CREATED: 'pending',
  IN_PROGRESS: 'pending',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  EXPIRED: 'expired',
};

/** Reported to callers and logs as a class only: AWS error messages can echo request data. */
function providerError(operation: string, err: unknown): FaceProviderError {
  const name = err instanceof Error ? err.name : 'Error';
  return new FaceProviderError(`Rekognition ${operation} failed (${/^[A-Za-z]{1,64}$/.test(name) ? name : 'Error'})`);
}

/**
 * AWS Rekognition Face Liveness (FACE_PROVIDER=rekognition). Credentials
 * come from the IAM role. Nothing about the user is sent: the session is
 * created with a random idempotency token, no audit images are kept and no
 * output bucket is set, so the reference frame comes back in the response
 * only. Faces are counted and quality checked with a stateless DetectFaces
 * on that frame; nothing is indexed into a collection.
 */
export class RekognitionFaceProvider extends FaceProvider {
  override readonly name = 'rekognition-liveness';
  private readonly client: RekognitionClient;

  constructor(
    region: string,
    private readonly timeoutMs: number,
    client?: RekognitionClient,
  ) {
    super();
    this.client = client ?? new RekognitionClient({ region, maxAttempts: 2 });
  }

  override async createSession(_userId: string): Promise<FaceSession> {
    const out = await this.call('CreateFaceLivenessSession', () =>
      this.client.send(
        new CreateFaceLivenessSessionCommand({ ClientRequestToken: randomUUID(), Settings: { AuditImagesLimit: 0 } }),
        { abortSignal: AbortSignal.timeout(this.timeoutMs) },
      ),
    );
    if (!out.SessionId) throw new FaceProviderError('Rekognition CreateFaceLivenessSession returned no session');
    // The Amplify FaceLivenessDetector streams to this session id; it is the SDK's handle, nothing more.
    return { providerSessionId: out.SessionId, sdkToken: out.SessionId, expiresAt: new Date(Date.now() + REKOGNITION_SESSION_LIFETIME_MS) };
  }

  override async getSessionResult(providerSessionId: string): Promise<FaceSessionResult> {
    let out;
    try {
      out = await this.client.send(new GetFaceLivenessSessionResultsCommand({ SessionId: providerSessionId }), {
        abortSignal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Unknown or aged-out session: nothing to decide on.
      if (err instanceof Error && err.name === 'SessionNotFoundException') return { status: 'expired', livenessScore: null, faceCount: 0 };
      throw providerError('GetFaceLivenessSessionResults', err);
    }
    const status = STATUS[out.Status ?? ''] ?? 'failed';
    if (status !== 'succeeded') return { status, livenessScore: null, faceCount: 0 };
    const bytes = out.ReferenceImage?.Bytes;
    const livenessScore = typeof out.Confidence === 'number' ? out.Confidence : 0;
    if (!bytes || bytes.length === 0) return { status, livenessScore, faceCount: 0 };
    const referenceImage = Buffer.from(bytes);
    const faces = await this.call('DetectFaces', () =>
      this.client.send(new DetectFacesCommand({ Image: { Bytes: referenceImage }, Attributes: ['DEFAULT'] }), {
        abortSignal: AbortSignal.timeout(this.timeoutMs),
      }),
    );
    const details = faces.FaceDetails ?? [];
    const main = details[0]?.Quality;
    const qualityIssues = main !== undefined && ((main.Brightness ?? 100) < MIN_FACE_BRIGHTNESS || (main.Sharpness ?? 100) < MIN_FACE_SHARPNESS);
    return { status, livenessScore, referenceImage, faceCount: details.length, qualityIssues };
  }

  override async compareFaces(a: Buffer, b: Buffer): Promise<FaceComparison> {
    let out;
    try {
      out = await this.client.send(new CompareFacesCommand({ SourceImage: { Bytes: a }, TargetImage: { Bytes: b }, SimilarityThreshold: 0 }), {
        abortSignal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // No face in either image is an answer, not an outage.
      if (err instanceof Error && err.name === 'InvalidParameterException') return { similarity: 0 };
      throw providerError('CompareFaces', err);
    }
    const best = Math.max(0, ...(out.FaceMatches ?? []).map((m) => m.Similarity ?? 0));
    return { similarity: best };
  }

  private async call<T>(operation: string, send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (err) {
      throw providerError(operation, err);
    }
  }
}
