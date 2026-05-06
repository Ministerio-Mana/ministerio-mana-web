import Lenis from '@studio-freight/lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function toGsapTargets(...items) {
  return items.flatMap((item) => {
    if (!item) return [];
    if (item.nodeType) return [item];
    return Array.from(item).filter(Boolean);
  });
}

function fromToIfTargets(timeline, targets, fromVars, toVars, position) {
  const targetList = toGsapTargets(targets);
  if (!targetList.length) return timeline;
  return timeline.fromTo(targetList, fromVars, toVars, position);
}

function toIfTargets(timeline, targets, vars, position) {
  const targetList = toGsapTargets(targets);
  if (!targetList.length) return timeline;
  return timeline.to(targetList, vars, position);
}

function setupLenis() {
  if (prefersReducedMotion()) return undefined;
  if (window.__manaStoryLenis) return window.__manaStoryLenis;

  const lenis = new Lenis({
    lerp: 0.08,
    orientation: 'vertical',
    gestureOrientation: 'vertical',
    smoothWheel: true,
    wheelMultiplier: 1,
    smoothTouch: false,
    touchMultiplier: 2,
    infinite: false,
  });

  window.__manaStoryLenis = lenis;
  window.lenis = lenis;

  lenis.on('scroll', ScrollTrigger.update);

  if (!window.__manaStoryTickerBound) {
    gsap.ticker.add((time) => {
      window.__manaStoryLenis?.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);
    window.__manaStoryTickerBound = true;
  }

  return lenis;
}

function splitWords(target) {
  if (!target || target.dataset.manaSplitDone === 'true') return;

  const text = target.textContent?.replace(/\s+/g, ' ').trim();
  if (!text) return;

  target.textContent = '';
  text.split(' ').forEach((word, index, words) => {
    const span = document.createElement('span');
    span.className = 'mana-word';
    span.textContent = index === words.length - 1 ? word : `${word} `;
    target.appendChild(span);
  });
  target.dataset.manaSplitDone = 'true';
}

function bindSceneButtons() {
  document.querySelectorAll('[data-mana-next]').forEach((button) => {
    if (button.dataset.manaBound === 'true') return;

    button.dataset.manaBound = 'true';
    button.addEventListener('click', () => {
      const nextY = window.scrollY + window.innerHeight * 1.08;
      if (window.lenis?.scrollTo) window.lenis.scrollTo(nextY, { duration: 1.1 });
      else window.scrollTo({ top: nextY, behavior: 'smooth' });
    });
  });
}

function killExistingStoryTriggers() {
  ScrollTrigger.getAll()
    .filter((trigger) => trigger.vars?.id?.startsWith('mana-slide-story-'))
    .forEach((trigger) => trigger.kill());
}

function buildSceneTimeline(scene, index) {
  const slide = scene.querySelector('.mana-slide');
  const titleWords = scene.querySelectorAll(
    '[data-mana-title] .mana-word, .mana-title-lockup h2 .mana-word, .mana-food-grid h2 .mana-word, .mana-final-grid h2 .mana-word',
  );
  const scriptWords = scene.querySelectorAll(
    '.mana-script .mana-word, .mana-hero-title > span .mana-word, .mana-eyebrow .mana-word',
  );
  const copyWords = scene.querySelectorAll('[data-mana-copy] .mana-word');
  const visual = scene.querySelector('[data-mana-visual]');
  const art = scene.querySelector('.mana-slide__art');
  const staggerItems = scene.querySelectorAll('[data-mana-stagger] > *');
  const ui = scene.querySelectorAll('[data-mana-ui]');
  const progress = scene.querySelector('[data-mana-progress]');
  const routeLines = scene.querySelectorAll('.mana-route i');

  if (!slide) return;

  gsap.set(scene, { zIndex: index + 1 });
  gsap.set(slide, { autoAlpha: 1, scale: 1, y: 0, filter: 'blur(0px)' });
  const animatedTargets = toGsapTargets(titleWords, scriptWords, copyWords, visual, staggerItems, ui, routeLines);
  if (animatedTargets.length) gsap.set(animatedTargets, { clearProps: 'all' });

  const timeline = gsap.timeline({
    defaults: { ease: 'power3.out' },
    scrollTrigger: {
      id: `mana-slide-story-${index}`,
      trigger: scene,
      start: 'top top',
      end: () => `+=${Math.round(window.innerHeight * 1.05)}`,
      pin: slide,
      pinSpacing: true,
      scrub: 0.85,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      snap: {
        snapTo: (value) => (value < 0.5 ? 0 : 1),
        duration: { min: 0.16, max: 0.34 },
        delay: 0.03,
        ease: 'power2.out',
      },
      onUpdate: ({ progress: t }) => {
        if (progress) progress.style.transform = `scaleX(${t})`;
        slide.style.setProperty('--scene-progress', String(t));
      },
    },
  });

  if (index === 0) {
    const initialTargets = toGsapTargets(scriptWords, titleWords, copyWords, ui);
    if (initialTargets.length) gsap.set(initialTargets, { autoAlpha: 1, y: 0, rotateX: 0, filter: 'blur(0px)' });
  } else {
    fromToIfTargets(
      timeline,
      scriptWords,
      { autoAlpha: 0.86, y: 14, filter: 'blur(0px)' },
      { autoAlpha: 1, y: 0, filter: 'blur(0px)', stagger: 0.018, duration: 0.18 },
      0.02,
    );
    fromToIfTargets(
      timeline,
      titleWords,
      { autoAlpha: 0.82, y: 26, rotateX: -8, filter: 'blur(0px)' },
      { autoAlpha: 1, y: 0, rotateX: 0, filter: 'blur(0px)', stagger: 0.024, duration: 0.26 },
      0.06,
    );
    fromToIfTargets(
      timeline,
      copyWords,
      { autoAlpha: 0.82, y: 12, filter: 'blur(0px)' },
      { autoAlpha: 1, y: 0, filter: 'blur(0px)', stagger: 0.006, duration: 0.28 },
      0.22,
    );
    fromToIfTargets(timeline, ui, { autoAlpha: 0.76, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.18, stagger: 0.04 }, 0.32);
  }

  if (visual) {
    fromToIfTargets(
      timeline,
      visual,
      { autoAlpha: index === 0 ? 0 : 0.24, y: 54, scale: 0.94, filter: 'blur(12px)' },
      { autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.32 },
      0.14,
    );
    toIfTargets(timeline, visual, { y: -18, scale: 1.035, duration: 0.42, ease: 'none' }, 0.44);
  }

  if (art) {
    fromToIfTargets(
      timeline,
      art,
      { autoAlpha: 0.16, x: 90, scale: 0.96 },
      { autoAlpha: 0.36, x: 0, scale: 1, duration: 0.44 },
      0.08,
    );
    toIfTargets(timeline, art, { x: -44, scale: 1.08, duration: 0.48, ease: 'none' }, 0.42);
  }

  if (staggerItems.length) {
    fromToIfTargets(
      timeline,
      staggerItems,
      { autoAlpha: 0.42, y: 46, scale: 0.96 },
      { autoAlpha: 1, y: 0, scale: 1, stagger: 0.055, duration: 0.28 },
      0.2,
    );
  }

  if (routeLines.length) {
    fromToIfTargets(timeline, routeLines, { scaleX: 0 }, { scaleX: 1, duration: 0.22, stagger: 0.08 }, 0.2);
  }

  timeline.to(slide, { scale: 1.01, duration: 0.2, ease: 'none' }, 0.78);
}

function initManaStoryCode() {
  const story = document.querySelector('.mana-story-code');
  const scenes = gsap.utils.toArray('[data-mana-scene]');

  killExistingStoryTriggers();

  if (!story || !scenes.length) return;

  story.querySelectorAll('[data-mana-split]').forEach(splitWords);
  bindSceneButtons();

  if (prefersReducedMotion()) return;

  setupLenis();
  scenes.forEach(buildSceneTimeline);

  if (!window.__manaStoryResizeBound) {
    window.addEventListener(
      'resize',
      () => {
        ScrollTrigger.refresh();
      },
      { passive: true },
    );
    window.__manaStoryResizeBound = true;
  }

  requestAnimationFrame(() => ScrollTrigger.refresh());
}

document.addEventListener('astro:page-load', initManaStoryCode);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initManaStoryCode, { once: true });
} else {
  initManaStoryCode();
}
