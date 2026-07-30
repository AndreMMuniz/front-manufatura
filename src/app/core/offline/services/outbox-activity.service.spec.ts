import { describe, expect, it, vi } from 'vitest';

import {
  BrowserActivityEnvironment,
  OutboxActivityService,
} from './outbox-activity.service';

describe('OutboxActivityService', () => {
  it('publica na mesma aba e entre abas somente o envelope mínimo', () => {
    const fixture = environment();
    const service = new OutboxActivityService(fixture.value);
    const received: unknown[] = [];
    service.invalidations$.subscribe(event => received.push(event));

    service.publish();

    expect(received).toEqual([expect.objectContaining({
      type: 'invalidate',
      version: 1,
      origin: 'tab-a',
    })]);
    expect(fixture.postMessage).toHaveBeenCalledWith({
      type: 'invalidate',
      version: 1,
      origin: 'tab-a',
    });
    expect(JSON.stringify(fixture.postMessage.mock.calls)).not.toMatch(/payload|command/i);
  });

  it('aceita evento de outra aba sem retransmitir e ignora eco próprio/malformado', () => {
    const fixture = environment();
    const service = new OutboxActivityService(fixture.value);
    const received = vi.fn();
    service.invalidations$.subscribe(received);

    fixture.message({ type: 'invalidate', version: 8, origin: 'tab-b' });
    fixture.message({ type: 'invalidate', version: 9, origin: 'tab-a' });
    fixture.message({ type: 'command', payload: 'secret' });

    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith({
      type: 'invalidate',
      version: 8,
      origin: 'tab-b',
    });
    expect(fixture.postMessage).not.toHaveBeenCalled();
  });

  it('invalida ao recuperar foco/visibilidade e remove listeners/canal no lifecycle', () => {
    const fixture = environment();
    const service = new OutboxActivityService(fixture.value);
    const received = vi.fn();
    service.invalidations$.subscribe(received);

    fixture.focus();
    fixture.visibility();
    expect(received).toHaveBeenCalledTimes(2);

    service.ngOnDestroy();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it('é inerte e SSR-safe sem ambiente browser', () => {
    const service = new OutboxActivityService(null);
    const received = vi.fn();
    service.invalidations$.subscribe(received);

    service.publish();
    service.ngOnDestroy();

    expect(received).toHaveBeenCalledOnce();
  });
});

function environment() {
  let onMessage: ((event: MessageEvent<unknown>) => void) | undefined;
  let onFocus: (() => void) | undefined;
  let onVisibility: (() => void) | undefined;
  const postMessage = vi.fn();
  const close = vi.fn();
  const removeEventListener = vi.fn();
  const value: BrowserActivityEnvironment = {
    origin: 'tab-a',
    createChannel: () => ({
      postMessage,
      close,
      addEventListener: (_type, listener) => {
        onMessage = listener;
      },
      removeEventListener: vi.fn(),
    }),
    visibilityState: () => 'visible',
    addEventListener: (type, listener) => {
      if (type === 'focus') onFocus = listener;
      else onVisibility = listener;
    },
    removeEventListener,
  };
  return {
    value,
    postMessage,
    close,
    removeEventListener,
    message: (data: unknown) => onMessage?.({ data } as MessageEvent<unknown>),
    focus: () => onFocus?.(),
    visibility: () => onVisibility?.(),
  };
}
