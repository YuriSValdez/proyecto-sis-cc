/* == CRAZY CHICKEN - Canasta de compras y envío de pedidos
   - La canasta se guarda en el navegador (localStorage).
   - Los precios se leen de la base de datos (/api/productos).
   - Al confirmar, se envía el pedido a POST /api/pedidos.
== */
(() => {
    'use strict';
    const API = window.location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api';
    const CLAVE_CANASTA = 'cc_canasta_v1';
    const CLAVE_CLIENTE = 'cc_cliente_v1';
    const MAX_POR_PRODUCTO = 20;

    const $ = (s) => document.querySelector(s);
    const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dinero = (n) => 'Bs. ' + (Number.isInteger(n) ? n : Number(n).toFixed(2));

    let productos = new Map();   
    let canasta = leer(CLAVE_CANASTA, {});

    function leer(clave, porDefecto) {
        try { return JSON.parse(localStorage.getItem(clave)) || porDefecto; } catch { return porDefecto; }
    }
    function guardar() {
        try { localStorage.setItem(CLAVE_CANASTA, JSON.stringify(canasta)); } catch { /* sin almacenamiento */ }
    }

    /* -- Aviso emergente -- */
    let temporizador;
    function aviso(texto, esError = false) {
        const a = $('#avisoCC');
        a.textContent = texto;
        a.classList.toggle('error', esError);
        a.classList.add('on');
        clearTimeout(temporizador);
        temporizador = setTimeout(() => a.classList.remove('on'), 2400);
    }

    /* -- Cálculos -- */
    const lineas = () => Object.entries(canasta)
        .filter(([id]) => productos.has(Number(id)))
        .map(([id, cantidad]) => {
            const p = productos.get(Number(id));
            return { id: Number(id), nombre: p.nombre_producto, precio: p.precio, cantidad, subtotal: p.precio * cantidad };
        });
    const total = () => Math.round(lineas().reduce((s, l) => s + l.subtotal, 0) * 100) / 100;
    const cantidadTotal = () => lineas().reduce((s, l) => s + l.cantidad, 0);

    /* -- Acciones de la canasta -- */
    function agregar(id) {
        if (!productos.has(id)) return aviso('No hay conexión con el servidor. Enciéndelo con: node server.js', true);
        if ((canasta[id] || 0) >= MAX_POR_PRODUCTO) return aviso(`Máximo ${MAX_POR_PRODUCTO} por producto`, true);
        canasta[id] = (canasta[id] || 0) + 1;
        guardar(); pintar();
        aviso(`${productos.get(id).nombre_producto} agregado a tu canasta`);
        const b = $('#btnCarrito');
        b.classList.remove('rebote'); void b.offsetWidth; b.classList.add('rebote');
    }
    function cambiar(id, delta) {
        const nueva = (canasta[id] || 0) + delta;
        if (nueva <= 0) delete canasta[id];
        else if (nueva > MAX_POR_PRODUCTO) return aviso(`Máximo ${MAX_POR_PRODUCTO} por producto`, true);
        else canasta[id] = nueva;
        guardar(); pintar();
    }
    function vaciar() { canasta = {}; guardar(); pintar(); }

    /* -- Pintar pantalla -- */
    function pintar() {
        const ls = lineas();
        const n = cantidadTotal();

        const contador = $('#carritoContador');
        contador.textContent = n;
        contador.classList.toggle('vacio', n === 0);

        $('#listaCarrito').innerHTML = ls.length
            ? ls.map(l => `
                <div class="item-carrito">
                    <div>
                        <div class="nombre">${esc(l.nombre)}</div>
                        <div class="precio-unit">${dinero(l.precio)} c/u</div>
                    </div>
                    <div class="subtotal">${dinero(l.subtotal)}</div>
                    <div class="cantidad-ctl">
                        <button type="button" data-accion="menos" data-id="${l.id}" aria-label="Quitar uno"><i class="bi bi-dash"></i></button>
                        <span class="n">${l.cantidad}</span>
                        <button type="button" data-accion="mas" data-id="${l.id}" aria-label="Agregar uno"><i class="bi bi-plus"></i></button>
                    </div>
                    <div class="text-end">
                        <button type="button" class="btn btn-sm text-secondary p-0" data-accion="quitar" data-id="${l.id}"><i class="bi bi-trash3"></i> Quitar</button>
                    </div>
                </div>`).join('')
            : `<div class="carrito-vacio"><i class="bi bi-basket3"></i>Tu canasta está vacía.<br>Toca el botón <b class="text-danger">+</b> de un producto del menú.</div>`;

        const t = dinero(total());
        $('#totalCarrito').textContent = t;
        $('#totalConfirmar').textContent = t;
        $('#btnContinuar').disabled = ls.length === 0;
        $('#btnVaciar').classList.toggle('d-none', ls.length === 0);
    }

    /* -- Pasos del panel: canasta -> datos -> listo -- */
    function irA(paso) {
        $('#pasoCanasta').classList.toggle('d-none', paso !== 'canasta');
        $('#formPedido').classList.toggle('d-none', paso !== 'datos');
        $('#pasoListo').classList.toggle('d-none', paso !== 'listo');
        $('#tituloCarrito').textContent = paso === 'datos' ? 'TUS DATOS' : paso === 'listo' ? '¡PEDIDO ENVIADO!' : 'TU CANASTA';
        $('#errorPedido').classList.add('d-none');
    }

    function actualizarTipoEntrega() {
        const esDelivery = document.querySelector('input[name="tipo_entrega"]:checked').value === 'Delivery';
        $('#campoDireccion').classList.toggle('d-none', !esDelivery);
        $('#direccion').required = esDelivery;
    }

    function actualizarMetodoPago() {
        const pago = $('#metodoPago').value;
        $('#pagoQR').classList.toggle('d-none', pago !== 'QR');
    }

    async function enviarPedido(e) {
        e.preventDefault();
        const form = $('#formPedido');
        if (!form.checkValidity()) { form.classList.add('was-validated'); return; }

        const boton = $('#btnConfirmar');
        const error = $('#errorPedido');
        error.classList.add('d-none');

        const datos = {
            cliente: { nombre: $('#nombreCliente').value.trim(), telefono: $('#telefonoCliente').value.trim() },
            tipo_entrega: document.querySelector('input[name="tipo_entrega"]:checked').value,
            direccion: $('#direccion').value.trim(),
            metodo_pago: $('#metodoPago').value,
            notas: $('#notasPedido').value.trim(),
            items: lineas().map(l => ({ id_producto: l.id, cantidad: l.cantidad }))
        };

        boton.disabled = true;
        boton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Enviando...';
        try {
            const r = await fetch(`${API}/pedidos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || 'No se pudo enviar el pedido.');

            try { localStorage.setItem(CLAVE_CLIENTE, JSON.stringify(datos.cliente)); } catch { /* nada */ }
            $('#numPedidoListo').textContent = '#' + j.num_pedido;
            $('#totalPedidoListo').textContent = dinero(j.total);
            $('#mensajeListo').textContent = datos.tipo_entrega === 'Delivery'
                ? 'Lo llevaremos a tu dirección. Te llamaremos si necesitamos confirmar algo.'
                : datos.tipo_entrega === 'Recoger'
                    ? 'Te avisaremos cuando esté listo para recoger.'
                    : 'Lo prepararemos para que lo disfrutes en el local.';
            vaciar();
            irA('listo');
        } catch (err) {
            error.textContent = err instanceof TypeError ? 'No se pudo conectar con el servidor.' : err.message;
            error.classList.remove('d-none');
        } finally {
            boton.disabled = false;
            boton.innerHTML = 'Confirmar pedido';
        }
    }

    /* -- Acceso de administrador -- */
    async function iniciarSesionAdmin(e) {
        e.preventDefault();
        const error = $('#loginError');
        error.classList.add('d-none');
        try {
            const r = await fetch(`${API}/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario: $('#adminUser').value.trim(), password: $('#adminPass').value })
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || 'No se pudo iniciar sesión.');
            sessionStorage.setItem('cc_admin_token', j.token);
            window.location.href = 'admin.html';
        } catch (err) {
            error.textContent = err instanceof TypeError ? 'No se pudo conectar con el servidor.' : err.message;
            error.classList.remove('d-none');
        }
    }

    /* -- Disponibilidad del menú -- */
    async function actualizarDisponibilidadMenu() {
        try {
            const r = await fetch(`${API}/menu-estado`);
            if (!r.ok) return;
            const estado = await r.json(); 
            let seQuitoAlgo = false;
            estado.forEach(p => {
                const boton = document.querySelector(`.btn-agregar[data-id="${p.id_producto}"]`);
                if (!boton) return;
                const tarjeta = boton.closest('.menu-card');
                const agotado = !p.disponible;
                if (tarjeta) tarjeta.classList.toggle('agotado', agotado);
                boton.disabled = agotado;
                if (agotado && canasta[p.id_producto]) { delete canasta[p.id_producto]; seQuitoAlgo = true; }
            });
            if (seQuitoAlgo) { guardar(); pintar(); aviso('Un producto de tu canasta se agotó y fue quitado.', true); }
        } catch { /* si falla, el menú se queda como estaba */ }
    }

    /* -- Arranque -- */
    async function iniciar() {
        // Botones "+" del menú
        document.addEventListener('click', (e) => {
            const b = e.target.closest('.btn-agregar');
            if (b) agregar(Number(b.dataset.id));
        });
        // Botones dentro de la canasta
        $('#listaCarrito').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-accion]');
            if (!b) return;
            const id = Number(b.dataset.id);
            if (b.dataset.accion === 'mas') cambiar(id, 1);
            if (b.dataset.accion === 'menos') cambiar(id, -1);
            if (b.dataset.accion === 'quitar') cambiar(id, -MAX_POR_PRODUCTO);
        });
        $('#btnVaciar').addEventListener('click', vaciar);
        $('#btnContinuar').addEventListener('click', () => irA('datos'));
        $('#btnVolver').addEventListener('click', () => irA('canasta'));
        $('#btnSeguir').addEventListener('click', () => { irA('canasta'); bootstrap.Offcanvas.getOrCreateInstance($('#panelCarrito')).hide(); });
        $('#formPedido').addEventListener('submit', enviarPedido);
        document.querySelectorAll('input[name="tipo_entrega"]').forEach(r => r.addEventListener('change', actualizarTipoEntrega));
        $('#metodoPago').addEventListener('change', actualizarMetodoPago);
        $('#panelCarrito').addEventListener('show.bs.offcanvas', () => { if (!$('#pasoListo').classList.contains('d-none')) irA('canasta'); });
        $('#formLogin').addEventListener('submit', iniciarSesionAdmin);

        // Recordar datos del cliente
        const c = leer(CLAVE_CLIENTE, null);
        if (c) { $('#nombreCliente').value = c.nombre || ''; $('#telefonoCliente').value = c.telefono || ''; }
        actualizarTipoEntrega();
        actualizarMetodoPago();
        pintar();

        // Cargar precios reales desde la base de datos
        try {
            const r = await fetch(`${API}/productos`);
            if (!r.ok) throw new Error();
            (await r.json()).forEach(p => productos.set(p.id_producto, p));
            // Quitar de la canasta productos que ya no existen
            Object.keys(canasta).forEach(id => { if (!productos.has(Number(id))) delete canasta[id]; });
            guardar(); pintar();
        } catch {
            console.warn('No se pudieron cargar los productos. ¿Está encendido el servidor (npm start)?');
        }

        actualizarDisponibilidadMenu();
        setInterval(actualizarDisponibilidadMenu, 60000); // revisa agotados cada minuto
    }

    document.addEventListener('DOMContentLoaded', iniciar);
})();
