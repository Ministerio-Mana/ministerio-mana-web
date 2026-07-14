import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mobileRevealDelay,
  resolveStoryMotionConfig,
  shouldUseStaticStory,
  storySnapPoint,
} from '../src/lib/storyMotion.ts';

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

test('resuelve presets de movimiento con un default editorial', () => {
  assert.equal(resolveStoryMotionConfig('calm').scrollFactor, 1.08);
  assert.equal(resolveStoryMotionConfig('cinematic').scrub, 1.05);
  assert.equal(resolveStoryMotionConfig('desconocido').preset, 'editorial');
});

test('limita ajustes para que una plantilla no secuestre el scroll', () => {
  const config = resolveStoryMotionConfig('editorial', {
    scrollFactor: 12,
    scrub: 0.01,
    snapMinDuration: 0.7,
    snapMaxDuration: 0.1,
  });

  assert.equal(config.scrollFactor, 1.6);
  assert.equal(config.scrub, 0.4);
  assert.equal(config.snapMinDuration, 0.5);
  assert.equal(config.snapMaxDuration, 0.5);
});

test('calcula el punto de descanso según la cantidad de escenas', () => {
  assert.equal(storySnapPoint(0.48, 6), 0.4);
  assert.equal(storySnapPoint(1.4, 6), 1);
  assert.equal(storySnapPoint(Number.NaN, 6), 0);
});
