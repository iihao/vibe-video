import { sceneSchema } from '../schema.mjs';

// Read only closed scene objects. Incomplete JSON and strings (including braces
// inside notes) never enter the preview or the saved project.
export function readSceneDrafts(text) {
  const scenes = [];
  let depth = 0,
    quoted = false,
    escaped = false,
    stringStart = 0,
    inScenes = false,
    objectStart = -1;
  for (let i = 0; i < text.length && scenes.length < 12; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') {
        quoted = false;
        if (!inScenes && depth === 1 && text.slice(stringStart, i + 1) === '"scenes"') {
          const match = /^\s*:\s*\[/.exec(text.slice(i + 1));
          if (match) {
            inScenes = true;
            depth = 2;
            i += match[0].length;
          }
        }
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      stringStart = i;
    } else if (c === '{' || c === '[') {
      if (inScenes && c === '{' && depth === 2) objectStart = i;
      depth++;
    } else if (c === '}' || c === ']') {
      depth--;
      if (inScenes && c === '}' && depth === 2 && objectStart >= 0) {
        try {
          const result = sceneSchema.safeParse(JSON.parse(text.slice(objectStart, i + 1)));
          if (result.success) scenes.push(result.data);
        } catch {
          // A malformed draft remains provisional until the final story check.
        }
        objectStart = -1;
      }
      if (inScenes && depth < 2) break;
    }
  }
  return scenes;
}
