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

function bindSceneButtons(scenes) {
  document.querySelectorAll('[data-mana-next]').forEach((button) => {
    if (button.dataset.manaBound === 'true') return;

    button.dataset.manaBound = 'true';
    button.addEventListener('click', () => {
      const trigger = ScrollTrigger.getById('mana-slide-story-master');
      if (!trigger) {
        window.scrollTo({ top: window.scrollY + window.innerHeight, behavior: 'smooth' });
        return;
      }

      const current = Math.round(trigger.progress * (scenes.length - 1));
      const nextProgress = Math.min(current + 1, scenes.length - 1) / Math.max(1, scenes.length - 1);
      const nextY = trigger.start + (trigger.end - trigger.start) * nextProgress;
      if (window.lenis?.scrollTo) window.lenis.scrollTo(nextY, { duration: 1.05 });
      else window.scrollTo({ top: nextY, behavior: 'smooth' });
    });
  });
}

function killExistingStoryTriggers() {
  ScrollTrigger.getAll()
    .filter((trigger) => trigger.vars?.id?.startsWith('mana-slide-story-'))
    .forEach((trigger) => trigger.kill());
}

function getSceneParts(scene) {
  return {
    slide: scene.querySelector('.mana-slide'),
    titleWords: scene.querySelectorAll(
      '[data-mana-title] .mana-word, .mana-title-lockup h2 .mana-word, .mana-food-grid h2 .mana-word, .mana-final-grid h2 .mana-word',
    ),
    scriptWords: scene.querySelectorAll(
      '.mana-script .mana-word, .mana-hero-title > span .mana-word, .mana-eyebrow .mana-word',
    ),
    copyWords: scene.querySelectorAll('[data-mana-copy] .mana-word'),
    visual: scene.querySelector('[data-mana-visual]'),
    art: scene.querySelector('.mana-slide__art'),
    staggerItems: scene.querySelectorAll('[data-mana-stagger] > *'),
    ui: scene.querySelectorAll('[data-mana-ui]'),
    progress: scene.querySelector('[data-mana-progress]'),
    routeLines: scene.querySelectorAll('.mana-route i'),
  };
}

function prepareScene(scene, index) {
  const {
    slide,
    titleWords,
    scriptWords,
    copyWords,
    visual,
    staggerItems,
    ui,
    routeLines,
  } = getSceneParts(scene);

  if (!slide) return;

  gsap.set(scene, {
    autoAlpha: index === 0 ? 1 : 0,
    zIndex: index + 1,
    yPercent: index === 0 ? 0 : 4,
  });
  gsap.set(slide, { autoAlpha: 1, scale: 1, y: 0, filter: 'blur(0px)' });

  const animatedTargets = toGsapTargets(titleWords, scriptWords, copyWords, visual, staggerItems, ui, routeLines);
  if (animatedTargets.length) gsap.set(animatedTargets, { clearProps: 'all' });

  const readableTargets = toGsapTargets(scriptWords, titleWords, copyWords, ui, staggerItems);
  if (readableTargets.length) gsap.set(readableTargets, { autoAlpha: 1, y: 0, rotateX: 0, filter: 'blur(0px)' });
}

