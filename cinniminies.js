// ============================================
// CINNIMINIES: interacciones
// ============================================

document.addEventListener('DOMContentLoaded', () => {

  /* ---------- Menú mobile ---------- */
  const toggle = document.querySelector('.menu-toggle');
  const mobileNav = document.getElementById('mobileNav');
  if (toggle && mobileNav) {
    toggle.addEventListener('click', () => {
      const isOpen = mobileNav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen);
      toggle.classList.toggle('is-active', isOpen);
    });
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- Progress roll (indicador de scroll) ---------- */
  const progressRoll = document.querySelector('.progress-roll');
  const rollFill = document.querySelector('.roll-fill');
  const CIRC = 2 * Math.PI * 42; // ~264

  function updateProgress() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? scrollTop / docHeight : 0;

    if (rollFill) {
      rollFill.style.strokeDashoffset = CIRC - (CIRC * pct);
    }
    if (progressRoll) {
      progressRoll.classList.toggle('is-visible', scrollTop > 200);
    }
  }

  /* ---------- Bake meter: el rollo se hornea con el scroll ---------- */
  const bakeMeter = document.getElementById('bakeMeter');
  const bakeClipRect = document.getElementById('bakeClipRect');

  function updateBakeMeter() {
    if (!bakeMeter || !bakeClipRect) return;
    const rect = bakeMeter.getBoundingClientRect();
    const vh = window.innerHeight;

    // progreso: 0 cuando el elemento entra por abajo, 1 cuando llega arriba del todo
    const start = vh * 0.85;
    const end = vh * 0.15;
    let progress = (start - rect.top) / (start - end);
    progress = Math.max(0, Math.min(1, progress));

    // el clip-rect "sube" desde abajo, revelando la versión horneada
    const revealHeight = 320 * progress;
    bakeClipRect.setAttribute('y', 320 - revealHeight);
    bakeClipRect.setAttribute('height', revealHeight);
  }

  /* ---------- Scroll reveal genérico para los pasos del proceso ---------- */
  const revealEls = document.querySelectorAll('.proceso-step');
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.25 });
  revealEls.forEach(el => revealObserver.observe(el));

  /* ---------- Listener de scroll unificado (rAF throttle) ---------- */
  let ticking = false;
  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(() => {
        updateProgress();
        updateBakeMeter();
        ticking = false;
      });
      ticking = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  updateProgress();
  updateBakeMeter();

  /* ---------- Toast al "agregar al pedido" ---------- */
  const toastEl = document.getElementById('orderToast');
  let toastTimer = null;

  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('is-visible');
    }, 2200);
  }

  /* ==========================================================
     CARRITO POR CAJAS + CHECKOUT + ENVÍO DE PEDIDO
     Modelo: las cajas de 6 y 12 tienen precio fijo por caja completa.
     La caja "personalizada" admite entre 3 y 12 rolls, cobrados a
     $50 cada uno, y se considera completa con 3 o más unidades.
     ========================================================== */

  // ---- CONFIGURACIÓN: reemplazar con tu propia access key de Web3Forms ----
  // 1. Entrá a https://web3forms.com, registrate gratis con tu email.
  // 2. Te dan una "Access Key", pegala acá abajo.
  // 3. Cada pedido te va a llegar como email automático a la casilla con la que te registraste.
  // Nota de seguridad: este Access Key es público por diseño (no es una clave
  // secreta de API), Web3Forms lo documenta así explícitamente: solo permite
  // mandar emails a tu casilla, no da acceso a ninguna otra cosa. Es seguro
  // que viva en el código del front-end, como acá.
  const WEB3FORMS_PLACEHOLDER = "TU_ACCESS_KEY_DE_WEB3FORMS_AQUI";
  const WEB3FORMS_ACCESS_KEY = "37fd769c-9fca-4535-b7c7-dd4186dfce19";
  const WHATSAPP_NUMBER = "59895226739"; // tu número, con código de país, sin + ni espacios

  // ---- CONFIGURACIÓN: Google Sheets ----
  // Pegá acá la URL que te dio Google al "Implementar" el Apps Script
  // (mirá el archivo extras/google-sheets-apps-script.gs para los pasos).
  // Si la dejás vacía o con el valor de ejemplo, el sitio sigue funcionando
  // igual de bien por WhatsApp y Web3Forms, simplemente no anota en la hoja.
  const GOOGLE_SHEETS_PLACEHOLDER = "PEGAR_ACA_TU_URL_DE_APPS_SCRIPT";
  const GOOGLE_SHEETS_URL = "PEGAR_ACA_TU_URL_DE_APPS_SCRIPT";

  const BOX_PRICES = { 6: 250, 12: 450 };
  const CUSTOM_FLAVOR_PRICES = { canela: 50, dulce: 55, oreo: 60 };
  const CUSTOM_MIN = 3;
  const CUSTOM_MAX = 12;

  // cart: lista de cajas. Cada caja: { size, flavors: { canela: 2, dulce: 1, ... } }
  // size puede ser 6, 12, o 'custom' (caja personalizada de 3 a 12 unidades)
  let cart = [];

  function isCustomBox(box) {
    return box.size === 'custom';
  }

  function boxCap(box) {
    return isCustomBox(box) ? CUSTOM_MAX : box.size;
  }

  function boxFilled(box) {
    return Object.values(box.flavors).reduce((sum, n) => sum + n, 0);
  }

  function boxIsComplete(box) {
    const filled = boxFilled(box);
    return isCustomBox(box) ? filled >= CUSTOM_MIN : filled === box.size;
  }

  function customBoxPrice(box) {
    return Object.entries(box.flavors).reduce((sum, [flavorId, qty]) => {
      const unitPrice = CUSTOM_FLAVOR_PRICES[flavorId] || 0;
      return sum + qty * unitPrice;
    }, 0);
  }

  function boxPrice(box) {
    if (!boxIsComplete(box)) return 0;
    return isCustomBox(box) ? customBoxPrice(box) : BOX_PRICES[box.size];
  }

  function currentBox() {
    // la última caja que todavía no llegó a su tope
    const last = cart[cart.length - 1];
    if (last && boxFilled(last) < boxCap(last)) return last;
    return null;
  }

  function getSelectedBoxSize() {
    const activeBtn = document.querySelector('.box-option.is-active');
    if (!activeBtn) return 6;
    const qty = activeBtn.dataset.qty;
    return qty === 'custom' ? 'custom' : Number(qty);
  }

  function addToCart(flavorId, flavorName) {
    let box = currentBox();
    const selectedSize = getSelectedBoxSize();

    // si no hay caja abierta, o la caja abierta es de otro tamaño que el
    // que está seleccionado ahora, arrancamos una caja nueva
    if (!box || box.size !== selectedSize) {
      box = { size: selectedSize, flavors: {} };
      cart.push(box);
    }

    box.flavors[flavorId] = (box.flavors[flavorId] || 0) + 1;
    box._flavorNames = box._flavorNames || {};
    box._flavorNames[flavorId] = flavorName;

    renderCart();
    return box;
  }

  function removeFlavorFromBox(boxIndex, flavorId) {
    const box = cart[boxIndex];
    if (!box) return;
    box.flavors[flavorId] -= 1;
    if (box.flavors[flavorId] <= 0) delete box.flavors[flavorId];
    // si la caja queda vacía, la sacamos del carrito
    if (boxFilled(box) === 0) cart.splice(boxIndex, 1);
    renderCart();
  }

  function addFlavorToBox(boxIndex, flavorId) {
    const box = cart[boxIndex];
    if (!box) return;
    if (boxFilled(box) >= boxCap(box)) return; // no superar el tope de la caja
    box.flavors[flavorId] = (box.flavors[flavorId] || 0) + 1;
    renderCart();
  }

  function cartRollCount() {
    return cart.reduce((sum, box) => sum + boxFilled(box), 0);
  }

  function cartTotal() {
    return cart.reduce((sum, box) => sum + boxPrice(box), 0);
  }

  function cartHasIncompleteBox() {
    return cart.some(box => boxFilled(box) > 0 && !boxIsComplete(box));
  }

  const cartFab = document.getElementById('cartFab');
  const cartFabCount = document.getElementById('cartFabCount');
  const cartItemsEl = document.getElementById('cartItems');
  const cartSummaryEl = document.getElementById('cartSummary');
  const cartContinueBtn = document.getElementById('cartContinue');
  const boxProgressEl = document.getElementById('boxProgress');

  function updateBoxProgress() {
    if (!boxProgressEl) return;
    const box = currentBox();
    const selectedSize = getSelectedBoxSize();

    // solo mostramos progreso si hay una caja abierta del MISMO tamaño
    // que el seleccionado ahora arriba, para no confundir con otra caja
    if (!box || box.size !== selectedSize) {
      boxProgressEl.textContent = '';
      return;
    }

    const filled = boxFilled(box);
    if (isCustomBox(box)) {
      boxProgressEl.textContent = filled >= CUSTOM_MIN
        ? `Ya tenés ${filled} rolls en esta caja (de hasta ${CUSTOM_MAX})`
        : `Llevás ${filled} rolls, necesitás al menos ${CUSTOM_MIN}`;
    } else {
      boxProgressEl.textContent = `Llevás ${filled} de ${box.size} en esta caja`;
    }
  }

  function renderCart() {
    const rollCount = cartRollCount();
    if (cartFabCount) cartFabCount.textContent = rollCount;
    if (cartFab) cartFab.classList.toggle('is-visible', rollCount > 0);
    updateBoxProgress();

    if (!cartItemsEl) return;

    if (cart.length === 0) {
      cartItemsEl.innerHTML = '<p class="cart-empty">Todavía no agregaste rolls. Volvé al menú, elegí el tamaño de caja y sumá tus sabores.</p>';
      cartSummaryEl.innerHTML = '';
      if (cartContinueBtn) cartContinueBtn.disabled = true;
      return;
    }

    cartItemsEl.innerHTML = cart.map((box, boxIndex) => {
      const filled = boxFilled(box);
      const complete = boxIsComplete(box);
      const custom = isCustomBox(box);
      const cap = boxCap(box);

      const flavorRows = Object.entries(box.flavors).map(([id, qty]) => `
        <div class="cart-item" data-box="${boxIndex}" data-flavor="${id}">
          <div class="cart-item-info">
            <span class="cart-item-name">${box._flavorNames[id]}</span>
          </div>
          <div class="cart-item-qty">
            <button class="qty-btn" data-action="dec" data-box="${boxIndex}" data-flavor="${id}" type="button">&minus;</button>
            <span class="qty-value">${qty}</span>
            <button class="qty-btn" data-action="inc" data-box="${boxIndex}" data-flavor="${id}" type="button" ${filled >= cap ? 'disabled' : ''}>+</button>
          </div>
        </div>
      `).join('');

      const boxLabel = custom ? 'Caja personalizada' : `Caja de ${box.size}`;
      let fillLabel;
      if (custom) {
        fillLabel = complete
          ? `${filled}/${cap} · $${customBoxPrice(box)}`
          : `${filled}/${CUSTOM_MIN} mínimo`;
      } else {
        fillLabel = `${filled}/${box.size} ${complete ? '✓ completa' : 'falta completar'}`;
      }

      return `
        <div class="cart-box ${!complete ? 'is-incomplete' : ''}">
          <div class="cart-box-head">
            <span>${boxLabel}</span>
            <span class="cart-box-fill">${fillLabel}</span>
          </div>
          ${flavorRows}
        </div>
      `;
    }).join('');

    const rollLabel = rollCount === 1 ? 'roll' : 'rolls';
    cartSummaryEl.innerHTML = `
      <span>${rollCount} ${rollLabel} en ${cart.length} caja${cart.length > 1 ? 's' : ''}</span>
      <strong>$${cartTotal()}</strong>
    `;

    if (cartContinueBtn) {
      cartContinueBtn.disabled = cart.length === 0 || cartHasIncompleteBox();
      cartContinueBtn.textContent = cartHasIncompleteBox()
        ? 'Completá la caja para continuar'
        : 'Pedir ahora';
    }

    cartItemsEl.querySelectorAll('.qty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const boxIndex = Number(btn.dataset.box);
        const flavorId = btn.dataset.flavor;
        if (btn.dataset.action === 'inc') {
          addFlavorToBox(boxIndex, flavorId);
        } else {
          removeFlavorFromBox(boxIndex, flavorId);
        }
      });
    });
  }

  document.querySelectorAll('.roll-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const box = addToCart(btn.dataset.id, btn.dataset.name);
      const filled = boxFilled(box);

      const card = btn.closest('.roll-card');
      if (card) {
        card.classList.remove('is-added');
        // forzamos un reflow para que la animación se pueda re-disparar
        // aunque se haga click varias veces seguidas en la misma tarjeta
        void card.offsetWidth;
        card.classList.add('is-added');
        card.addEventListener('animationend', () => card.classList.remove('is-added'), { once: true });
      }

      if (isCustomBox(box)) {
        if (filled >= CUSTOM_MAX) {
          showToast(`¡Caja personalizada completa con ${filled} rolls!`);
        } else if (filled >= CUSTOM_MIN) {
          showToast(`${filled} rolls en tu caja, ya podés pedir o seguir sumando`);
        } else {
          showToast(`${filled}/${CUSTOM_MIN} mínimo en tu caja personalizada`);
        }
      } else if (filled === box.size) {
        showToast(`¡Caja de ${box.size} completa!`);
      } else {
        showToast(`${filled}/${box.size} en tu caja`);
      }
    });
  });

  /* ---------- Box picker ---------- */
  const boxOptions = document.querySelectorAll('.box-option');
  const boxPickerNote = document.getElementById('boxPickerNote');
  const flavorPriceEls = document.querySelectorAll('[data-flavor-price]');

  function updateFlavorPrices() {
    const isCustom = getSelectedBoxSize() === 'custom';
    flavorPriceEls.forEach(el => {
      if (isCustom) {
        const flavorId = el.dataset.flavorPrice;
        const price = CUSTOM_FLAVOR_PRICES[flavorId] ?? '';
        el.textContent = `Precio: $${price} c/u`;
      } else {
        el.textContent = 'Precio: Incluido en la caja';
      }
    });
  }

  boxOptions.forEach(btn => {
    btn.addEventListener('click', () => {
      boxOptions.forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      if (boxPickerNote) {
        boxPickerNote.textContent = btn.dataset.qty === 'custom'
          ? `Sumá entre ${CUSTOM_MIN} y ${CUSTOM_MAX} rolls de los sabores que quieras. Cada sabor tiene su propio precio: mirá el detalle en cada tarjeta.`
          : 'Ahora sumá los sabores que quieras de la lista de abajo hasta completar tu caja.';
      }
      updateFlavorPrices();
      updateBoxProgress();
    });
  });
  updateFlavorPrices();
  updateBoxProgress();

  /* ---------- Generador de ID de pedido ---------- */
  function generateOrderId() {
    const year = new Date().getFullYear();
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `CM-${year}-${rand}`;
  }

  /* ---------- Apertura/cierre del modal ---------- */
  const cartModal = document.getElementById('cartModal');
  const stepCart = document.getElementById('stepCart');
  const stepForm = document.getElementById('stepForm');
  const stepDone = document.getElementById('stepDone');

  function openModal() {
    cartModal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    cartModal.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  function goToStep(step) {
    [stepCart, stepForm, stepDone].forEach(s => s.classList.add('is-hidden'));
    step.classList.remove('is-hidden');
  }

  if (cartFab) cartFab.addEventListener('click', () => { goToStep(stepCart); openModal(); });
  document.getElementById('cartClose')?.addEventListener('click', closeModal);
  document.getElementById('formClose')?.addEventListener('click', closeModal);
  document.getElementById('doneClose')?.addEventListener('click', closeModal);
  document.getElementById('cartBackdrop')?.addEventListener('click', closeModal);

  cartContinueBtn?.addEventListener('click', () => {
    if (cartHasIncompleteBox()) return;
    goToStep(stepForm);
  });

  /* ---------- Envío del formulario ---------- */
  const formError = document.getElementById('formError');

  stepForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';

    const nombre = stepForm.nombre.value.trim();
    const telefono = stepForm.telefono.value.trim();
    const modalidad = stepForm.modalidad.value;
    const notas = stepForm.notas.value.trim();

    if (!nombre || !telefono) {
      formError.textContent = 'Completá nombre y WhatsApp para continuar.';
      return;
    }
    if (cart.length === 0) {
      formError.textContent = 'Tu carrito está vacío.';
      return;
    }
    if (cartHasIncompleteBox()) {
      formError.textContent = 'Tenés una caja sin completar. Volvé y sumá los sabores que falten.';
      return;
    }

    const orderId = generateOrderId();

    const detailLines = cart.map((box, i) => {
      const flavorList = Object.entries(box.flavors)
        .map(([id, qty]) => `${qty}x ${box._flavorNames[id]}`)
        .join(', ');
      const filled = boxFilled(box);
      const boxLabel = isCustomBox(box)
        ? `Caja personalizada de ${filled} rolls, $${boxPrice(box)}`
        : `Caja de ${box.size} rollos, $${boxPrice(box)}`;
      return `- ${boxLabel}: ${flavorList}`;
    }).join('\n');

    const total = cartTotal();

    const fullDetail = [
      `Pedido: ${orderId}`,
      `Cliente: ${nombre}`,
      `WhatsApp: ${telefono}`,
      `Modalidad: ${modalidad}`,
      detailLines,
      `Total: $${total}`,
      notas ? `Notas: ${notas}` : ''
    ].filter(Boolean).join('\n');

    // Armar el link de WhatsApp con todo prearmado
    const waMessage = encodeURIComponent(
      `¡Hola! Quiero confirmar mi pedido ${orderId} en Cinniminies:\n\n${detailLines}\n\nTotal: $${total}\nModalidad: ${modalidad}\nNombre: ${nombre}${notas ? `\nNotas: ${notas}` : ''}`
    );
    const waLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${waMessage}`;

    document.getElementById('orderIdDisplay').textContent = orderId;
    document.getElementById('doneWhatsapp').href = waLink;

    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirmar pedido';

    goToStep(stepDone);

    // limpiar carrito para el próximo pedido
    cart = [];
    renderCart();
    stepForm.reset();
  });

});
