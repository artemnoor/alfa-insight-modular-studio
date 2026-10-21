export const HACK_APPROVED_MODEL_IDS = Object.freeze([
  'google/gemma-4-26b-a4b',
  'z-ai/glm-5.3-flash',
  'qwen/qwen3.6-35b-a3b',
  'deepseek/deepseek-v4.1-flash-1017',
  'qwen/qwen3-vl-30b-a3b-instruct',
  'moonshotai/kimi-k2.6',
])

export const DEFAULT_HACK_MODEL = 'deepseek/deepseek-v4.1-flash-1017'

export function assertHackApprovedModel(model, setting = 'model') {
  if (!HACK_APPROVED_MODEL_IDS.includes(model)) {
    throw new Error(`${setting} '${model}' is not on the Alfa Hack approved model list`)
  }
  return model
}
