const replyStart = '<send_user_message_question_reply>';
const replyEnd = '</send_user_message_question_reply>';

function replyIds(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text.startsWith(replyStart) || !text.endsWith(replyEnd)) return [];
  try {
    const parsed = JSON.parse(text.slice(replyStart.length, -replyEnd.length));
    const replies = Array.isArray(parsed) ? parsed : [parsed];
    return replies.every(reply => typeof reply?.questionItemId === 'string'
      && typeof reply.question === 'string' && typeof reply.answer === 'string')
      ? replies.map(reply => reply.questionItemId)
      : [];
  } catch {
    return [];
  }
}

const string = value => typeof value === 'string' ? value : null;
const textPart = { type: string, text: replyIds };
const turn = {
  status: string,
  turnId: string,
  items: [{
    type: string,
    id: string,
    status: string,
    questions: [() => null],
    content: [textPart],
    input: [textPart],
  }],
};
const historyShape = {
  turns: [turn],
  turnHistory: {
    kind: string,
    history: {
      entitiesByKey: { '*': turn },
      islands: [{ entries: [{ value: string }] }],
    },
  },
};

// Preserve patch paths and array indices while discarding conversation text.
function project(value, shape) {
  if (typeof shape === 'function') return shape(value);
  if (Array.isArray(shape)) return Array.isArray(value) ? value.map(item => project(item, shape[0])) : null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = Object.create(null);
  const entryShape = shape['*'];
  for (const key of entryShape ? Object.keys(value) : Object.keys(shape)) {
    if (Object.hasOwn(value, key)) result[key] = project(value[key], entryShape ?? shape[key]);
  }
  return result;
}

export function projectInputHistory(state) {
  return project(state, historyShape);
}

function shapeAt(shape, key) {
  if (typeof shape === 'function') return undefined;
  if (Array.isArray(shape)) return Number.isSafeInteger(key) && key >= 0 ? shape[0] : undefined;
  if (typeof key !== 'string') return undefined;
  return shape['*'] ?? (Object.hasOwn(shape, key) ? shape[key] : undefined);
}

export function patchInputHistory(history, patch) {
  let shape = historyShape;
  let parent;
  let target = history;
  let key;
  for (const segment of patch.path) {
    shape = shapeAt(shape, segment);
    if (!shape) return null;
    key = segment;
    parent = target;
    target = parent?.[key];
  }

  const { op, value } = patch;
  if (!parent || !['add', 'replace', 'remove'].includes(op)) return false;
  if (Array.isArray(parent)) {
    if (key > parent.length || (op !== 'add' && key === parent.length)) return false;
    if (op === 'replace') parent[key] = project(value, shape);
    else if (op === 'add') parent.splice(key, 0, project(value, shape));
    else parent.splice(key, 1);
  } else if (op === 'remove') {
    delete parent[key];
  } else {
    parent[key] = project(value, shape);
  }
  return true;
}

export function hasPendingInput(history) {
  const canonical = history?.turnHistory;
  let active;
  if (canonical?.kind === 'canonical') {
    const { entitiesByKey, islands } = canonical.history ?? {};
    if (!entitiesByKey || !Array.isArray(islands) || islands.some(island => !Array.isArray(island?.entries))) return null;
    for (let index = islands.length - 1; index >= 0 && !active; index--) {
      const entry = islands[index].entries.findLast(item => entitiesByKey[item?.value]?.status === 'inProgress');
      if (entry) active = entitiesByKey[entry.value];
    }
  } else {
    if (!Array.isArray(history?.turns)) return null;
    active = history.turns.findLast(turn => turn?.status === 'inProgress');
  }
  if (!active) return false;
  if (!active.turnId || !Array.isArray(active.items)) return null;
  const answered = new Set();
  for (const item of active.items) {
    const parts = item?.type === 'userMessage' ? item.content
      : item?.type === 'steeringUserMessage' && item.status === 'accepted' ? item.input : null;
    for (const part of parts ?? []) {
      if (part?.type === 'text') for (const id of part.text ?? []) answered.add(id);
    }
  }
  return active.items.some(item => item?.type === 'agentMessage' && item.id
    && item.questions?.some((_, index) => !answered.has(JSON.stringify(['request_user_input_async', item.id, index]))));
}
