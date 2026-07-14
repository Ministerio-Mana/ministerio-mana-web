import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileRevealDelay, shouldUseStaticStory } from '../src/lib/storyMotion.ts';

test('usa flujo estático en celulares sin activar pinning', () => {
  assert.equal(shouldUseStaticStory({
    reducedMotion: false,
    staticMobile: true,
    viewportWidth: 390,
    staticBreakpoint: 768,
  }), true);
});

test('conserva la historia animada en escritorio', () => {
  assert.equal(shouldUseStaticStory({
    reducedMotion: false,
    staticMobile: true,
    viewportWidth: 1280,
    staticBreakpoint: 768,
  }), false);
});

test('respeta reducción de movimiento en cualquier pantalla', () => {
  assert.equal(shouldUseStaticStory({
    reducedMotion: true,
    staticMobile: false,
    viewportWidth: 1440,
    staticBreakpoint: 768,
  }), true);
});

test('limita el escalonamiento para que el contenido no tarde en aparecer', () => {
  assert.equal(mobileRevealDelay(0), '0ms');
  assert.equal(mobileRevealDelay(3), '135ms');
  assert.equal(mobileRevealDelay(20), '225ms');
  assert.equal(mobileRevealDelay(Number.NaN), '0ms');
});
