// =============================================
// PILL DE PRESENTATION
// =============================================

document.getElementById('pill-info').addEventListener('click', () => {
  document.getElementById('welcome-overlay').style.display = 'flex';
  document.getElementById('welcome-content').scrollTop = 0;
});

document.getElementById('pill-clb').addEventListener('click', () => {
  window.open('https://prevention.centreleonberard.fr/', '_blank');
});


// =============================================
// POP-UP DE BIENVENUE
// =============================================
window.addEventListener('load', () => {
  const overlay  = document.getElementById('welcome-overlay');
  const closeBtn = document.getElementById('welcome-close');

  if (!overlay || !closeBtn) return;

  overlay.style.display = 'flex';

  closeBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    document.getElementById('welcome-content').scrollTop = 0;
  });
});


// =============================================
// POPUPS D'INFORMATION
// =============================================

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

function openInfoPopup(catId) {
  const contentEl = document.getElementById(`info-${catId}`);
  if (!contentEl) return;
  popupContent.innerHTML = contentEl.innerHTML;
  infoPopup.classList.add('visible');
  setTimeout(() => { popupContent.scrollTop = 0; }, 0);
}

popupClose.addEventListener('click', () => {
  infoPopup.classList.remove('visible');
});

document.querySelectorAll('.info-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    openInfoPopup(btn.dataset.cat);
  });
});


// =============================================
// POPUP INFO ITINÉRAIRE
// =============================================
const btnInfoRoute = document.getElementById('btn-info-route');
if (btnInfoRoute) {
  btnInfoRoute.addEventListener('click', () => {
    const src = document.getElementById('info-route');
    if (!src) return;
    popupContent.innerHTML = src.innerHTML;
    infoPopup.classList.add('visible');
    setTimeout(() => { popupContent.scrollTop = 0; }, 0);
  });
}