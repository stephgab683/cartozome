// =============================================
// POP-UP DE BIENVENUE
// Affichée automatiquement au chargement de
// la page. Fermée au clic sur le bouton ✖.
// =============================================
window.addEventListener('load', () => {
  const overlay  = document.getElementById('welcome-overlay');
  const closeBtn = document.getElementById('welcome-close');

  if (!overlay || !closeBtn) return;

  overlay.style.display = 'flex'; // Rend la popup visible (display:none par défaut dans le HTML)

  closeBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
  });
});

// =============================================
// POPUPS D'INFORMATION
// Créées dynamiquement si absentes du DOM.
// Leur contenu est injecté depuis les divs
// cachées dans #info-contents (voir index.html)
// au clic sur un bouton ℹ de catégorie.
// =============================================

// Crée le conteneur de la popup si absent du DOM
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
const popupClose   = document.getElementById('popup-close');

// Injecte le contenu de la catégorie dans la popup et l'affiche
// catId correspond à data-cat sur le bouton ℹ, ex: "cat-air"
// Le contenu source est dans <div id="info-cat-air"> dans le HTML
function openInfoPopup(catId) {
  const contentEl = document.getElementById(`info-${catId}`);
  if (!contentEl) return;

  popupContent.innerHTML = contentEl.innerHTML;
  infoPopup.classList.add('visible');
}

// Ferme la popup au clic sur la croix
popupClose.addEventListener('click', () => {
  infoPopup.classList.remove('visible');
});

// Branche chaque bouton ℹ sur la popup correspondante
// stopPropagation évite que le clic remonte jusqu'à l'accordéon
document.querySelectorAll('.info-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const catId = btn.dataset.cat; // ex: "cat-air"
    openInfoPopup(catId);
  });
});