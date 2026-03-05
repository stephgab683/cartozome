// =============================================
// POP-UP DE BIENVENUE
// =============================================
window.addEventListener('load', () => {
  const overlay = document.getElementById('welcome-overlay');
  const closeBtn = document.getElementById('welcome-close');

  if (!overlay || !closeBtn) return;

  overlay.style.display = 'flex'; // Affiche le pop-up

  closeBtn.addEventListener('click', () => {
      overlay.style.display = 'none'; // Cache le pop-up
  });
});

// =============================================
// POPUPS D'INFORMATION
// =============================================

// Créer le popup d'info s'il n'existe pas déjà
let infoPopup = document.getElementById('info-popup');
if (!infoPopup) {
  infoPopup = document.createElement('div');
  infoPopup.id = 'info-popup';
  infoPopup.innerHTML = `
    <div id="popup-inner">
        <button id="popup-close">✖</button>
        <div id="popup-content"></div>
    </div>
  `;
  document.body.appendChild(infoPopup);
}

const popupContent = document.getElementById('popup-content');
const popupClose = document.getElementById('popup-close');

// Fonction pour ouvrir la popup avec le contenu de la catégorie
function openInfoPopup(catId) {
  const contentEl = document.getElementById(`info-${catId}`);
  if (!contentEl) return;

  popupContent.innerHTML = contentEl.innerHTML; // injecte le texte
  infoPopup.classList.add('visible');
}

// Événement pour fermer la popup
popupClose.addEventListener('click', () => {
  infoPopup.classList.remove('visible');
});

// Clic sur les boutons ℹ️ des catégories
document.querySelectorAll('.info-btn').forEach(btn => {
  btn.addEventListener('click', e => {
      e.stopPropagation();
      const catId = btn.dataset.cat; // ex: "cat-air"
      openInfoPopup(catId);
  });
});