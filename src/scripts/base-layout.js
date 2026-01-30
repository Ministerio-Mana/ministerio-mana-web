import Lenis from '@studio-freight/lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let lenis;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!prefersReducedMotion) {
  lenis = new Lenis({
    duration: 0.5, // snappy response
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation: 'vertical',
    gestureOrientation: 'vertical',
    smoothWheel: true,
    wheelMultiplier: 1,
    smoothTouch: false,
    touchMultiplier: 2,
    infinite: false,
  });

  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }

  requestAnimationFrame(raf);
  window.lenis = lenis;
}

document.documentElement.setAttribute('data-lenis-enabled', String(!prefersReducedMotion));

// Home parallax animations
window.addEventListener('load', () => {
  if (prefersReducedMotion) return;

  const hero = document.querySelector('[data-hero]');
  if (hero) {
    gsap.to(hero, {
      scrollTrigger: {
        trigger: hero,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
      y: 100,
      opacity: 0.6,
    });
  }

  document.querySelectorAll('[data-parallax-bg]').forEach((el) => {
    const speed = parseFloat(el.dataset.bg) || 0.5;
    gsap.to(el, {
      scrollTrigger: {
        trigger: el,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
      y: -50 * speed,
    });
  });
});
