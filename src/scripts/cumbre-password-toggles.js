// Password Toggle Functionality for Cumbre Registration Form
export function initPasswordToggles() {
    // Toggle for password field
    const pwdToggle = document.getElementById('leader-password-toggle');
    const pwdInput = document.getElementById('leader-password');

    if (pwdToggle && pwdInput) {
        pwdToggle.addEventListener('click', () => {
            const isPassword = pwdInput.type === 'password';
            pwdInput.type = isPassword ? 'text' : 'password';
            pwdToggle.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
        });
    }

    // Toggle for confirm password field
    const pwdConfirmToggle = document.getElementById('leader-password-confirm-toggle');
    const pwdConfirmInput = document.getElementById('leader-password-confirm');

    if (pwdConfirmToggle && pwdConfirmInput) {
        pwdConfirmToggle.addEventListener('click', () => {
            const isPassword = pwdConfirmInput.type === 'password';
            pwdConfirmInput.type = isPassword ? 'text' : 'password';
            pwdConfirmToggle.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
        });
    }
}

// Auto-init when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPasswordToggles);
} else {
    initPasswordToggles();
}
