/* Zugangsseite */

(function () {
  const form  = document.getElementById('pwForm');
  const input = document.getElementById('pw');
  const error = document.getElementById('gateError');

  input.focus();

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    if (input.value === CONFIG.password) {
      sessionStorage.setItem('peaq-auth', '1');
      location.href = 'dashboard.html';
      return;
    }

    error.textContent = 'ZUGANG VERWEIGERT';
    form.classList.remove('shake');
    void form.offsetWidth;          // Reflow erzwingen, damit die Animation neu startet
    form.classList.add('shake');
    input.select();
  });

  input.addEventListener('input', () => { error.textContent = ''; });
})();
