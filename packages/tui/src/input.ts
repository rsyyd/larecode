export interface InputState {
  text: string;
  cursor: number;
}

export interface KeyFlags {
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  home?: boolean;
  end?: boolean;
  tab?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export interface KeyEvent {
  input: string;
  key: KeyFlags;
}

export type InputEvent =
  { type: 'submit'; value: string } | { type: 'changed'; state: InputState } | { type: 'ignored' };

export function emptyInput(): InputState {
  return { text: '', cursor: 0 };
}

export function handleInput(state: InputState, event: KeyEvent): InputEvent {
  const { input, key } = event;

  if (key.ctrl && input === 'j') {
    return changed(insert(state, '\n'));
  }
  if (key.return) {
    return { type: 'submit', value: state.text };
  }
  if (key.backspace || input === '\x7f') {
    return changed(deleteBefore(state));
  }
  if (key.delete) {
    return changed(deleteAt(state));
  }
  if (key.leftArrow) {
    return changed({ ...state, cursor: Math.max(0, state.cursor - 1) });
  }
  if (key.rightArrow) {
    return changed({ ...state, cursor: Math.min(state.text.length, state.cursor + 1) });
  }
  if (key.home) {
    return changed({ ...state, cursor: 0 });
  }
  if (key.end) {
    return changed({ ...state, cursor: state.text.length });
  }
  if (key.escape || key.tab || key.upArrow || key.downArrow || key.ctrl || key.meta) {
    return { type: 'ignored' };
  }
  if (input.length > 0) {
    return changed(insert(state, input));
  }
  return { type: 'ignored' };
}

function changed(state: InputState): InputEvent {
  return { type: 'changed', state };
}

function insert(state: InputState, text: string): InputState {
  const before = state.text.slice(0, state.cursor);
  const after = state.text.slice(state.cursor);
  return { text: before + text + after, cursor: state.cursor + text.length };
}

function deleteBefore(state: InputState): InputState {
  if (state.cursor === 0) return state;
  return {
    text: state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor),
    cursor: state.cursor - 1,
  };
}

function deleteAt(state: InputState): InputState {
  if (state.cursor >= state.text.length) return state;
  return {
    text: state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1),
    cursor: state.cursor,
  };
}