function addSceneMotion(masterTimeline, scene, index) {
  const slide = scene.querySelector('.mana-slide');
  const {
    titleWords,
    scriptWords,
    copyWords,
    visual,
    art,
    staggerItems,
    ui,
    routeLines,
  } = getSceneParts(scene);

  if (!slide) return;

  const step = index;

  if (index === 0) {
    const initialTargets = toGsapTargets(scriptWords, titleWords, copyWords, ui);
    if (initialTargets.length) gsap.set(initialTargets, { autoAlpha: 1, y: 0, rotateX: 0, filter: 'blur(0px)' });
  } else {
    masterTimeline
      .to(scene, { autoAlpha: 1, yPercent: 0, duration: 0.32, ease: 'power2.out' }, step - 0.34)
      .to(scene.previousElementSibling, { autoAlpha: 0, yPercent: -4, duration: 0.3, ease: 'power2.inOut' }, step - 0.32);

    fromToIfTargets(
      masterTimeline,
      scriptWords,
      { autoAlpha: 0.86, y: 14, filter: 'blur(0px)' },
      { autoAlpha: 1, y: 0, filter: 'blur(0px)', stagger: 0.018, duration: 0.18 },
      step - 0.24,
    );
    fromToIfTargets(
      masterTimeline,
      titleWords,
      { autoAlpha: 0.82, y: 26, rotateX: -8, filter: 'blur(0px)' },
      { autoAlpha: 1, y: 0, rotateX: 0, filter: 'blur(0px)', stagger: 0.024, duration: 0.26 },
      step - 0.22,
    );
    fromToIfTargets(
      masterTimeline,
      copyWords,
      { autoAlpha: 0.82, y: 12, filter: 'blur(0px)' },
      { autoAlpha: 1, y: 0, filter: 'blur(0px)', stagger: 0.006, duration: 0.28 },
      step - 0.12,
    );
    fromToIfTargets(masterTimeline, ui, { autoAlpha: 0.76, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.18, stagger: 0.04 }, step - 0.08);
  }

  if (visual) {
    fromToIfTargets(
      masterTimeline,
      visual,
      { autoAlpha: index === 0 ? 0 : 0.24, y: 54, scale: 0.94, filter: 'blur(12px)' },
      { autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.32 },
      index === 0 ? 0.08 : step - 0.18,
    );
    toIfTargets(masterTimeline, visual, { y: -18, scale: 1.035, duration: 0.42, ease: 'none' }, index === 0 ? 0.42 : step + 0.18);
  }

  if (art) {
    fromToIfTargets(
      masterTimeline,
      art,
      { autoAlpha: 0.16, x: 90, scale: 0.96 },
      { autoAlpha: 0.36, x: 0, scale: 1, duration: 0.44 },
      index === 0 ? 0.08 : step - 0.22,
    );
    toIfTargets(masterTimeline, art, { x: -44, scale: 1.08, duration: 0.48, ease: 'none' }, index === 0 ? 0.42 : step + 0.16);
  }

  if (staggerItems.length) {
    fromToIfTargets(
      masterTimeline,
      staggerItems,
      { autoAlpha: 0.42, y: 46, scale: 0.96 },
      { autoAlpha: 1, y: 0, scale: 1, stagger: 0.055, duration: 0.28 },
      index === 0 ? 0.16 : step - 0.14,
    );
  }

  if (routeLines.length) {
    fromToIfTargets(masterTimeline, routeLines, { scaleX: 0 }, { scaleX: 1, duration: 0.22, stagger: 0.08 }, index === 0 ? 0.16 : step - 0.14);
  }

  masterTimeline.to(slide, { scale: 1.01, duration: 0.28, ease: 'none' }, index === 0 ? 0.72 : step + 0.18);
}

function updateSceneProgress(scenes, totalProgress) {
  const maxIndex = Math.max(1, scenes.length - 1);
  const total = totalProgress * maxIndex;

  scenes.forEach((scene, index) => {
    const slide = scene.querySelector('.mana-slide');
    const progress = scene.querySelector('[data-mana-progress]');
    const localProgress = Math.min(Math.max(total - index, 0), 1);
    if (progress) progress.style.transform = `scaleX(${localProgress})`;
    if (slide) slide.style.setProperty('--scene-progress', String(localProgress));
  });
}

function initManaStoryCode() {
  const story = document.querySelector('.mana-story-code');
  const scenes = gsap.utils.toArray('[data-mana-scene]');

  killExistingStoryTriggers();

  if (!story || !scenes.length) return;

  story.querySelectorAll('[data-mana-split]').forEach(splitWords);
  bindSceneButtons(scenes);

  if (prefersReducedMotion()) return;

  setupLenis();
  story.classList.add('is-pinned-deck');
  scenes.forEach(prepareScene);

  const sceneCount = scenes.length;
  const masterTimeline = gsap.timeline({
    defaults: { ease: 'power3.out' },
    scrollTrigger: {
      id: 'mana-slide-story-master',
      trigger: story,
      start: 'top top',
      end: () => `+=${Math.round(window.innerHeight * Math.max(1, sceneCount - 1))}`,
      pin: story,
      pinSpacing: true,
      scrub: 0.85,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      snap: {
        snapTo: 1 / Math.max(1, sceneCount - 1),
        duration: { min: 0.18, max: 0.42 },
        delay: 0.03,
        ease: 'power2.out',
      },
      onUpdate: ({ progress }) => updateSceneProgress(scenes, progress),
    },
  });

  scenes.forEach((scene, index) => addSceneMotion(masterTimeline, scene, index));

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
