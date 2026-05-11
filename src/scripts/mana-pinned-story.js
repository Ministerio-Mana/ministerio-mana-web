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

  const textNodes = [];
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  while (walker.nextNode()) textNodes.push(walker.currentNode);
  if (!textNodes.length) return;

  textNodes.forEach((node) => {
    const normalized = node.nodeValue.replace(/\s+/g, ' ');
    const tokens = normalized.trim().match(/\S+\s*/g);
    if (!tokens) return;

    const fragment = document.createDocumentFragment();
    if (/^\s/.test(normalized) && node.previousSibling) {
      fragment.appendChild(document.createTextNode(' '));
    }
    tokens.forEach((token, index) => {
      const span = document.createElement('span');
      span.className = 'mana-word';
      span.textContent = token.trim();
      fragment.appendChild(span);
      if (index < tokens.length - 1 || /\s$/.test(normalized)) {
        fragment.appendChild(document.createTextNode(' '));
      }
    });
    node.replaceWith(fragment);
  });

  target.dataset.manaSplitDone = 'true';
}

function splitTitleChars(target) {
  if (!target || target.dataset.manaSplitDone === 'true') return;

  const text = target.textContent?.replace(/\s+/g, ' ').trim();
  if (!text) return;

  target.textContent = '';
  Array.from(text).forEach((char) => {
    const span = document.createElement('span');
    span.className = char === ' ' ? 'mana-char mana-char--space' : 'mana-char';
    span.textContent = char === ' ' ? '\u00a0' : char;
    target.appendChild(span);
  });
  target.dataset.manaSplitDone = 'true';
}

function splitText(target) {
  if (target.matches('[data-mana-title]')) splitTitleChars(target);
  else splitWords(target);
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
      '[data-mana-title] .mana-char, .mana-title-lockup h2 .mana-char, .mana-food-grid h2 .mana-char, .mana-final-grid h2 .mana-char',
    ),
    scriptWords: scene.querySelectorAll(
      '.mana-script .mana-word, .mana-hero-title > span .mana-word, .mana-eyebrow .mana-word',
    ),
    copyBlocks: scene.querySelectorAll('[data-mana-copy] > p, [data-mana-copy].mana-lead, .mana-fronts-intro > p'),
    copyWords: scene.querySelectorAll('[data-mana-copy] .mana-word'),
    visual: scene.querySelectorAll('[data-mana-visual]'),
    art: scene.querySelector('.mana-slide__art'),
    staggerItems: scene.querySelectorAll('[data-mana-stagger] > *'),
    ui: scene.querySelectorAll('[data-mana-ui]'),
    progress: scene.querySelector('[data-mana-progress]'),
    drawPaths: scene.querySelectorAll('[data-mana-draw]'),
    mapPins: scene.querySelectorAll('[data-mana-pin]'),
    mapMarks: scene.querySelectorAll('.mana-map-dot, .mana-map-pulse'),
  };
}

function prepareScene(scene, index) {
  const {
    slide,
    titleWords,
    scriptWords,
    copyBlocks,
    copyWords,
    visual,
    staggerItems,
    ui,
    drawPaths,
    mapPins,
    mapMarks,
  } = getSceneParts(scene);

  if (!slide) return;

  gsap.set(scene, {
    autoAlpha: 1,
    clipPath: index === 0 ? 'inset(0% 0% 0% 0%)' : 'inset(100% 0% 0% 0%)',
    zIndex: index + 1,
    yPercent: 0,
  });
  gsap.set(slide, { autoAlpha: 1, scale: 1, y: 0, filter: 'blur(0px)' });

  const animatedTargets = toGsapTargets(titleWords, scriptWords, copyBlocks, copyWords, visual, staggerItems, ui, drawPaths, mapPins, mapMarks);
  if (animatedTargets.length) gsap.set(animatedTargets, { clearProps: 'all' });

  const readableTargets = toGsapTargets(scriptWords, titleWords, copyBlocks, copyWords, ui, staggerItems, mapPins, mapMarks);
  if (readableTargets.length) gsap.set(readableTargets, { autoAlpha: 1, y: 0, rotateX: 0, filter: 'blur(0px)' });
  if (titleWords.length) gsap.set(titleWords, { transformPerspective: 900, transformOrigin: '50% 80%' });
  if (copyWords.length) gsap.set(copyWords, { transformPerspective: 700, transformOrigin: '50% 80%' });
  if (mapMarks.length) gsap.set(mapMarks, { transformOrigin: '50% 50%' });
  if (drawPaths.length) gsap.set(drawPaths, { strokeDasharray: 1, strokeDashoffset: 1 });
}

