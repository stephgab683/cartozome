// =============================================
// POP-UP DE BIENVENUE
// =============================================
window.addEventListener('load', () => {                                       // Écouteur d'événement pour le chargement de la page
    const overlay = document.getElementById('welcome-overlay');                 // Récupère le pop-up de bienvenue
    const closeBtn = document.getElementById('welcome-close');                  // Récupère le bouton de fermeture
  
    if (!overlay || !closeBtn) return;

    overlay.style.display = 'flex';                                             // Affiche le pop-up
  
    closeBtn.addEventListener('click', () => {                                  // Écouteur pour fermer le pop-up
      overlay.style.display = 'none';                                           // Cache du pop-up
    });
});

// =============================================
// POPUPS D'INFORMATION
// =============================================

const popup = document.createElement('div');
popup.id = 'info-popup';
popup.innerHTML = `
  <div id="popup-box">
    <button id="popup-close">✕</button>
    <div id="popup-content"></div>
  </div>
`;
document.body.appendChild(popup);

const popupContent = document.getElementById('popup-content');
const popupClose = document.getElementById('popup-close');

document.querySelectorAll('.category-info-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();

    const catId = btn.dataset.cat;
    const contentEl = document.getElementById(`info-${catId}`);

    if (!contentEl) return;

    popupContent.innerHTML = contentEl.innerHTML;
    popup.classList.add('visible');
  });
});

popupClose.addEventListener('click', () => {
  popup.classList.remove('visible');
});
