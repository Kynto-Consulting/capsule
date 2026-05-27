document.addEventListener('DOMContentLoaded', () => {
  const p = document.createElement('p');
  p.textContent = `Deployed at: ${new Date().toISOString()}`;
  p.style.color = '#666';
  p.style.fontSize = '0.85rem';
  p.style.marginTop = '1rem';
  document.querySelector('.container').appendChild(p);
});
