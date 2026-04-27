import { annotate } from 'rough-notation';

function initAnnotations() {
    function animateOnScroll(element, annotation) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    annotation.show();
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.3 });
        observer.observe(element);
    }

    // Circle around "apasionada" — hand-drawn scribble circle like reference "Agenda"
    const apasionada = document.getElementById('rn-apasionada');
    if (apasionada) {
        const an = annotate(apasionada, {
            type: 'circle',
            color: '#2DD4BF',
            strokeWidth: 2,
            padding: 10,
            iterations: 2,
            animationDuration: 1500
        });
        animateOnScroll(apasionada, an);
    }

    // Underline "estratégico" in the quote — wavy hand-drawn underline
    const estrategico = document.getElementById('rn-estrategico');
    if (estrategico) {
        const an = annotate(estrategico, {
            type: 'underline',
            color: '#001B3A',
            strokeWidth: 3,
            padding: 2,
            iterations: 2,
            animationDuration: 1200
        });
        animateOnScroll(estrategico, an);
    }

    // Circle around "líderes"
    const lideres = document.getElementById('rn-lideres');
    if (lideres) {
        const an = annotate(lideres, {
            type: 'circle',
            color: '#2DD4BF',
            strokeWidth: 2,
            padding: 6,
            iterations: 2,
            animationDuration: 1200
        });
        animateOnScroll(lideres, an);
    }

    // Circle around "mundo"
    const mundo = document.getElementById('rn-mundo');
    if (mundo) {
        const an = annotate(mundo, {
            type: 'circle',
            color: '#2DD4BF',
            strokeWidth: 2,
            padding: 6,
            iterations: 2,
            animationDuration: 1200
        });
        animateOnScroll(mundo, an);
    }
}

// Handle both initial load and Astro page transitions
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initAnnotations, 300));
} else {
    setTimeout(initAnnotations, 300);
}
document.addEventListener('astro:page-load', () => setTimeout(initAnnotations, 300));
