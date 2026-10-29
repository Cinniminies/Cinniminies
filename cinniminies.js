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
        // Sin esto el ícono queda como "X" aunque el menú ya se cerró
        toggle.classList.remove('is-active');
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
  revealEls.forEach(nodo => revealObserver.observe(nodo));

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
     Modelo: las cajas fijas (6 y 12) tienen precio por caja completa.
     La caja "personalizada" admite entre CUSTOM_MIN y CUSTOM_MAX rolls,
     cada uno al precio por unidad de su sabor, y está completa desde el
     mínimo. Precios y límites salen del catálogo (/api/catalogo).
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
  // tu número, con código de país, sin + ni espacios. Se puede cambiar desde /admin → Web (contacto.whatsapp).
  let WHATSAPP_NUMBER = "59898029462";

  // Precios y límites. Estos valores son el RESPALDO: al cargar, la página pide el catálogo a
  // /api/catalogo (lo que se carga en /admin) y los reemplaza. Si la API falla, quedan estos y las
  // tarjetas escritas en index.html, así la web nunca se queda sin menú.
  const BOX_PRICES = { 6: 250, 12: 450 };
  let PRECIO_ENVIO = 25; // con entrega se suma al total (parámetro precio_envio, viene en /api/catalogo)
  const CUSTOM_FLAVOR_PRICES = { canela: 50, dulce: 55, oreo: 60, nutella: 65 };
  let CUSTOM_MIN = 3;
  let CUSTOM_MAX = 12;
  // Promos de hoy (/admin → Promociones), vienen en /api/catalogo. Cada una: { nombre, tipo: 'porcentaje' | 'monto',
  // valor, texto, formatos: [{ tipo, rolls }], sabores: [slug] } (vacíos = todos). La cuenta final la hace la base.
  let PROMOS = [];

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

  // ¿La promo es para este tamaño de caja? (6, 12 o 'custom')
  function promoParaTamano(p, size) {
    if (!p.formatos.length) return true;
    return p.formatos.some(f => size === 'custom' ? f.tipo === 'personalizado' : f.tipo === 'caja_fija' && f.rolls === size);
  }

  // La promo que más descuenta en una caja completa, como privado.promo_de_linea: % o monto por caja, en
  // proporción a los rolls de los sabores de la promo (3 de canela en una de 6 = la mitad). No se suman.
  function promoDeCaja(box, promos = PROMOS) {
    const precio = boxPrice(box);
    const filled = boxFilled(box);
    if (!precio || !filled) return null;
    let mejor = null;
    for (const p of promos) {
      if (!promoParaTamano(p, box.size)) continue;
      const rolls = p.sabores.length
        ? Object.entries(box.flavors).reduce((n, [id, qty]) => n + (p.sabores.includes(id) ? qty : 0), 0)
        : filled;
      const base = p.tipo === 'porcentaje' ? precio * p.valor / 100 : p.valor;
      // toFixed: que 16,65 no quede en 16,6499… por los decimales de JavaScript y redondee distinto que la base
      const monto = Math.min(precio, Math.round(Number((base * rolls / filled).toFixed(6))));
      if (monto > 0 && (!mejor || monto > mejor.monto)) mejor = { nombre: p.nombre, monto };
    }
    return mejor;
  }

  function cartPromo() {
    return cart.reduce((sum, box) => sum + (promoDeCaja(box)?.monto || 0), 0);
  }

  function cartList() {
    return cart.reduce((sum, box) => sum + boxPrice(box), 0);
  }

  // Lo que se paga por las cajas, ya con las promos
  function cartTotal() {
    return cartList() - cartPromo();
  }

  // "−6,66 %" o "−$50"
  function etiquetaPromo(p) {
    return p.tipo === 'porcentaje' ? `−${String(p.valor).replace('.', ',')} %` : `−$${p.valor}`;
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
  const submitBtn = document.getElementById('cartSubmit');

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

  // Los nombres y los ids de sabores vienen del catálogo: se escapan antes de armar HTML.
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
        <div class="cart-item" data-box="${boxIndex}" data-flavor="${esc(id)}">
          <div class="cart-item-info">
            <span class="cart-item-name">${esc(box._flavorNames[id])}</span>
          </div>
          <div class="cart-item-qty">
            <button class="qty-btn" data-action="dec" data-box="${boxIndex}" data-flavor="${esc(id)}" type="button" aria-label="Sacar un ${esc(box._flavorNames[id])}">&minus;</button>
            <span class="qty-value">${qty}</span>
            <button class="qty-btn" data-action="inc" data-box="${boxIndex}" data-flavor="${esc(id)}" type="button" aria-label="Sumar un ${esc(box._flavorNames[id])}" ${filled >= cap ? 'disabled' : ''}>+</button>
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

      const promo = complete ? promoDeCaja(box) : null;
      return `
        <div class="cart-box ${!complete ? 'is-incomplete' : ''}">
          <div class="cart-box-head">
            <span>${boxLabel}</span>
            <span class="cart-box-fill">${fillLabel}</span>
          </div>
          ${promo ? `<p class="cart-box-promo">${esc(promo.nombre)}: −$${promo.monto}</p>` : ''}
          ${flavorRows}
        </div>
      `;
    }).join('');

    const rollLabel = rollCount === 1 ? 'roll' : 'rolls';
    cartSummaryEl.innerHTML = `
      <span>${rollCount} ${rollLabel} en ${cart.length} caja${cart.length > 1 ? 's' : ''}</span>
      <strong>${cartPromo() ? `<s>$${cartList()}</s> ` : ''}$${cartTotal()}</strong>
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

    // Al final: el contenido del carrito también decide si "Confirmar pedido"
    // puede tocarse, y así un error acá nunca impide dibujar el carrito.
    updateSubmitBtn();
  }

  // Eventos delegados: las tarjetas se pueden regenerar desde el catálogo.
  const menuGrid = document.querySelector('.menu-grid');

  menuGrid?.addEventListener('change', (e) => {
    const input = e.target.closest('.roll-qty');
    if (!input) return;
    let qty = parseInt(input.value, 10);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (qty > CUSTOM_MAX) qty = CUSTOM_MAX;
    input.value = qty;
  });

  menuGrid?.addEventListener('click', (e) => {
    const btn = e.target.closest('.roll-add');
    if (!btn || btn.disabled) return;
    const card = btn.closest('.roll-card');
    const qtyInput = card ? card.querySelector('.roll-qty') : null;
    let requestedQty = qtyInput ? parseInt(qtyInput.value, 10) : 1;
    if (!Number.isFinite(requestedQty) || requestedQty < 1) requestedQty = 1;
    if (requestedQty > CUSTOM_MAX) requestedQty = CUSTOM_MAX;

    let box = currentBox();
    const selectedSize = getSelectedBoxSize();
    if (!box || box.size !== selectedSize) {
      box = { size: selectedSize, flavors: {} };
      cart.push(box);
    }
    const wasComplete = boxIsComplete(box);
    const remaining = boxCap(box) - boxFilled(box);
    const qtyToAdd = Math.min(requestedQty, remaining);

    box.flavors[btn.dataset.id] = (box.flavors[btn.dataset.id] || 0) + qtyToAdd;
    box._flavorNames = box._flavorNames || {};
    box._flavorNames[btn.dataset.id] = btn.dataset.name;

    renderCart();
    if (qtyInput) qtyInput.value = 1;

    const filled = boxFilled(box);

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

    // recién completada esta caja: ofrecemos seguir pidiendo o ir al carrito
    if (!wasComplete && boxIsComplete(box)) {
      // la personalizada se puede pedir desde el mínimo, pero sigue admitiendo rolls hasta el máximo
      if (isCustomBox(box)) {
        openBoxCompleteModal(
          textoWeb('carrito.minimo_texto', 'Tu caja personalizada ya tiene {rolls} rolls: podés pedirla así o seguir sumando hasta {maximo}.',
            { rolls: filled, maximo: CUSTOM_MAX }),
          textoWeb('carrito.minimo_titulo', '¡Ya podés pedir!'));
      } else {
        openBoxCompleteModal(
          textoWeb('carrito.completa_texto', 'Tu caja de {rolls} rolls quedó completa.', { rolls: box.size }),
          textoWeb('carrito.completa_titulo', '¡Caja completa!'));
      }
    }
  });

  /* ---------- Box picker ---------- */
  const boxOptionsEl = document.querySelector('.box-options');
  const boxPickerNote = document.getElementById('boxPickerNote');

  function updateFlavorPrices() {
    const isCustom = getSelectedBoxSize() === 'custom';
    document.querySelectorAll('[data-flavor-price]').forEach(nodo => {
      const flavorId = nodo.dataset.flavorPrice;
      const price = CUSTOM_FLAVOR_PRICES[flavorId];
      const sinPrecio = isCustom && price == null;
      if (!isCustom) nodo.textContent = 'Precio: Incluido en la caja';
      else nodo.textContent = sinPrecio ? 'No disponible en caja personalizada' : `Precio: $${price} c/u`;
      // un sabor sin precio por unidad no se puede sumar a una caja personalizada
      const add = nodo.closest('.roll-card')?.querySelector('.roll-add');
      if (add) add.disabled = sinPrecio;
    });
  }

  function updateBoxPickerNote() {
    if (!boxPickerNote) return;
    boxPickerNote.textContent = getSelectedBoxSize() === 'custom'
      ? `Sumá entre ${CUSTOM_MIN} y ${CUSTOM_MAX} rolls de los sabores que quieras. Cada sabor tiene su propio precio: mirá el detalle en cada tarjeta.`
      : 'Ahora sumá los sabores que quieras de la lista de abajo hasta completar tu caja.';
  }

  boxOptionsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.box-option');
    if (!btn) return;
    boxOptionsEl.querySelectorAll('.box-option').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    updateBoxPickerNote();
    updateFlavorPrices();
    updateBoxProgress();
    menuGrid?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  updateFlavorPrices();
  updateBoxProgress();

  /* ---------- Catálogo desde /admin ---------- */
  // Arma los tamaños de caja y las tarjetas con lo que devuelve /api/catalogo. Si algo falla o
  // viene vacío, no toca nada: queda lo escrito en index.html y los precios de arriba.
  const NUMEROS = ['', 'Un', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez'];

  function el(tag, attrs = {}, ...hijos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
    e.append(...hijos.filter(x => x != null));
    return e;
  }

  function tarjetaSabor(s) {
    const nombre = `Roll de ${s.nombre}`;
    const media = el('div', { class: 'roll-card-media' },
      s.foto
        ? el('picture', {}, el('img', { src: s.foto, alt: `${nombre}, cinnamon roll de Cinniminies`, class: 'roll-photo', loading: 'lazy' }))
        : el('div', { class: 'roll-photo roll-photo-vacia', role: 'img', 'aria-label': nombre }, s.nombre.charAt(0)),
      s.etiqueta ? el('span', { class: 'roll-tag' }, s.etiqueta) : null);
    return el('article', { class: 'roll-card', 'data-flavor': s.id }, media,
      el('div', { class: 'roll-card-body' },
        el('h3', {}, nombre),
        el('p', {}, s.descripcion || ''), // siempre, para que todas las tarjetas tengan la misma altura
        el('div', { class: 'roll-card-foot' },
          el('span', { class: 'roll-price', 'data-flavor-price': s.id }, 'Precio: Incluido en la caja'),
          el('div', { class: 'roll-add-group' },
            el('input', { type: 'number', class: 'roll-qty', min: 1, max: CUSTOM_MAX, value: 1, inputmode: 'numeric', 'aria-label': `Cantidad de ${nombre}` }),
            el('button', { class: 'roll-add', 'data-name': nombre, 'data-id': s.id }, 'Agregar al pedido')))));
  }

  // Precio de una caja fija en el selector: tachado si una promo sin sabores elegidos la baja entera
  function precioConPromo(size, precio) {
    const promo = promoDeCaja({ size, flavors: { _: size } }, PROMOS.filter(p => !p.sabores.length));
    return promo
      ? el('span', { class: 'box-cost' }, el('s', {}, `$${precio}`), ` $${precio - promo.monto}`)
      : el('span', { class: 'box-cost' }, `$${precio}`);
  }

  // Etiqueta "−6,66 %" (y en qué sabores) en las cajas que tienen alguna promo
  function marcaPromo(size) {
    const p = PROMOS.find(x => promoParaTamano(x, size));
    if (!p) return null;
    return el('span', { class: 'box-promo' }, p.sabores.length ? `${etiquetaPromo(p)} en ${nombresSabores(p.sabores)}` : etiquetaPromo(p));
  }

  let nombresDeSabor = {};
  function nombresSabores(slugs) {
    const n = slugs.map(id => nombresDeSabor[id] || id);
    return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}` : n[0];
  }

  // Cinta arriba del selector de cajas con el texto de cada promo (el que se escribe en /admin → Promociones)
  function mostrarCintaPromo(sabores) {
    nombresDeSabor = Object.fromEntries(sabores.map(s => [s.id, s.nombre]));
    const cinta = document.getElementById('promoCinta');
    if (!cinta) return;
    const textos = PROMOS.map(p => p.texto || `${p.nombre}: ${etiquetaPromo(p)}${p.sabores.length ? ` en ${nombresSabores(p.sabores)}` : ''}`);
    cinta.textContent = textos.join(' · ');
    cinta.hidden = !textos.length;
  }

  function aplicarCatalogo(cat) {
    const sabores = (cat?.sabores || []).filter(s => s.id && s.nombre);
    const cajas = (cat?.formatos || []).filter(f => f.tipo === 'caja_fija' && f.rolls > 0 && f.precio != null)
      .sort((a, b) => a.rolls - b.rolls);
    const personalizado = (cat?.formatos || []).find(f => f.tipo === 'personalizado');
    if (!sabores.length || (!cajas.length && !personalizado) || !menuGrid || !boxOptionsEl) return false;

    for (const k of Object.keys(BOX_PRICES)) delete BOX_PRICES[k];
    cajas.forEach(f => { BOX_PRICES[f.rolls] = f.precio; });
    for (const k of Object.keys(CUSTOM_FLAVOR_PRICES)) delete CUSTOM_FLAVOR_PRICES[k];
    sabores.forEach(s => { if (s.precio_unidad != null) CUSTOM_FLAVOR_PRICES[s.id] = s.precio_unidad; });
    PROMOS = Array.isArray(cat?.promos) ? cat.promos : [];
    if (personalizado) {
      CUSTOM_MIN = personalizado.min_rolls || 1;
      CUSTOM_MAX = personalizado.max_rolls || Math.max(CUSTOM_MIN, 12);
    }

    // Tamaños de caja (se mantiene el elegido si sigue existiendo)
    const elegido = String(getSelectedBoxSize());
    const opciones = cajas.map(f => el('button', { class: 'box-option', 'data-qty': f.rolls, 'data-price': f.precio },
      el('span', { class: 'box-qty' }, String(f.rolls)), el('span', { class: 'box-desc' }, 'rolls'),
      precioConPromo(f.rolls, f.precio), marcaPromo(f.rolls)));
    if (personalizado) {
      opciones.push(el('button', { class: 'box-option', 'data-qty': 'custom' },
        el('span', { class: 'box-qty' }, `${CUSTOM_MIN} a ${CUSTOM_MAX}`), el('span', { class: 'box-desc' }, 'a tu gusto'),
        el('span', { class: 'box-cost' }, 'según sabor'), marcaPromo('custom')));
    }
    mostrarCintaPromo(sabores);
    (opciones.find(b => b.dataset.qty === elegido) || opciones[0]).classList.add('is-active');
    boxOptionsEl.replaceChildren(...opciones);

    menuGrid.replaceChildren(...sabores.map(tarjetaSabor));

    // Textos que dependen del catálogo
    // Solo la primera línea ("Tres rolls."): la segunda es editable (menu.titulo).
    const cantidad = document.getElementById('menuTitleCantidad');
    if (cantidad && NUMEROS[sabores.length]) {
      cantidad.textContent = `${NUMEROS[sabores.length]} ${sabores.length === 1 ? 'roll' : 'rolls'}.`;
    }
    const sub = document.getElementById('menuSub');
    if (sub) {
      const tam = cajas.map(f => f.rolls);
      const lista = tam.length > 1 ? `${tam.slice(0, -1).join(', ')} o ${tam[tam.length - 1]}` : String(tam[0] ?? '');
      sub.textContent = [
        tam.length ? `Se venden por caja de ${lista}` : '',
        personalizado ? `${tam.length ? ', o armá' : 'Armá'} tu propia caja personalizada de entre ${CUSTOM_MIN} y ${CUSTOM_MAX} rolls` : '',
      ].join('') + '.';
    }

    updateBoxPickerNote();
    updateFlavorPrices();
    renderCart();
    return true;
  }

  /* ---------- Textos e imágenes editables (Etapa 7) ---------- */
  // Vienen en /api/catalogo como { "hero.titulo": "…" }. Cada lugar de index.html tiene un atributo
  // data-contenido*="clave"; lo que no venga queda como está escrito.
  function marcado(texto) {
    return esc(texto).replace(/\*([^*\n]+)\*/g, '<em>$1</em>').replace(/\r?\n/g, '<br>');
  }

  // Los textos que se arman en el momento (con variables como {tope}) los busca textoWeb().
  let textosWeb = {};

  // El texto editable `clave` (o `defecto` si no está cargado), con las {variables} reemplazadas.
  function textoWeb(clave, defecto, vars = {}) {
    const t = typeof textosWeb[clave] === 'string' && textosWeb[clave].trim() ? textosWeb[clave] : defecto;
    return t.replace(/\{(\w+)\}/g, (todo, v) => (v in vars ? String(vars[v]) : todo));
  }

  function aplicarContenido(c) {
    if (!c || typeof c !== 'object') return;
    textosWeb = c;
    document.dispatchEvent(new Event('textos-web')); // lo que se arma con textoWeb() se vuelve a pintar
    const valor = (clave) => (typeof c[clave] === 'string' ? c[clave] : null);
    document.querySelectorAll('[data-contenido]').forEach(nodo => {
      const v = valor(nodo.dataset.contenido);
      if (v !== null) nodo.innerHTML = marcado(v);
    });
    document.querySelectorAll('[data-contenido-placeholder]').forEach(nodo => {
      const v = valor(nodo.dataset.contenidoPlaceholder);
      if (v !== null) nodo.placeholder = v;
    });
    document.querySelectorAll('[data-contenido-img]').forEach(img => {
      const v = valor(img.dataset.contenidoImg);
      if (!v || !/^(\/?img\/[\w./-]+|https:\/\/[^\s"'<>]+)$/.test(v)) return;
      img.closest('picture')?.querySelectorAll('source').forEach(src => src.remove());
      img.src = v;
    });
    document.querySelectorAll('[data-contenido-mapa]').forEach(mapa => {
      const v = valor(mapa.dataset.contenidoMapa)?.trim();
      if (v) mapa.src = `https://www.google.com/maps?q=${encodeURIComponent(v)}&output=embed`;
    });
    const wa = valor('contacto.whatsapp');
    if (wa && /^598\d{8}$/.test(wa)) {
      WHATSAPP_NUMBER = wa;
      document.querySelectorAll('[data-contenido-whatsapp]').forEach(a => { a.href = `https://wa.me/${wa}`; });
    }
    const ig = valor('contacto.instagram');
    if (ig && /^[\w.]{1,30}$/.test(ig)) {
      document.querySelectorAll('[data-contenido-instagram]').forEach(a => { a.href = `https://instagram.com/${ig}`; });
      document.querySelectorAll('[data-contenido-instagram-texto]').forEach(nodo => { nodo.textContent = `@${ig}`; });
    }
  }

  // Preguntas frecuentes: se ocultan las que quedaron sin pregunta o sin respuesta, y el JSON-LD
  // (#faqDatos, lo que lee Google) se rearma con las que se ven.
  function actualizarPreguntas() {
    const visibles = [];
    document.querySelectorAll('[data-faq]').forEach(d => {
      const pregunta = d.querySelector('summary')?.textContent.trim() || '';
      // Los <br> (renglones de /admin) pasan a espacios para que no se peguen las palabras.
      const p = d.querySelector('p')?.cloneNode(true);
      p?.querySelectorAll('br').forEach(br => br.replaceWith(' '));
      const respuesta = p?.textContent.replace(/\s+/g, ' ').trim() || '';
      d.hidden = !pregunta || !respuesta;
      if (!d.hidden) visibles.push({ pregunta, respuesta });
    });
    const seccion = document.getElementById('preguntas');
    if (seccion) seccion.hidden = !visibles.length;
    const datos = document.getElementById('faqDatos');
    if (datos) {
      datos.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: visibles.map(f => ({ '@type': 'Question', name: f.pregunta, acceptedAnswer: { '@type': 'Answer', text: f.respuesta } })),
      });
      if (!visibles.length) datos.remove();
    }
  }

  (async () => {
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), 5000);
    try {
      const r = await fetch('/api/catalogo', { signal: corte.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const cat = await r.json();
      if (Number.isFinite(cat.envio)) PRECIO_ENVIO = cat.envio;
      try { aplicarContenido(cat.contenido); } catch (e) { console.warn('No se pudieron aplicar los textos:', e.message); }
      actualizarPreguntas();
      actualizarCuenta();
      if (!aplicarCatalogo(cat)) console.warn('Catálogo vacío: se usa el menú de respaldo');
    } catch (e) {
      console.warn('No se pudo leer el catálogo, se usa el menú de respaldo:', e.message);
    } finally {
      clearTimeout(reloj);
    }
  })();

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
  const stepTransfer = document.getElementById('stepTransfer');

  function openModal() {
    cartModal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    cartModal.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  function goToStep(step) {
    [stepCart, stepForm, stepTransfer, stepDone].forEach(s => s?.classList.add('is-hidden'));
    step.classList.remove('is-hidden');
  }

  if (cartFab) cartFab.addEventListener('click', () => { goToStep(stepCart); openModal(); });
  document.getElementById('cartClose')?.addEventListener('click', closeModal);
  document.getElementById('formClose')?.addEventListener('click', closeModal);
  document.getElementById('doneClose')?.addEventListener('click', closeModal);
  document.getElementById('transferClose')?.addEventListener('click', closeModal);
  document.getElementById('cartBackdrop')?.addEventListener('click', closeModal);

  /* ---------- Popup de "caja completa" ---------- */
  const boxCompleteModal = document.getElementById('boxCompleteModal');
  const boxCompleteText = document.getElementById('boxCompleteText');
  const boxCompleteTitulo = document.getElementById('boxCompleteTitulo');

  function openBoxCompleteModal(message, titulo = '¡Caja completa!') {
    if (!boxCompleteModal) return;
    if (boxCompleteText) boxCompleteText.textContent = message;
    if (boxCompleteTitulo) boxCompleteTitulo.textContent = titulo;
    boxCompleteModal.classList.add('is-open');
  }
  function closeBoxCompleteModal() {
    boxCompleteModal?.classList.remove('is-open');
  }

  document.getElementById('boxCompleteBackdrop')?.addEventListener('click', closeBoxCompleteModal);
  document.getElementById('boxCompleteContinue')?.addEventListener('click', () => {
    closeBoxCompleteModal();
    document.querySelector('.box-picker')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('boxCompleteCart')?.addEventListener('click', () => {
    closeBoxCompleteModal();
    goToStep(stepCart);
    openModal();
  });

  // Escape cierra el popup de caja completa o el carrito (salvo mientras se envía el pedido).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (boxCompleteModal?.classList.contains('is-open')) closeBoxCompleteModal();
    else if (cartModal?.classList.contains('is-open') && !enviandoPedido) closeModal();
  });

  cartContinueBtn?.addEventListener('click', () => {
    if (cartHasIncompleteBox()) return;
    goToStep(stepForm);
    updateSubmitBtn();
  });

  /* ---------- Dirección condicional (solo si eligen Entrega) ---------- */
  const direccionField = document.getElementById('direccionField');
  const direccionInput = stepForm ? stepForm.direccion : null;

  function updateDireccionVisibility() {
    if (!direccionField || !stepForm) return;
    const esEntrega = stepForm.modalidad.value === 'Coordinar entrega';
    direccionField.classList.toggle('is-hidden', !esEntrega);
    if (direccionInput) {
      direccionInput.required = esEntrega;
      if (!esEntrega) direccionInput.value = '';
    }
  }

  stepForm?.querySelectorAll('input[name="modalidad"]').forEach(radio => {
    radio.addEventListener('change', updateDireccionVisibility);
  });
  updateDireccionVisibility();

  /* ---------- WhatsApp: solo celulares uruguayos ---------- */
  // Formato válido: 9 dígitos, 09 + prefijo de compañía (1 a 9) + 6 dígitos.
  // Ej: 098029462. El 090 no se usa para celulares, por eso queda afuera.
  const TEL_URUGUAYO = /^09[1-9]\d{6}$/;
  const telInput = stepForm ? stepForm.telefono : null;

  // Deja solo dígitos y saca el código de país si lo pegaron (+598, 00598, 598).
  // Un número local siempre arranca con 0, así que un 598 adelante es país.
  function normalizarTel(valor) {
    let d = String(valor).replace(/\D/g, '');
    let teniaPais = false;
    if (d.startsWith('00598')) { d = d.slice(5); teniaPais = true; }
    else if (d.startsWith('598')) { d = d.slice(3); teniaPais = true; }
    // En formato internacional el 0 inicial no se escribe (+598 98 029 462),
    // así que se lo devolvemos para dejarlo siempre como número local.
    if (teniaPais && d && d[0] !== '0') d = '0' + d;
    return d.slice(0, 9);
  }

  // Solo para mostrarlo lindo en el pedido: 098029462 -> 098 029 462
  function formatearTel(digitos) {
    return [digitos.slice(0, 3), digitos.slice(3, 6), digitos.slice(6, 9)]
      .filter(Boolean).join(' ');
  }

  const telError = document.getElementById('telError') || {};

  // Filtra mientras escriben: letras y símbolos nunca llegan a entrar al campo.
  telInput?.addEventListener('input', () => {
    const limpio = normalizarTel(telInput.value);
    if (telInput.value !== limpio) telInput.value = limpio;
    if (TEL_URUGUAYO.test(limpio)) telError.hidden = true;
  });
  // Con el botón gris no se veía por qué no dejaba confirmar: se avisa al salir del campo.
  telInput?.addEventListener('blur', () => {
    const tel = normalizarTel(telInput.value);
    telError.hidden = tel === '' || TEL_URUGUAYO.test(tel);
  });

  /* ---------- Nombre: sin números ---------- */
  // Igual que el WhatsApp: los números se sacan mientras escriben (o si los pegan),
  // dejando el cursor donde estaba.
  const nombreInput = stepForm ? stepForm.nombre : null;
  nombreInput?.addEventListener('input', () => {
    const valor = nombreInput.value;
    const limpio = valor.replace(/\d/g, '');
    if (valor === limpio) return;
    const cursor = nombreInput.selectionStart ?? valor.length;
    const quitadosAntes = (valor.slice(0, cursor).match(/\d/g) || []).length;
    nombreInput.value = limpio;
    nombreInput.setSelectionRange?.(cursor - quitadosAntes, cursor - quitadosAntes);
  });

  /* ---------- Código de recomendación (docs/descuento-plan/logica.md) ---------- */
  // El campo aparece solo si hay una campaña. Qué significa cada código lo decide la base
  // (POST /api/recomendacion): acá solo se avisa antes de mandar. El descuento lo aplica la base al
  // guardar el pedido, en la Box de 6 o de 12 más cara (las personalizadas no llevan).
  const codigoField = document.getElementById('codigoField');
  const codigoInput = stepForm ? stepForm.codigo_recomendacion : null;
  const codigoEstado = document.getElementById('codigoEstado');
  let campana = { activa: false };
  let modoPrueba = false; // solo en el servidor local: sin mail de aviso a los dueños
  let consultaCodigo = 0;
  let relojCodigo = null;

  (async () => {
    try {
      const r = await fetch('/api/recomendacion');
      if (!r.ok) return;
      campana = await r.json();
      modoPrueba = campana.prueba === true;
      document.getElementById('modoPrueba').hidden = !modoPrueba;
      // terminada la campaña, el campo sigue mientras alguien tenga un bono de la Box de 12 por usar
      if (codigoField) codigoField.hidden = !campana.activa && !campana.solo_canje;
      textosCampana();
    } catch { /* sin campaña a la vista: el pedido sigue igual */ }
  })();

  // Aviso del bono y aclaración del campo: dependen de la campaña y de los textos editables (llegan por separado).
  function textosCampana() {
    const bono = document.getElementById('codigoBono');
    if (bono && campana.activa) {
      bono.textContent = textoWeb('recomendacion.bono_aviso',
        'Tu primera Box de 12 de la campaña te deja {bono} % de descuento para tus próximos pedidos, por 30 días.',
        { bono: campana.porcentaje || 5 });
      bono.hidden = false;
    }
    const ayuda = document.getElementById('codigoAyuda');
    if (ayuda && campana.solo_canje) ayuda.textContent = 'La campaña terminó. Si todavía tenés descuento, poné tu código.';
  }
  // (después de que aplicarContenido pinta los data-contenido)
  document.addEventListener('textos-web', () => setTimeout(textosCampana));

  const codigoPremio = document.getElementById('codigoPremio');
  let confetiLanzado = ''; // código + celular que ya festejó: no se repite en cada revisión

  function mostrarCodigo(texto, tipo = '') {
    if (!codigoEstado) return;
    codigoEstado.textContent = texto;
    codigoEstado.dataset.tipo = tipo;
    if (codigoPremio) codigoPremio.hidden = true;
  }

  // Cuánto sería el descuento con el carrito de ahora, y en qué box (la cuenta final la hace la base).
  function descuentoEstimado(pct) {
    const fijas = cart.filter(box => !isCustomBox(box));
    if (!fijas.length) return null;
    const gana = (b) => Math.round(boxPrice(b) * pct / 100) - (promoDeCaja(b)?.monto || 0);
    const box = fijas.reduce((a, b) => (gana(b) > gana(a) ? b : a));
    if (gana(box) <= 0) return { monto: 0, caja: `Box de ${box.size}`, promoMayor: true };
    return { monto: Math.round(boxPrice(box) * pct / 100), caja: `Box de ${box.size}` };
  }

  // "2027-01-19" → "19/1"
  const diaMes = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}`; };

  // Con su propio código y saldo: el porcentaje bien grande, una barra hasta el tope del mes y,
  // si llegó al tope, confeti (una vez por código y celular). c: lo que devolvió la consulta del código
  // (bono y bono_hasta si tiene el de la Box de 12; campana false si la campaña ya terminó).
  function mostrarPremio(pct, tope, clave, c = {}) {
    if (!codigoPremio) return;
    const est = descuentoEstimado(pct);
    const enTope = pct >= tope;
    document.getElementById('codigoPremioPct').textContent = `${pct} %`;
    document.getElementById('codigoPremioTitulo').textContent = enTope
      ? textoWeb('recomendacion.tope_titulo', '¡Llegaste al máximo: {tope} % de descuento!', { tope })
      : textoWeb('recomendacion.premio_titulo', 'Tenés {saldo} % de descuento', { saldo: pct });
    document.getElementById('codigoPremioSub').textContent = [
      est?.promoMayor
        ? textoWeb('recomendacion.promo_mayor', 'Esta vez la promo de tu {caja} descuenta más: tu descuento te sigue esperando.', { caja: est.caja })
        : est ? `−$${est.monto} en tu ${est.caja}.` : 'Sumá una Box de 6 o de 12 al pedido para usarlo.',
      c.bono && c.bono_hasta
        ? textoWeb('recomendacion.bono_premio', 'Incluye {bono} % por tu primera Box de 12, hasta el {vence}.',
          { bono: c.bono, vence: diaMes(c.bono_hasta) })
        : '',
      enTope
        ? textoWeb('recomendacion.tope_texto', 'Es lo más alto de la campaña: gracias por recomendarnos.')
        : c.campana === false ? ''
        : textoWeb('recomendacion.premio_texto', 'Este mes podés llegar hasta {tope} % recomendando.', { tope })
    ].filter(Boolean).join(' ');
    codigoPremio.classList.toggle('is-tope', enTope);
    codigoPremio.hidden = false;
    const barra = document.getElementById('codigoPremioBarra');
    barra.style.width = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      barra.style.width = `${Math.min(100, (pct / tope) * 100)}%`;
    }));
    if (enTope && confetiLanzado !== clave) {
      confetiLanzado = clave;
      lanzarConfeti();
    }
  }

  // Confeti en un canvas encima de todo; se borra solo. Sin animación si la persona la desactivó.
  function lanzarConfeti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'confeti';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const ancho = window.innerWidth;
    const alto = window.innerHeight;
    canvas.width = ancho * dpr;
    canvas.height = alto * dpr;
    ctx.scale(dpr, dpr);
    const colores = ['#D98F3E', '#8B4226', '#F0B873', '#3A2417', '#F7E7C8', '#6B8E5A'];
    // Dos ráfagas desde las esquinas de abajo, hacia el centro.
    const piezas = Array.from({ length: 160 }, (_, i) => {
      const izq = i % 2 === 0;
      const angulo = (izq ? -60 : -120) + (Math.random() - 0.5) * 50;
      const vel = 9 + Math.random() * 9;
      return {
        x: izq ? 0 : ancho,
        y: alto,
        vx: Math.cos(angulo * Math.PI / 180) * vel,
        vy: Math.sin(angulo * Math.PI / 180) * vel * 1.5,
        giro: Math.random() * Math.PI,
        vgiro: (Math.random() - 0.5) * 0.3,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 6,
        color: colores[i % colores.length]
      };
    });
    const inicio = performance.now();
    const DURACION = 3200;
    let antes = inicio;
    // Las velocidades están pensadas por cuadro a 60 por segundo: se escalan por el tiempo real que pasó,
    // así dura lo mismo en pantallas de 120 Hz o si el navegador frena la animación.
    (function cuadro(ahora) {
      const t = ahora - inicio;
      // (el primer cuadro puede traer una hora apenas anterior a inicio: nunca hacia atrás)
      const k = Math.min(4, Math.max(0, ahora - antes) / (1000 / 60));
      antes = Math.max(antes, ahora);
      ctx.clearRect(0, 0, ancho, alto);
      ctx.globalAlpha = t > DURACION - 600 ? Math.max(0, (DURACION - t) / 600) : 1;
      for (const p of piezas) {
        p.vy = Math.min(p.vy + 0.3 * k, 3.2); // cae despacio, flotando, en vez de desplomarse
        p.vx *= 0.97 ** k;
        p.vy *= 0.985 ** k;
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.giro += p.vgiro * k;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.giro);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.giro * 2)));
        ctx.restore();
      }
      if (t < DURACION) requestAnimationFrame(cuadro);
      else canvas.remove();
    })(inicio);
  }

  async function revisarCodigo() {
    if (!codigoInput || codigoField.hidden) return;
    const codigo = codigoInput.value.replace(/[^A-Za-z0-9]/g, '');
    const n = ++consultaCodigo;
    if (codigo.length < 4) { mostrarCodigo(''); return; }
    mostrarCodigo('Revisando el código…');
    try {
      const r = await fetch('/api/recomendacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, telefono: normalizarTel(stepForm.telefono.value) })
      });
      const c = await r.json();
      if (n !== consultaCodigo) return; // ya escribieron otra cosa
      if (!r.ok) { mostrarCodigo(c?.error || '', 'error'); return; }
      const de = c.nombre ? `Código de ${c.nombre}` : 'Código';
      if (c.estado === 'no_existe') mostrarCodigo('No encontramos ese código. Revisalo o dejalo vacío.', 'error');
      else if (c.estado === 'sin_campana') mostrarCodigo('Ahora no hay descuentos por recomendación.');
      else if (c.estado === 'existe') mostrarCodigo(`${de}. Completá tu WhatsApp para ver si te sirve.`);
      else if (c.estado === 'recomendado') {
        mostrarCodigo(textoWeb('recomendacion.de_amigo', 'Código de {nombre} ✓ Gracias por venir de su parte.',
          { nombre: c.nombre || 'quien te lo pasó' }), 'ok');
      }
      else if (c.estado === 'ya_cliente') mostrarCodigo(`${de}. Como ya nos compraste antes, no suma para ${c.nombre || 'esa persona'}.`);
      else if (c.estado === 'propio' && c.porcentaje > 0) {
        mostrarCodigo('Es tu código ✓', 'ok');
        mostrarPremio(Number(c.porcentaje), Number(c.tope) || Number(c.porcentaje), `${codigo}|${stepForm.telefono.value}`, c);
      } else if (c.estado === 'propio' && c.campana === false) {
        mostrarCodigo('Es tu código, pero la campaña terminó y ya no te queda descuento.');
      } else if (c.estado === 'propio') {
        mostrarCodigo(textoWeb('recomendacion.sin_saldo',
          'Es tu código. Todavía no juntaste descuento este mes: compartilo y sumás {porcentaje} % por cada persona nueva que compre.',
          { porcentaje: campana.porcentaje || 5 }));
      }
    } catch {
      if (n === consultaCodigo) mostrarCodigo('');
    }
  }

  codigoInput?.addEventListener('input', () => {
    clearTimeout(relojCodigo);
    relojCodigo = setTimeout(revisarCodigo, 500);
  });
  // El mismo código significa otra cosa según quién pide (el propio, el de un amigo).
  telInput?.addEventListener('change', revisarCodigo);

  /* ---------- Estado del botón "Confirmar pedido" ---------- */
  // Mismo criterio que "Pedir ahora": el botón queda gris mientras falte algo,
  // así nunca promete un envío que después se rechaza.
  let enviandoPedido = false;

  function formularioCompleto() {
    if (!stepForm) return false;
    const esEntrega = stepForm.modalidad.value === 'Coordinar entrega';
    return stepForm.nombre.value.trim() !== ''
      && TEL_URUGUAYO.test(normalizarTel(stepForm.telefono.value))
      && (!esEntrega || stepForm.direccion.value.trim() !== '')
      && cart.length > 0
      && !cartHasIncompleteBox();
  }

  // Total con el envío, arriba del botón: lo mismo que va a guardar la base.
  const formTotal = document.getElementById('formTotal');
  function actualizarTotalForm() {
    if (!formTotal || !stepForm) return;
    const cajas = cartTotal();
    const envio = stepForm.modalidad.value === 'Coordinar entrega' ? PRECIO_ENVIO : 0;
    formTotal.textContent = !cajas ? ''
      : envio ? textoWeb('form.total_envio', 'Total: ${total} (cajas ${cajas} + envío ${envio})',
        { total: cajas + envio, cajas, envio })
      : textoWeb('form.total', 'Total: ${total}', { total: cajas });
    const ayudaEnvio = document.getElementById('ayudaEnvio');
    if (ayudaEnvio) ayudaEnvio.textContent = textoWeb('form.ayuda_envio', 'El envío cuesta ${envio} y se suma al total.',
      { envio: PRECIO_ENVIO });
  }
  document.addEventListener('textos-web', actualizarTotalForm);

  function updateSubmitBtn() {
    actualizarTotalForm();
    if (!submitBtn || enviandoPedido) return;
    const listo = formularioCompleto();
    submitBtn.disabled = !listo;
    submitBtn.title = listo ? '' : 'Completá tus datos para confirmar el pedido';
  }

  // 'input' cubre los campos de texto, 'change' los radios de modalidad y pago.
  // Ambos suben por bubbling desde los campos, así que el filtro del teléfono
  // ya normalizó el valor cuando esto corre.
  stepForm?.addEventListener('input', updateSubmitBtn);
  stepForm?.addEventListener('change', updateSubmitBtn);
  updateSubmitBtn();

  /* ---------- Panel de transferencia (segundo panel si eligen pagar así) ---------- */
  const comprobanteInput = document.getElementById('comprobanteInput');
  const transferEnviar = document.getElementById('transferEnviar');
  const transferDespues = document.getElementById('transferDespues');
  const transferError = document.getElementById('transferError');
  const MAX_COMPROBANTE = 3 * 1024 * 1024; // mismo límite que /api/comprobante
  let transferencia = null; // { codigo, telefono, waLink }

  const transferSeguir = document.getElementById('transferSeguir');
  const avisoDespues = document.getElementById('doneAvisoTransfer');

  // Datos de la cuenta (formulario y panel). Vienen de /admin → Web → Pago por transferencia: lo que
  // está vacío no se muestra, y sin número de cuenta se ve el texto de respaldo.
  function actualizarCuenta() {
    document.querySelectorAll('[data-cuenta]').forEach(caja => {
      const numero = caja.querySelector('.cuenta-numero dd').textContent.trim();
      caja.querySelectorAll('.cuenta-fila').forEach(f => { f.hidden = !f.querySelector('dd').textContent.trim(); });
      caja.querySelector('.cuenta-datos').hidden = !numero;
      const nota = caja.querySelector('.cuenta-nota');
      nota.hidden = !numero || !nota.textContent.trim();
      caja.querySelector('.cuenta-sin-datos').hidden = Boolean(numero);
    });
  }
  actualizarCuenta();

  document.querySelectorAll('[data-copiar-cuenta]').forEach(boton => {
    boton.addEventListener('click', async () => {
      const numero = boton.closest('.cuenta-fila').querySelector('dd').textContent.trim();
      try {
        await navigator.clipboard.writeText(numero);
        boton.textContent = '¡Copiado!';
      } catch {
        boton.textContent = 'No se pudo';
      }
      setTimeout(() => { boton.textContent = 'Copiar'; }, 2000);
    });
  });

  // En el formulario, la cuenta aparece apenas eligen transferencia.
  const cuentaForm = document.getElementById('cuentaForm');
  function updateCuentaForm() {
    cuentaForm?.classList.toggle('is-hidden', stepForm?.pago.value !== 'Transferencia');
  }
  stepForm?.querySelectorAll('input[name="pago"]').forEach(radio => radio.addEventListener('change', updateCuentaForm));

  function abrirTransferencia({ codigo, telefono, total, orderId, waLink }) {
    transferencia = { codigo, telefono, waLink };
    document.getElementById('transferOrderId').textContent = orderId;
    document.getElementById('transferTotal').textContent = `$${total}`;
    // Sin código de la base (falló el guardado) no se puede adjuntar: solo "Seguir" y va por WhatsApp.
    document.getElementById('comprobanteBloque').hidden = !codigo;
    transferSeguir.hidden = Boolean(codigo);
    comprobanteInput.value = '';
    transferError.textContent = '';
    transferEnviar.disabled = true;
    transferEnviar.textContent = 'Enviar comprobante';
    goToStep(stepTransfer);
  }

  // "Lo mando después": el pedido ya está guardado; el comprobante llega por WhatsApp. El mensaje
  // prearmado lo dice y la pantalla final lo recuerda.
  function terminarSinComprobante() {
    document.getElementById('doneWhatsapp').href = transferencia.waLink
      + encodeURIComponent('\nTe mando el comprobante de la transferencia por acá.');
    avisoDespues.hidden = false;
    goToStep(stepDone);
  }
  transferDespues?.addEventListener('click', terminarSinComprobante);
  transferSeguir?.addEventListener('click', terminarSinComprobante);

  comprobanteInput?.addEventListener('change', () => {
    transferError.textContent = '';
    transferEnviar.disabled = !comprobanteInput.files?.length;
  });

  // Las fotos del celular pesan varios MB: se achican a JPEG (alcanza para leer un comprobante).
  // Los PDF y las imágenes que ya son chicas van tal cual.
  async function prepararComprobante(archivo) {
    const esImagen = archivo.type.startsWith('image/');
    if (!esImagen || archivo.size <= 1024 * 1024) return archivo;
    try {
      const bmp = await createImageBitmap(archivo);
      const escala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(bmp.width * escala);
      lienzo.height = Math.round(bmp.height * escala);
      lienzo.getContext('2d').drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
      const blob = await new Promise(ok => lienzo.toBlob(ok, 'image/jpeg', 0.85));
      return blob && blob.size < archivo.size ? blob : archivo;
    } catch {
      return archivo; // el navegador no la sabe abrir (p. ej. HEIC fuera de Safari): que la valide la API
    }
  }

  const aBase64 = (blob) => new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).replace(/^data:[^,]*,/, ''));
    lector.onerror = () => mal(lector.error);
    lector.readAsDataURL(blob);
  });

  transferEnviar?.addEventListener('click', async () => {
    const archivo = comprobanteInput.files?.[0];
    if (!archivo || !transferencia?.codigo) return;
    transferError.textContent = '';
    transferEnviar.disabled = true;
    transferEnviar.textContent = 'Enviando...';
    try {
      const listo = await prepararComprobante(archivo);
      if (listo.size > MAX_COMPROBANTE) throw new Error('El archivo es muy grande (máximo 3 MB). Probá con una captura.');
      const r = await fetch('/api/comprobante', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: transferencia.codigo, telefono: transferencia.telefono, archivo: await aBase64(listo) })
      });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(cuerpo?.error || 'No se pudo enviar el comprobante.');
      // Que el mensaje de WhatsApp avise que ya está.
      const wa = document.getElementById('doneWhatsapp');
      wa.href = transferencia.waLink + encodeURIComponent('\nComprobante: subido en la web');
      avisoDespues.hidden = true;
      goToStep(stepDone);
    } catch (e) {
      transferError.textContent = `${e.message} Si no sale, mandalo por WhatsApp.`;
      transferEnviar.disabled = false;
      transferEnviar.textContent = 'Enviar comprobante';
    }
  });


  /* ---------- Envío del formulario ---------- */
  const formError = document.getElementById('formError');

  // Devuelve { codigo, total, cajas: [{ formato, precio }] } o null si no se pudo guardar.
  async function guardarPedidoEnBase(pedido) {
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), 8000);
    try {
      const r = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pedido),
        signal: corte.signal
      });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok || !cuerpo?.codigo) {
        console.warn('El pedido no quedó en la base, sigue por mail y WhatsApp:', cuerpo?.error || r.status);
        return null;
      }
      return cuerpo;
    } catch (e) {
      console.warn('El pedido no quedó en la base, sigue por mail y WhatsApp:', e.message);
      return null;
    } finally {
      clearTimeout(reloj);
    }
  }

  stepForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';

    const nombre = stepForm.nombre.value.trim();
    const telefono = normalizarTel(stepForm.telefono.value);
    const modalidad = stepForm.modalidad.value;
    const esEntrega = modalidad === 'Coordinar entrega';
    const direccion = stepForm.direccion.value.trim();
    const pago = stepForm.pago.value;
    const notas = stepForm.notas.value.trim();

    if (!nombre || !telefono) {
      formError.textContent = 'Completá nombre y WhatsApp para continuar.';
      return;
    }
    if (!TEL_URUGUAYO.test(telefono)) {
      formError.textContent = 'Revisá el WhatsApp: tiene que ser un celular uruguayo de 9 dígitos que empiece con 09 (ej: 098029462).';
      telInput?.focus();
      return;
    }
    const telefonoFmt = formatearTel(telefono);
    if (esEntrega && !direccion) {
      formError.textContent = 'Completá la dirección de entrega para continuar.';
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

    enviandoPedido = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    // 1) Guardar el pedido en la base (/api/pedidos). La base recalcula los precios y da el código.
    //    Si falla o tarda, se sigue como siempre con un código generado acá: el pedido nunca se traba.
    const guardado = await guardarPedidoEnBase({
      nombre, telefono, direccion, notas,
      modalidad: esEntrega ? 'entrega' : 'retiro',
      pago: pago.toLowerCase(),
      codigo_recomendacion: codigoField && !codigoField.hidden ? codigoInput.value.trim() : '',
      sitio_web: stepForm.sitio_web?.value || '',
      cajas: cart.map(box => isCustomBox(box)
        ? { tipo: 'personalizado', sabores: { ...box.flavors } }
        : { tipo: 'caja_fija', rolls: box.size, sabores: { ...box.flavors } })
    });
    const orderId = guardado?.codigo || generateOrderId();
    const precioCaja = (box, i) => guardado?.cajas?.[i]?.precio ?? boxPrice(box);

    const detailLines = cart.map((box, i) => {
      const flavorList = Object.entries(box.flavors)
        .map(([id, qty]) => `${qty}x ${box._flavorNames[id]}`)
        .join(', ');
      const filled = boxFilled(box);
      const boxLabel = isCustomBox(box)
        ? `Caja personalizada de ${filled} rolls, $${precioCaja(box, i)}`
        : `Caja de ${box.size} rollos, $${precioCaja(box, i)}`;
      return `- ${boxLabel}: ${flavorList}`;
    }).join('\n');

    const envio = guardado ? Number(guardado.envio) || 0 : (esEntrega ? PRECIO_ENVIO : 0);
    const total = guardado?.total ?? cartTotal() + envio;
    const lineaEnvio = envio ? `Envío: $${envio}` : '';
    const promoPedido = guardado ? Number(guardado.descuento_promo) || 0 : cartPromo();
    const lineaPromo = promoPedido ? `${guardado?.promo || 'Promo'}: -$${promoPedido}` : '';
    // Lo que hizo la base con el código: descuento propio aplicado o de quién vino recomendado.
    const rec = guardado?.recomendacion;
    const codigoUsado = codigoField && !codigoField.hidden ? codigoInput.value.trim().toUpperCase() : '';
    const lineaCodigo = !codigoUsado ? ''
      : rec?.aplicado ? `Descuento por recomendaciones (${rec.porcentaje} % en ${rec.formato}): -$${rec.monto}`
      : rec?.estado === 'recomendado' ? `Código ${codigoUsado} (me recomendó ${rec.nombre})`
      : `Código ${codigoUsado}`;

    const fullDetail = [
      `Pedido: ${orderId}`,
      `Cliente: ${nombre}`,
      `WhatsApp: ${telefonoFmt}`,
      `Modalidad: ${modalidad}`,
      esEntrega && direccion ? `Dirección: ${direccion}` : '',
      `Pago: ${pago}`,
      detailLines,
      lineaPromo,
      lineaCodigo,
      lineaEnvio,
      `Total: $${total}`,
      notas ? `Notas: ${notas}` : ''
    ].filter(Boolean).join('\n');

    document.getElementById('formOrderId').value = orderId;
    document.getElementById('formOrderDetail').value = fullDetail;

    // 2) Aviso por email (Web3Forms). Si falla, no afecta al resto del pedido: ya quedó en la base
    //    (/admin → Pedidos web) y el cliente siempre puede seguir por WhatsApp.
    const notificaciones = [];

    if (WEB3FORMS_ACCESS_KEY && WEB3FORMS_ACCESS_KEY !== WEB3FORMS_PLACEHOLDER && !modoPrueba) {
      notificaciones.push(
        fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_key: WEB3FORMS_ACCESS_KEY,
            subject: `Nuevo pedido ${orderId} · Cinniminies`,
            order_id: orderId,
            cliente: nombre,
            whatsapp_cliente: telefonoFmt,
            // Link directo para escribirle al cliente desde el mail
            chat_cliente: `https://wa.me/598${telefono.slice(1)}`,
            modalidad: modalidad,
            direccion: esEntrega && direccion ? direccion : 'No aplica (retiro)',
            pago: pago,
            detalle: fullDetail,
            total: `$${total}`,
            notas: notas || 'Sin notas'
          })
        })
      );
    }

    if (notificaciones.length > 0) {
      const resultados = await Promise.allSettled(notificaciones);
      resultados.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`No se pudo enviar la notificación #${i + 1}, pero el pedido sigue su curso por WhatsApp.`, r.reason);
        }
      });
    }

    // Armar el link de WhatsApp con todo prearmado
    const waMessage = encodeURIComponent(
      `¡Hola! Quiero confirmar mi pedido ${orderId} en Cinniminies:\n\n${detailLines}${lineaPromo ? `\n${lineaPromo}` : ''}${lineaCodigo ? `\n${lineaCodigo}` : ''}${lineaEnvio ? `\n${lineaEnvio}` : ''}\n\nTotal: $${total}\nModalidad: ${modalidad}${esEntrega && direccion ? `\nDirección: ${direccion}` : ''}\nPago: ${pago}\nNombre: ${nombre}${notas ? `\nNotas: ${notas}` : ''}`
    );
    const waLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${waMessage}`;

    document.getElementById('orderIdDisplay').textContent = orderId;
    document.getElementById('doneWhatsapp').href = waLink;

    enviandoPedido = false;
    submitBtn.textContent = 'Confirmar pedido';

    if (pago === 'Transferencia' && stepTransfer) {
      // El comprobante se adjunta al pedido guardado; si la base no respondió, va por WhatsApp.
      abrirTransferencia({ codigo: guardado?.codigo || null, telefono, total, orderId, waLink });
    } else {
      avisoDespues.hidden = true;
      goToStep(stepDone);
    }

    // limpiar carrito para el próximo pedido
    cart = [];
    renderCart();
    stepForm.reset();
    mostrarCodigo('');
    updateDireccionVisibility();
    updateCuentaForm();
    updateSubmitBtn();
  });

});
