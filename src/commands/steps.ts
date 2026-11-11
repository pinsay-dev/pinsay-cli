import { getClient } from './comments.js';
import { parseCommentNumber, invalidNumberMessage, fetchCommentByNumber, CommentNotFoundError } from '../lib/comment-ref.js';
import { pruneMedia, saveIfRooted, stepPaths } from '../apply/media.js';
import { mapEnvironmentToString } from '../apply/environment.js';
import {
  type Framework,
  type Language,
  type Target,
  DEFAULT_TARGET,
  parseTarget,
  isStepRecording,
  buildStepSpec,
  buildStepPrompt,
} from '../apply/steps.js';

export async function stepsCommand(
  cwd: string,
  parsed: Record<string, string | boolean>,
  positionals: string[] = [],
): Promise<void> {
  if (Object.keys(parsed).some((key) => /^--id(=|$)/.test(`--${key}`))) {
    console.error("--id was removed: pass the comment's number, e.g. npx @pinsay/cli steps 12 (internal ids are not accepted).");
    process.exit(2);
  }

  const fwGiven = parsed['framework'] !== undefined || parsed['language'] !== undefined;
  let target: Target = DEFAULT_TARGET;
  if (parsed['target'] !== undefined) {
    const t = parseTarget(String(parsed['target']));
    if (!t) {
      console.error(`Unknown --target "${parsed['target']}" (use agent, test, guide or repro).`);
      process.exit(2);
    }
    if (fwGiven && t !== 'test') {
      console.error('--framework and --language only apply to --target test.');
      process.exit(2);
    }
    target = t;
  } else if (fwGiven) {
    target = 'test';
  }

  let framework: Framework = 'playwright';
  if (parsed['framework'] !== undefined) {
    const f = String(parsed['framework']).toLowerCase();
    if (f !== 'playwright' && f !== 'cypress' && f !== 'vitest') {
      console.error(`Unknown --framework "${parsed['framework']}" (use playwright, cypress or vitest).`);
      process.exit(2);
    }
    framework = f as Framework;
  }

  let language: Language = 'ts';
  if (parsed['language'] !== undefined) {
    const l = String(parsed['language']).toLowerCase();
    if (l !== 'ts' && l !== 'js') {
      console.error(`Unknown --language "${parsed['language']}" (use ts or js).`);
      process.exit(2);
    }
    language = l as Language;
  }

  const { server, token, project, root } = await getClient(cwd, parsed, { requireProject: true });
  const numStr = positionals[1] || (typeof parsed['number'] === 'string' ? parsed['number'] : undefined);
  if (!numStr) {
    console.error('Usage: pinsay steps <number> [--target agent|test|guide|repro]');
    process.exit(2);
  }

  const n = parseCommentNumber(numStr);
  if (n === null) {
    console.error(invalidNumberMessage(numStr));
    process.exit(2);
  }

  let raw: any;
  try {
    raw = await fetchCommentByNumber(server, token, project, n);
  } catch (err) {
    if (err instanceof CommentNotFoundError) {
      console.error(err.message);
      process.exit(4);
    }
    throw err;
  }

  await pruneMedia(root);
  const saved = await saveIfRooted(raw, { root, projectKey: project, server, token });

  if (!isStepRecording(raw?.pageContext)) {
    console.error(`Comment #${n} is not a step recording.`);
    process.exit(1);
  }

  const screens = stepPaths(saved);
  const environment = mapEnvironmentToString(raw.environment);
  const spec = buildStepSpec(raw, screens, target, environment, framework, language);

  if (parsed['json'] === true) {
    console.log(JSON.stringify(spec, null, 2));
    process.exit(0);
  }

  console.log(buildStepPrompt(spec));
  process.exit(0);
}
