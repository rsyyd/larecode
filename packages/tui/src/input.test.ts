import { describe, expect, it } from 'vitest';
import { emptyInput, handleInput, type InputState, type KeyEvent } from './input.js';

function key(input: string, flags: KeyEvent['key'] = {}): KeyEvent {
  return { input, key: flags };
}

function state(text: string, cursor = text.length): InputState {
  return { text, cursor };
}

describe('handleInput', () => {
  it('inserts characters at the cursor', () => {
    const outcome = handleInput(emptyInput(), key('hi'));
    expect(outcome).toEqual({ type: 'changed', state: state('hi') });
  });

  it('inserts in the middle at the cursor position', () => {
    const outcome = handleInput(state('held', 2), key('X'));
    expect(outcome).toEqual({ type: 'changed', state: state('heXld', 3) });
  });

  it('submits on enter', () => {
    expect(handleInput(state('hello'), key('\r', { return: true }))).toEqual({
      type: 'submit',
      value: 'hello',
    });
  });

  it('inserts a newline on ctrl+j', () => {
    const outcome = handleInput(state('ab', 1), key('j', { ctrl: true }));
    expect(outcome).toEqual({ type: 'changed', state: state('a\nb', 2) });
  });

  it('deletes before the cursor on backspace', () => {
    const outcome = handleInput(state('abc', 2), key('', { backspace: true }));
    expect(outcome).toEqual({ type: 'changed', state: state('ac', 1) });
  });

  it('deletes at the cursor on delete', () => {
    const outcome = handleInput(state('abc', 1), key('', { delete: true }));
    expect(outcome).toEqual({ type: 'changed', state: state('ac', 1) });
  });

  it('moves with arrows, home, and end', () => {
    expect(handleInput(state('abc'), key('', { leftArrow: true }))).toEqual({
      type: 'changed',
      state: state('abc', 2),
    });
    expect(handleInput(state('abc', 1), key('', { rightArrow: true }))).toEqual({
      type: 'changed',
      state: state('abc', 2),
    });
    expect(handleInput(state('abc', 2), key('', { home: true }))).toEqual({
      type: 'changed',
      state: state('abc', 0),
    });
    expect(handleInput(state('abc', 0), key('', { end: true }))).toEqual({
      type: 'changed',
      state: state('abc', 3),
    });
  });

  it('clamps arrows at the edges', () => {
    expect(handleInput(state('abc', 0), key('', { leftArrow: true }))).toEqual({
      type: 'changed',
      state: state('abc', 0),
    });
    expect(handleInput(state('abc', 3), key('', { rightArrow: true }))).toEqual({
      type: 'changed',
      state: state('abc', 3),
    });
  });

  it('ignores escape, tab, and control chords', () => {
    expect(handleInput(emptyInput(), key('\x1b', { escape: true }))).toEqual({ type: 'ignored' });
    expect(handleInput(emptyInput(), key('', { tab: true }))).toEqual({ type: 'ignored' });
    expect(handleInput(emptyInput(), key('c', { ctrl: true }))).toEqual({ type: 'ignored' });
  });

  it('keeps backspace at the start as a no-op change', () => {
    const outcome = handleInput(state('abc', 0), key('', { backspace: true }));
    expect(outcome).toEqual({ type: 'changed', state: state('abc', 0) });
  });
});