function addSceneMotion(masterTimeline, scene, index, sceneCount) {
  const slide = scene.querySelector('.mana-slide');
  const {
    titleWords,
    scriptWords,
    copyBlocks,
    copyWords,
    visual,
    art,
    staggerItems,
    ui,
    drawPaths,
    mapPins,
    mapMarks,
  } = getSceneParts(scene);

  if (!slide) return;

  const step = index;
  const isLast = index === sceneCount - 1;

  if (index === 0) {
    const initialTargets = toGsapTargets(scriptWords, titleWords, copyBlocks, copyWords, ui);
    if (initialTargets.length) gsap.set(initialTargets, { autoAlpha: 1, y: 0, rotateX: 0, filter: 'blur(0px)' });
  } else {
    masterTimeline
      .to(scene, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.44, ease: 'power3.inOut' }, step - 0.46)
      .to(scene.previousElementSibling, { scale: 0.992, duration: 0.36, ease: 'power2.inOut' }, step - 0.42);

    fromToIfTargets(
      masterTimeline,
      scriptWords,
      { autoAlpha: 0, y: 24, filter: 'blur(6px)' },
      { autoAlpha: 1, y: 0, filter: 'blur(0px)', stagger: 0.018, duration: 0.24 },
      step - 0.28,
    );
    fromToIfTargets(
      masterTimeline,
      titleWords,
      { autoAlpha: 0, y: 54, rotateX: -22, scale: 0.96, filter: 'blur(5px)' },
      { autoAlpha: 1, y: 0, rotateX: 0, scale: 1, filter: 'blur(0px)', stagger: 0.006, duration: 0.38 },
      step - 0.34,
    );
    fromToIfTargets(
      masterTimeline,
      copyBlocks,
      { autoAlpha: 0, y: 44, scale: 0.985, clipPath: 'inset(0% 0% 100% 0%)', filter: 'blur(6px)' },
      { autoAlpha: 1, y: 0, scale: 1, clipPath: 'inset(0% 0% 0% 0%)', filter: 'blur(0px)', stagger: 0.08, duration: 0.36 },
      step - 0.22,
    );
    fromToIfTargets(
      masterTimeline,
      copyWords,
      { autoAlpha: 0, y: 18, rotateX: -18, filter: 'blur(5px)' },
      { autoAlpha: 1, y: 0, rotateX: 0, filter: 'blur(0px)', stagger: 0.0024, duration: 0.3 },
      step - 0.17,
    );
    fromToIfTargets(masterTimeline, ui, { autoAlpha: 0, y: 18, filter: 'blur(4px)' }, { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.24, stagger: 0.035 }, step - 0.1);
  }

  if (visual) {
    fromToIfTargets(
      masterTimeline,
      visual,
      { autoAlpha: index === 0 ? 0.7 : 0.82, y: 24, scale: 0.96, filter: 'blur(0px)' },
      { autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.32 },
      index === 0 ? 0.08 : step - 0.18,
    );
    toIfTargets(masterTimeline, visual, { y: -18, scale: 1.035, duration: 0.42, ease: 'none' }, index === 0 ? 0.42 : step + 0.18);
  }

  toIfTargets(masterTimeline, titleWords, { y: -8, duration: 0.38, ease: 'none' }, index === 0 ? 0.62 : step + 0.2);
  toIfTargets(masterTimeline, copyBlocks, { y: -10, duration: 0.34, ease: 'none' }, index === 0 ? 0.66 : step + 0.24);

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
      { autoAlpha: 0, y: 54, scale: 0.94, filter: 'blur(6px)' },
      { autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)', stagger: 0.045, duration: 0.3 },
      index === 0 ? 0.16 : step - 0.18,
    );
  }

  if (drawPaths.length) {
    fromToIfTargets(masterTimeline, drawPaths, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.48, stagger: 0.05 }, index === 0 ? 0.18 : step - 0.16);
  }

  if (mapMarks.length) {
    fromToIfTargets(
      masterTimeline,
      mapMarks,
      { autoAlpha: 0, scale: 0.35 },
      { autoAlpha: 1, scale: 1, duration: 0.28, stagger: 0.055 },
      index === 0 ? 0.24 : step - 0.1,
    );
  }

  if (mapPins.length) {
    fromToIfTargets(
      masterTimeline,
      mapPins,
      { autoAlpha: 0, y: 26, scale: 0.88, filter: 'blur(4px)' },
      { autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.28, stagger: 0.08 },
      index === 0 ? 0.2 : step - 0.1,
    );
  }

  if (!isLast) {
    const exitAt = step + 0.74;

    toIfTargets(
      masterTimeline,
      toGsapTargets(scriptWords, titleWords),
      { autoAlpha: 0, y: -34, rotateX: 18, filter: 'blur(8px)', stagger: 0.004, duration: 0.3, ease: 'power2.in' },
      exitAt,
    );
    toIfTargets(
      masterTimeline,
      copyBlocks,
      { autoAlpha: 0, y: -26, scale: 0.992, filter: 'blur(4px)', stagger: 0.045, duration: 0.3, ease: 'power2.in' },
      exitAt + 0.02,
    );
    toIfTargets(
      masterTimeline,
      toGsapTargets(ui, staggerItems, mapPins),
      { autoAlpha: 0, y: -24, scale: 0.98, filter: 'blur(6px)', stagger: 0.018, duration: 0.28, ease: 'power2.in' },
      exitAt + 0.04,
    );
    toIfTargets(
      masterTimeline,
      visual,
      { autoAlpha: 0.22, y: -42, scale: 1.055, filter: 'blur(5px)', duration: 0.34, ease: 'power2.in' },
      exitAt + 0.04,
    );
    toIfTargets(masterTimeline, art, { autoAlpha: 0.1, x: -78, scale: 1.12, filter: 'blur(5px)', duration: 0.32, ease: 'power2.in' }, exitAt);
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
    if (scene.matches('.mana-scene--churches') && localProgress > 0.12 && scene.dataset.manaMapWoken !== 'true') {
      scene.dataset.manaMapWoken = 'true';
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
  });
}

function initManaStoryCode() {
  const story = document.querySelector('.mana-story-code');
  const scenes = gsap.utils.toArray('[data-mana-scene]');

  killExistingStoryTriggers();

  if (!story || !scenes.length) return;

  story.querySelectorAll('[data-mana-split]').forEach(splitText);
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
      scrub: 1.05,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      snap: {
        snapTo: 1 / Math.max(1, sceneCount - 1),
        duration: { min: 0.22, max: 0.55 },
        delay: 0.03,
        ease: 'power2.out',
      },
      onUpdate: ({ progress }) => updateSceneProgress(scenes, progress),
    },
  });

  scenes.forEach((scene, index) => addSceneMotion(masterTimeline, scene, index, sceneCount));

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
