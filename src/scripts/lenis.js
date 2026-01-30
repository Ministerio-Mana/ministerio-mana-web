// Lenis Smooth Scroll initialization
import Lenis from '@studio-freight/lenis';

let lenis;

// Check for reduced motion preference
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!prefersReducedMotion) {
    lenis = new Lenis({
        duration: 1.2,
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

    // Export for GSAP integration
    window.lenis = lenis;
}

// Add data attribute to html for CSS hooks
document.documentElement.setAttribute('data-lenis-enabled', !prefersReducedMotion);
