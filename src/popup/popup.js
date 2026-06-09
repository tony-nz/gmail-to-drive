document.addEventListener('DOMContentLoaded', () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const btnSignIn = document.getElementById('btn-sign-in');
  const btnSignOut = document.getElementById('btn-sign-out');
  const btnOptions = document.getElementById('btn-options');

  checkAuthStatus();

  btnSignIn.addEventListener('click', () => {
    btnSignIn.disabled = true;
    btnSignIn.textContent = 'Signing in...';

    chrome.runtime.sendMessage({ action: 'SIGN_IN' }, (response) => {
      if (response?.success) {
        setConnected();
      } else {
        btnSignIn.disabled = false;
        btnSignIn.textContent = 'Sign In with Google';
        statusText.textContent = response?.error || 'Sign in failed';
      }
    });
  });

  btnSignOut.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'SIGN_OUT' }, () => {
      setDisconnected();
    });
  });

  btnOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  function checkAuthStatus() {
    chrome.runtime.sendMessage({ action: 'GET_AUTH_STATUS' }, (response) => {
      if (response?.authenticated) {
        setConnected();
      } else {
        setDisconnected();
      }
    });
  }

  function setConnected() {
    statusDot.className = 'dot dot-connected';
    statusText.textContent = 'Connected';
    btnSignIn.style.display = 'none';
    btnSignOut.style.display = 'block';
  }

  function setDisconnected() {
    statusDot.className = 'dot dot-disconnected';
    statusText.textContent = 'Not connected';
    btnSignIn.style.display = 'block';
    btnSignIn.disabled = false;
    btnSignIn.textContent = 'Sign In with Google';
    btnSignOut.style.display = 'none';
  }
});
