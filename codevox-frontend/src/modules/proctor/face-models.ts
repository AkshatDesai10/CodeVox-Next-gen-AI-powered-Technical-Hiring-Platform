import { withBasePath } from '@/lib/with-base-path';

/** Served from frontend/public/models/face-api (copied from @vladmandic/face-api). */
const MODEL_URI = withBasePath('/models/face-api');
/** TFJS 4.22 WASM binaries — used when WebGL is unavailable (software rendering / blocked GPU). */
const WASM_URI = withBasePath('/tfjs-wasm/');

let modelsLoaded = false;
let modelsLoading: Promise<void> | null = null;

let faceApiPromise: Promise<typeof import('@vladmandic/face-api')> | null = null;

function getFaceApi() {
  if (!faceApiPromise) {
    faceApiPromise = import('@vladmandic/face-api');
  }
  return faceApiPromise;
}

async function ensureInferenceBackend(
  faceapi: Awaited<ReturnType<typeof getFaceApi>>,
): Promise<void> {
  const tf = faceapi.tf as any;
  try {
    (tf as any).setWasmPaths?.(WASM_URI);
  } catch {
    /* path setter is optional on older bundles */
  }

  const candidates = ['webgl', 'wasm', 'cpu'] as const;
  let lastError: unknown = null;
  for (const name of candidates) {
    try {
      const ok = await tf.setBackend(name);
      if (!ok) continue;
      await tf.ready();
      const probe = tf.tensor1d([1, 2, 3]);
      const sum = probe.sum();
      await sum.data();
      sum.dispose();
      probe.dispose();
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Face detection backend failed to start');
}

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  if (modelsLoading) return modelsLoading;

  modelsLoading = (async () => {
    const faceapi = await getFaceApi();
    await ensureInferenceBackend(faceapi);
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URI),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URI),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URI),
    ]);
    modelsLoaded = true;
  })();

  try {
    await modelsLoading;
  } catch (err) {
    modelsLoading = null;
    modelsLoaded = false;
    throw err;
  }
}

export type FaceCaptureResult = {
  descriptor: number[];
  faceCount: number;
  quality: number;
  score: number;
  /** First jawline points of the 68-point model; used to detect head motion for liveness. */
  landmarks?: { x: number; y: number }[];
  /** Nose tip (68-point index 30); used for head-position checks. */
  nose?: { x: number; y: number };
};

const NOSE_TIP_INDEX = 30;

export type FaceEnrollmentCheck = {
  ok: boolean;
  reason: string | null;
  result: FaceCaptureResult | null;
};

const ENROLL_MIN_SCORE = 0.55;
const ENROLL_MIN_QUALITY = 0.12;
const ENROLL_MAX_HEAD_OFFSET = 0.28;

export type FaceInput = HTMLVideoElement | HTMLCanvasElement;

function getFrameSize(input: FaceInput): { width: number; height: number } {
  if (input instanceof HTMLVideoElement) {
    return { width: input.videoWidth, height: input.videoHeight };
  }
  return { width: input.width, height: input.height };
}

export async function captureFaceDescriptor(
  input: FaceInput,
): Promise<FaceCaptureResult | null> {
  const faceapi = await getFaceApi();
  await loadFaceModels();
  const { width, height } = getFrameSize(input);
  if (!width || !height) return null;

  const detection = await faceapi
    .detectAllFaces(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (!detection.length) return null;

  const primary = detection[0];
  const descriptor = Array.from(primary.descriptor) as number[];
  const box = primary.detection.box;
  const frameArea = Math.max(1, width * height);
  const quality = Math.min(1, (box.width * box.height) / frameArea * 4);
  const positions = primary.landmarks?.positions ?? [];
  const landmarks = positions.slice(0, 5).map((p) => ({ x: p.x, y: p.y }));
  const noseTip = positions[NOSE_TIP_INDEX];

  return {
    descriptor,
    faceCount: detection.length,
    quality,
    score: Number(primary.detection.score ?? 0),
    landmarks,
    nose: noseTip ? { x: noseTip.x, y: noseTip.y } : undefined,
  };
}

/**
 * Strict check for portal enrollment: exactly one clear, centered face.
 * Pass a frozen canvas for upload-time validation so the checked frame == saved frame.
 */
export async function validateCleanFaceForEnrollment(
  input: FaceInput,
): Promise<FaceEnrollmentCheck> {
  try {
    await loadFaceModels();
  } catch {
    return {
      ok: false,
      reason: 'Face detection models failed to load. Refresh the page and try again.',
      result: null,
    };
  }

  const { width, height } = getFrameSize(input);
  if (!width || !height) {
    return { ok: false, reason: 'Camera preview is not ready yet.', result: null };
  }

  let result: FaceCaptureResult | null = null;
  try {
    result = await captureFaceDescriptor(input);
  } catch {
    return {
      ok: false,
      reason: 'Could not analyze the camera frame. Please try again.',
      result: null,
    };
  }

  if (!result || result.faceCount < 1) {
    return {
      ok: false,
      reason: 'No face detected. Look straight at the camera in good light.',
      result,
    };
  }
  if (result.faceCount > 1) {
    return {
      ok: false,
      reason: 'Multiple faces detected. Only you should be in the frame.',
      result,
    };
  }
  if (result.score < ENROLL_MIN_SCORE) {
    return {
      ok: false,
      reason: 'Face is unclear. Move closer, improve lighting, and remove glasses/mask if possible.',
      result,
    };
  }
  if (result.quality < ENROLL_MIN_QUALITY) {
    return {
      ok: false,
      reason: 'Face is too small or far away. Move closer to the camera.',
      result,
    };
  }

  const offset = estimateHeadPoseOffset(result.nose, width, height);
  if (offset != null && offset > ENROLL_MAX_HEAD_OFFSET) {
    return {
      ok: false,
      reason: 'Face the camera directly and keep your head centered.',
      result,
    };
  }

  if (!result.descriptor.length) {
    return {
      ok: false,
      reason: 'Could not read facial features. Try again with a clearer view.',
      result,
    };
  }

  return { ok: true, reason: null, result };
}

/** Snapshot the current video frame so detection and upload use the same pixels. */
export function freezeVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not capture camera frame');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality = 0.92): string {
  return canvas.toDataURL('image/jpeg', quality);
}

export function compareDescriptors(
  reference: number[],
  sample: number[],
  threshold = 0.55,
): { match: boolean; distance: number } {
  if (reference.length !== sample.length) {
    return { match: false, distance: Number.POSITIVE_INFINITY };
  }
  let sum = 0;
  for (let i = 0; i < reference.length; i += 1) {
    const d = reference[i] - sample[i];
    sum += d * d;
  }
  const distance = Math.sqrt(sum);
  return { match: distance <= threshold, distance };
}

/** Head pose proxy: nose offset from frame center (gaze off-camera heuristic). */
export function estimateHeadPoseOffset(
  nose: { x: number; y: number } | undefined,
  frameWidth: number,
  frameHeight: number,
): number | null {
  if (!nose || !frameWidth || !frameHeight) return null;
  const cx = frameWidth / 2;
  const cy = frameHeight / 2;
  const dx = (nose.x - cx) / frameWidth;
  const dy = (nose.y - cy) / frameHeight;
  return Math.sqrt(dx * dx + dy * dy);
}

export function descriptorToArray(descriptor: Float32Array | number[]): number[] {
  return Array.from(descriptor);
}
