// GSAP ScrollTrigger Animations - Applied to EXISTING components
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Sync Lenis with ScrollTrigger
if (window.lenis) {
    window.lenis.on('scroll', ScrollTrigger.update);

    gsap.ticker.add((time) => {
        window.lenis.raf(time * 1000);
    });

    gsap.ticker.lagSmoothing(0);
}

// Check for reduced motion
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!prefersReducedMotion) {
    // Wait for DOM to be ready
    window.addEventListener('DOMContentLoaded', () => {

        // Hero section parallax (if exists)
        const heroSection = document.querySelector('[data-hero]');
        if (heroSection) {
            const heroTitle = heroSection.querySelector('h1');
            const heroSubtitle = heroSection.querySelector('p');
            const heroCta = heroSection.querySelector('.hero-cta, a');

            if (heroTitle) {
                gsap.to(heroTitle, {
                    yPercent: 30,
                    opacity: 0.5,
                    ease: 'none',
                    scrollTrigger: {
                        trigger: heroSection,
                        start: 'top top',
                        end: 'bottom top',
                        scrub: 1,
                    },
                });
            }

            if (heroSubtitle) {
                gsap.to(heroSubtitle, {
                    yPercent: 20,
                    opacity: 0.3,
                    ease: 'none',
                    scrollTrigger: {
                        trigger: heroSection,
                        start: 'top top',
                        end: 'bottom top',
                        scrub: 1,
                    },
                });
            }
        }

        // Parallax for section backgrounds
        const sectionsWithBg = document.querySelectorAll('[data-parallax-bg]');
        sectionsWithBg.forEach((section) => {
            const bg = section.querySelector('.bg-image, .background, [data-bg]');
            if (bg) {
                gsap.to(bg, {
                    yPercent: -15,
                    ease: 'none',
                    scrollTrigger: {
                        trigger: section,
                        start: 'top bottom',
                        end: 'bottom top',
                        scrub: true,
                    },
                });
            }
        });

        // Fade in elements on scroll
        const fadeElements = document.querySelectorAll('[data-fade], .fade-in');
        fadeElements.forEach((el) => {
            gsap.from(el, {
                y: 40,
                opacity: 0,
                duration: 0.8,
                ease: 'power2.out',
                scrollTrigger: {
                    trigger: el,
                    start: 'top 85%',
                    end: 'top 60%',
                    toggleActions: 'play none none reverse',
                },
            });
        });

        // Stagger animations for lists/grids
        const staggerContainers = document.querySelectorAll('[data-stagger]');
        staggerContainers.forEach((container) => {
            const items = container.children;
            if (items.length > 0) {
                gsap.from(items, {
                    y: 30,
                    opacity: 0,
                    duration: 0.6,
                    stagger: 0.1,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: container,
                        start: 'top 80%',
                        toggleActions: 'play none none reverse',
                    },
                });
            }
        });

        // Scale on scroll for images
        const scaleImages = document.querySelectorAll('[data-scale]');
        scaleImages.forEach((img) => {
            gsap.from(img, {
                scale: 1.15,
                duration: 1.2,
                ease: 'power2.out',
                scrollTrigger: {
                    trigger: img,
                    start: 'top 80%',
                    end: 'top 40%',
                    scrub: 1,
                },
            });
        });
    });
}
