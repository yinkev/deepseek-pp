export interface PowChallenge {
  algorithm: string;
  challenge: string;
  salt: string;
  difficulty: number;
  signature: string;
  expireAt: number;
  expireAfter?: number;
}

export interface PowAnswer {
  algorithm: string;
  challenge: string;
  salt: string;
  answer: number;
  signature: string;
}

const SUPPORTED_ALGORITHM = 'DeepSeekHashV1';
export const DEEPSEEK_POW_WASM_PATH = 'deepseek/sha3_wasm_bg.wasm';

interface DeepSeekPowWasmExports {
  memory: WebAssembly.Memory;
  wasm_solve(
    retPtr: number,
    challengePtr: number,
    challengeLen: number,
    prefixPtr: number,
    prefixLen: number,
    difficulty: number,
  ): void;
  __wbindgen_add_to_stack_pointer(offset: number): number;
  __wbindgen_export_0(size: number, align: number): number;
}

interface WasmStringAllocation {
  ptr: number;
  len: number;
}

let powWasmPromise: Promise<DeepSeekPowWasmExports> | null = null;
const textEncoder = new TextEncoder();

export async function solvePowChallengeLocally(
  challenge: PowChallenge,
  wasmUrl?: string,
): Promise<PowAnswer> {
  validatePowChallenge(challenge);

  const prefix = `${challenge.salt}_${challenge.expireAt}_`;
  const answer = solvePowWithWasm(
    await loadDeepSeekPowWasm(wasmUrl),
    challenge.challenge.toLowerCase(),
    prefix,
    challenge.difficulty,
  );

  return {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    salt: challenge.salt,
    answer,
    signature: challenge.signature,
  };
}

function validatePowChallenge(challenge: PowChallenge) {
  if (challenge.algorithm !== SUPPORTED_ALGORITHM) {
    throw new Error(`Unsupported DeepSeek PoW algorithm: ${challenge.algorithm}`);
  }

  if (!/^[0-9a-f]{64}$/i.test(challenge.challenge)) {
    throw new Error('Invalid DeepSeek PoW challenge digest.');
  }

  if (!Number.isSafeInteger(challenge.difficulty) || challenge.difficulty <= 0) {
    throw new Error(`Invalid DeepSeek PoW difficulty: ${challenge.difficulty}`);
  }

  if (!Number.isFinite(challenge.expireAt) || challenge.expireAt <= 0) {
    throw new Error(`Invalid DeepSeek PoW expireAt: ${challenge.expireAt}`);
  }
}

function solvePowWithWasm(
  wasm: DeepSeekPowWasmExports,
  target: string,
  prefix: string,
  difficulty: number,
): number {
  const retPtr = wasm.__wbindgen_add_to_stack_pointer(-16);
  const challengeAllocation = writeWasmString(wasm, target);
  const prefixAllocation = writeWasmString(wasm, prefix);
  // wasm_solve is generated from owned Rust String parameters; the callee releases these inputs.

  try {
    wasm.wasm_solve(
      retPtr,
      challengeAllocation.ptr,
      challengeAllocation.len,
      prefixAllocation.ptr,
      prefixAllocation.len,
      difficulty,
    );

    const view = new DataView(wasm.memory.buffer);
    const status = view.getInt32(retPtr, true);
    const answer = view.getFloat64(retPtr + 8, true);
    if (status !== 1 || !Number.isSafeInteger(answer) || answer < 0) {
      throw new Error(`No DeepSeek PoW solution found before difficulty ${difficulty}.`);
    }

    return answer;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

async function loadDeepSeekPowWasm(wasmUrl?: string): Promise<DeepSeekPowWasmExports> {
  powWasmPromise ??= (async () => {
    const response = await fetch(getDeepSeekPowWasmUrl(wasmUrl));
    if (!response.ok) {
      throw new Error(`Failed to load DeepSeek PoW WASM: ${response.status} ${response.statusText}`);
    }

    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    return instance.exports as unknown as DeepSeekPowWasmExports;
  })();

  return powWasmPromise;
}

function getDeepSeekPowWasmUrl(wasmUrl?: string): string {
  if (wasmUrl) return wasmUrl;

  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(DEEPSEEK_POW_WASM_PATH);
  }

  throw new Error('Chrome runtime URL resolver is unavailable for DeepSeek PoW WASM.');
}

function writeWasmString(wasm: DeepSeekPowWasmExports, value: string): WasmStringAllocation {
  const bytes = textEncoder.encode(value);
  const ptr = wasm.__wbindgen_export_0(bytes.length, 1);
  new Uint8Array(wasm.memory.buffer).set(bytes, ptr);
  return { ptr, len: bytes.length };
}
