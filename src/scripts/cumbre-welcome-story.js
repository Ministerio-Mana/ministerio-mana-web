import Lenis from '@studio-freight/lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { mobileRevealDelay, shouldUseStaticStory } from '../lib/storyMotion.ts';

gsap.registerPlugin(ScrollTrigger);

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let viewportCleanup = null;
let modeCleanup = null;
let staticRevealCleanup = null;

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

function cleanupPreviousStory() {
  if (window.__cumbreWelcomeCleanup) {
    window.__cumbreWelcomeCleanup();
    window.__cumbreWelcomeCleanup = null;
  }
  viewportCleanup?.();
  modeCleanup?.();
  staticRevealCleanup?.();
  modeCleanup = null;
  staticRevealCleanup = null;
  document.documentElement.removeAttribute('data-cumbre-static-story');
  document.querySelectorAll('[data-cumbre-story]').forEach((story) => {
    delete story.dataset.cumbreStaticActive;
  });
}

function setupLenis() {
  if (window.__cumbreWelcomeLenis?.destroy) {
    window.__cumbreWelcomeLenis.destroy();
  }

  if (window.__cumbreWelcomeTicker) {
    gsap.ticker.remove(window.__cumbreWelcomeTicker);
  }

  const lenis = new Lenis({
    duration: 0.92,
    easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)),
    orientation: 'vertical',
    gestureOrientation: 'vertical',
    smoothWheel: true,
    wheelMultiplier: 0.86,
    smoothTouch: false,
    touchMultiplier: 1.1,
    infinite: false,
  });

  lenis.on('scroll', ScrollTrigger.update);

  const ticker = (time) => {
    lenis.raf(time * 1000);
  };

  gsap.ticker.add(ticker);
  gsap.ticker.lagSmoothing(0);

  window.__cumbreWelcomeLenis = lenis;
  window.__cumbreWelcomeTicker = ticker;
  window.lenis = lenis;
  document.documentElement.dataset.cumbreLenis = 'true';

  return lenis;
}

function splitTitle(title) {
  if (title.dataset.splitPrepared === 'true') return;

  const words = title.textContent.trim().split(/\s+/).filter(Boolean);
  title.dataset.splitPrepared = 'true';
  title.setAttribute('aria-label', words.join(' '));
  title.textContent = '';

  words.forEach((word, index) => {
    const wrap = document.createElement('span');
    const inner = document.createElement('span');

    wrap.className = 'split-word';
    wrap.setAttribute('aria-hidden', 'true');
    inner.textContent = word;

    wrap.append(inner);
    title.append(wrap);

    if (index < words.length - 1) {
      title.append(document.createTextNode(' '));
    }
  });
}

function setActiveTheme(panel) {
  document.documentElement.dataset.cumbrePanelTheme = panel?.dataset?.panelTheme || 'dark';
}

function getViewportHeight() {
  return Math.round(window.visualViewport?.height || window.innerHeight || 1);
}

function getScrollFactor(story) {
  const breakpoint = Number.parseInt(story.dataset.cumbreScrollFactorBreakpoint || '768', 10);
  return window.innerWidth >= breakpoint ? 1.34 : 1;
}

function getBooleanData(value, fallback = true) {
  if (value === 'false') return false;
  if (value === 'true') return true;
  return fallback;
}

function syncViewportHeight() {
  document.documentElement.style.setProperty('--cumbre-vh', `${getViewportHeight()}px`);
}

function setupViewportHeightSync() {
  viewportCleanup?.();
  syncViewportHeight();
  let lastHeight = getViewportHeight();
  let refreshFrame = 0;

  const refresh = () => {
    if (refreshFrame) return;
    refreshFrame = window.requestAnimationFrame(() => {
      refreshFrame = 0;
      const nextHeight = getViewportHeight();
      if (nextHeight === lastHeight) return;
      lastHeight = nextHeight;
      syncViewportHeight();
      ScrollTrigger.refresh();
    });
  };

  window.addEventListener('resize', refresh);
  window.addEventListener('orientationchange', refresh);
  window.visualViewport?.addEventListener('resize', refresh);

  viewportCleanup = () => {
    if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
    window.removeEventListener('resize', refresh);
    window.removeEventListener('orientationchange', refresh);
    window.visualViewport?.removeEventListener('resize', refresh);
    viewportCleanup = null;
  };
}

function setupModeChangeWatcher(staticBreakpoint) {
  modeCleanup?.();

  const breakpointQuery = window.matchMedia(`(max-width: ${Math.max(0, staticBreakpoint - 1)}px)`);
  const handleModeChange = () => {
    setupStory();
  };

  breakpointQuery.addEventListener('change', handleModeChange);
  reducedMotionQuery.addEventListener('change', handleModeChange);
  modeCleanup = () => {
    breakpointQuery.removeEventListener('change', handleModeChange);
    reducedMotionQuery.removeEventListener('change', handleModeChange);
    modeCleanup = null;
  };
}

