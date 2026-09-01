export type { Vec } from './vector';
export { dot, norm, normalize, cosine } from './vector';

export type {
  EngineConfig,
  EngineEvent,
  EngineState,
  FireEvent,
  LiveToken,
  StepResult,
} from './types';

export { init, step, replay, validateConfig, lambdaFromHalfLife } from './engine';

export type { TokenEmbedder, RetrievalHit, RetrievalPort } from './ports';
export { fakeEmbedder } from './fake';
