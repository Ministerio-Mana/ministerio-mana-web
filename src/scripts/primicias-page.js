import { gsap } from 'gsap';

window.addEventListener('load', () => {
  gsap.from('#primicias-gateway', {
    y: 50,
    opacity: 0,
    duration: 1,
    ease: 'power3.out',
    delay: 0.2,
  });

  const starContainer = document.getElementById('gold-stars');
  if (starContainer) {
    for (let i = 0; i < 40; i += 1) {
      const star = document.createElement('div');
      const size = Math.random() * 3 + 1;
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.backgroundColor = '#FCD34D';
      star.style.position = 'absolute';
      star.style.borderRadius = '50%';
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      star.style.opacity = Math.random().toString();

      starContainer.appendChild(star);

      gsap.to(star, {
        y: -100,
        opacity: 0,
        duration: Math.random() * 10 + 5,
        repeat: -1,
        ease: 'none',
        delay: Math.random() * 10,
      });
    }
  }
});