function clearAnimatedStyles(element) {
  ['clip-path', 'filter', 'opacity', 'transform', 'visibility'].forEach((property) => {
    element.style.removeProperty(property);
  });
}

function revealStaticPanels(panels) {
  panels.forEach((panel, index) => {
    panel.classList.add('is-visible', 'is-active');
    panel.style.zIndex = String(index + 1);
    clearAnimatedStyles(panel);
    panel.querySelectorAll('[data-split-title] .split-word > span, [data-reveal]:not([data-split-title])').forEach((element) => {
      clearAnimatedStyles(element);
    });
  });
  setActiveTheme(panels[0]);
}

function setupStaticReveals(panels) {
  staticRevealCleanup?.();
  const targets = panels.flatMap((panel) =>
    Array.from(panel.querySelectorAll('[data-mobile-reveal-group] [data-reveal], [data-mobile-reveal-group] [data-split-title]'))
  );

  if (reducedMotionQuery.matches || !('IntersectionObserver' in window)) {
    targets.forEach((target) => {
      target.dataset.mobileReveal = 'visible';
    });
    staticRevealCleanup = () => {
      targets.forEach((target) => delete target.dataset.mobileReveal);
      staticRevealCleanup = null;
    };
    return;
  }

  panels.forEach((panel) => {
    const panelTargets = Array.from(panel.querySelectorAll('[data-mobile-reveal-group] [data-reveal], [data-mobile-reveal-group] [data-split-title]'));
    panelTargets.forEach((target, index) => {
      target.dataset.mobileReveal = 'pending';
      target.style.setProperty('--mobile-reveal-delay', mobileRevealDelay(index));
    });
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.dataset.mobileReveal = 'visible';
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  targets.forEach((target) => observer.observe(target));
  staticRevealCleanup = () => {
    observer.disconnect();
    targets.forEach((target) => {
      delete target.dataset.mobileReveal;
      target.style.removeProperty('--mobile-reveal-delay');
    });
    staticRevealCleanup = null;
  };
}

function setupPanelInitialState(panel, index) {
  panel.querySelectorAll('[data-split-title]').forEach(splitTitle);
  panel.style.zIndex = String(index + 1);
  panel.classList.toggle('is-active', index === 0);
  panel.classList.toggle('is-visible', index === 0);

  gsap.set(panel, {
    clipPath: index === 0 ? 'inset(0% 0% 0% 0%)' : 'inset(100% 0% 0% 0%)',
  });

  gsap.set(panel.querySelectorAll('[data-split-title] .split-word > span'), {
    autoAlpha: index === 0 ? 1 : 0,
    y: index === 0 ? 0 : 54,
    rotateX: index === 0 ? 0 : -22,
    scale: index === 0 ? 1 : 0.96,
    filter: index === 0 ? 'blur(0px)' : 'blur(5px)',
    transformOrigin: '50% 90%',
  });

  gsap.set(panel.querySelectorAll('[data-reveal]:not([data-split-title])'), {
    autoAlpha: index === 0 ? 1 : 0,
    y: index === 0 ? 0 : 38,
    scale: index === 0 ? 1 : 0.985,
    filter: index === 0 ? 'blur(0px)' : 'blur(6px)',
  });
}

function addContentEntrance(timeline, panel, at) {
  const titleWords = panel.querySelectorAll('[data-split-title] .split-word > span');
  const revealItems = panel.querySelectorAll('[data-reveal]:not([data-split-title])');

  timeline.to(
    titleWords,
    {
      autoAlpha: 1,
      y: 0,
      rotateX: 0,
      scale: 1,
      filter: 'blur(0px)',
      duration: 0.42,
      ease: 'power3.out',
      stagger: 0.025,
    },
    at
  );

  timeline.to(
    revealItems,
    {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      filter: 'blur(0px)',
      duration: 0.44,
      ease: 'power3.out',
      stagger: 0.055,
    },
    at + 0.1
  );
}

function addContentExit(timeline, panel, at) {
  const titleWords = panel.querySelectorAll('[data-split-title] .split-word > span');
  const revealItems = panel.querySelectorAll('[data-reveal]:not([data-split-title])');
  const bg = panel.querySelector('[data-panel-bg]');

  timeline.to(
    [titleWords, revealItems],
    {
      autoAlpha: 0,
      y: -24,
      rotateX: 12,
      scale: 0.992,
      filter: 'blur(5px)',
      duration: 0.3,
      ease: 'power2.in',
      stagger: 0.012,
    },
    at
  );

  if (bg) {
    timeline.to(
      bg,
      {
        scale: 1.045,
        yPercent: -2.5,
        opacity: 0.84,
        duration: 0.36,
        ease: 'power1.inOut',
      },
      at
    );
  }
}

function setupStory() {
  cleanupPreviousStory();

  const story = document.querySelector('[data-cumbre-story]');
  const panels = Array.from(document.querySelectorAll('[data-cumbre-panel]'));
  if (!story || !panels.length) return;

  document.documentElement.dataset.cumbreWelcomeStory = 'true';
  story.style.setProperty('--panel-count', String(panels.length));

  const staticBreakpoint = Number.parseInt(story.dataset.cumbreStaticBreakpoint || '768', 10);
  setupModeChangeWatcher(staticBreakpoint);

  const useStaticPanels = shouldUseStaticStory({
    reducedMotion: reducedMotionQuery.matches,
    staticMobile: story.dataset.cumbreStaticMobile === 'true',
    viewportWidth: window.innerWidth,
    staticBreakpoint,
  });

  if (useStaticPanels) {
    document.documentElement.style.removeProperty('--cumbre-vh');
    story.dataset.cumbreStaticActive = 'true';
    document.documentElement.dataset.cumbreStaticStory = 'true';
    revealStaticPanels(panels);
    setupStaticReveals(panels);
    window.__cumbreWelcomeCleanup = () => {
      modeCleanup?.();
      viewportCleanup?.();
      staticRevealCleanup?.();
      document.documentElement.removeAttribute('data-cumbre-welcome-story');
      document.documentElement.removeAttribute('data-cumbre-static-story');
      document.documentElement.style.removeProperty('--cumbre-vh');
      delete story.dataset.cumbreStaticActive;
    };
    return;
  }

  delete story.dataset.cumbreStaticActive;
  document.documentElement.removeAttribute('data-cumbre-static-story');

  setupViewportHeightSync();
  const lenis = setupLenis();
  const lastIndex = panels.length - 1;
  const snapDirectional = getBooleanData(story.dataset.cumbreSnapDirectional, true);
  const snapInertia = getBooleanData(story.dataset.cumbreSnapInertia, true);
  const context = gsap.context(() => {
    panels.forEach(setupPanelInitialState);

    const timeline = gsap.timeline({
      defaults: { overwrite: 'auto' },
      scrollTrigger: {
        id: 'cumbre-welcome-story',
        trigger: story,
        start: 'top top',
        end: () => {
          return `+=${getViewportHeight() * lastIndex * getScrollFactor(story)}`;
        },
        pin: true,
        scrub: 1.05,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        snap: {
          snapTo: (value) => Math.round(value * lastIndex) / lastIndex,
          duration: { min: 0.18, max: 0.42 },
          delay: 0.07,
          ease: 'power1.inOut',
          directional: snapDirectional,
          inertia: snapInertia,
        },
        onUpdate: (self) => {
          const activeIndex = Math.min(lastIndex, Math.max(0, Math.round(self.progress * lastIndex)));
          panels.forEach((panel, index) => {
            panel.classList.toggle('is-active', index === activeIndex);
            panel.classList.toggle('is-visible', index <= activeIndex + 1);
          });
          setActiveTheme(panels[activeIndex]);
        },
      },
    });

    panels.forEach((panel, index) => {
      const bg = panel.querySelector('[data-panel-bg]');
      const enterAt = index === 0 ? 0.04 : index - 0.58;

      if (index > 0) {
        timeline.to(
          panel,
          {
            clipPath: 'inset(0% 0% 0% 0%)',
            duration: 0.56,
            ease: 'power2.inOut',
          },
          index - 0.74
        );
      }

      if (bg) {
        timeline.fromTo(
          bg,
          { scale: 1.04, yPercent: 1.5, opacity: 1 },
          { scale: 1, yPercent: 0, opacity: 1, duration: 0.8, ease: 'none' },
          Math.max(0, index - 0.72)
        );
      }

      if (index > 0) {
        addContentEntrance(timeline, panel, enterAt);
      }

      if (index < lastIndex) {
        addContentExit(timeline, panel, index + 0.68);
      }
    });

    timeline.to({}, { duration: 0.38 });
    setActiveTheme(panels[0]);
  }, story);

  window.scrollTo(0, 0);
  lenis?.scrollTo?.(0, { immediate: true, force: true });
  ScrollTrigger.refresh();

  window.__cumbreWelcomeCleanup = () => {
    context.revert();
    modeCleanup?.();
    if (window.__cumbreWelcomeLenis?.destroy) {
      window.__cumbreWelcomeLenis.destroy();
      window.__cumbreWelcomeLenis = null;
    }
    if (window.__cumbreWelcomeTicker) {
      gsap.ticker.remove(window.__cumbreWelcomeTicker);
      window.__cumbreWelcomeTicker = null;
    }
    viewportCleanup?.();
    document.documentElement.removeAttribute('data-cumbre-lenis');
    document.documentElement.removeAttribute('data-cumbre-welcome-story');
    document.documentElement.removeAttribute('data-cumbre-static-story');
    document.documentElement.style.removeProperty('--cumbre-vh');
    delete story.dataset.cumbreStaticActive;
  };
}

document.addEventListener('astro:page-load', setupStory);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupStory, { once: true });
} else {
  setupStory();
}
