(() => {
    'use strict';

    const API = window.location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api';
    const CLAVE_TOKEN = 'cc_admin_token';
    const token = sessionStorage.getItem(CLAVE_TOKEN);
    if (!token) { window.location.replace('index.html'); return; }

    const ESTADOS = ['Pendiente', 'En preparación', 'Listo', 'Entregado', 'Cancelado'];
    const CLASE = { 'Pendiente': 'pendiente', 'En preparación': 'preparacion', 'Listo': 'listo', 'Entregado': 'entregado', 'Cancelado': 'cancelado' };
    const MAX_POR_PRODUCTO = 20;

    const $ = (s) => document.querySelector(s);
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dinero = (n) => 'Bs. ' + (Number.isInteger(n) ? n : Number(n).toFixed(2));
    const iso = (d) => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const HOY = iso(new Date());
    const FECHA_MIN = '2024-01-01'; // el negocio no tiene ventas antes de esta fecha

    function salir() {
        sessionStorage.removeItem(CLAVE_TOKEN);
        window.location.replace('index.html');
    }

    async function api(ruta, opciones = {}) {
        const r = await fetch(API + '/admin' + ruta, {
            ...opciones,
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
        });
        if (r.status === 401) { salir(); throw new Error('Sesión vencida'); }
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Error del servidor');
        return j;
    }

    let temporizador;
    function aviso(texto) {
        const a = $('#avisoAdmin');
        a.textContent = texto; a.classList.add('on');
        clearTimeout(temporizador);
        temporizador = setTimeout(() => a.classList.remove('on'), 2600);
    }

    function barras(filas, formato) {
        if (!filas.length) return '<div class="vacio">Sin datos en este periodo.</div>';
        const max = Math.max(...filas.map(f => f.valor)) || 1;
        return filas.map(f => `
            <div class="barra">
                <span>${esc(f.etiqueta)}</span><strong>${formato(f.valor)}</strong>
                <div class="pista"><div class="relleno" style="width:${(f.valor / max * 100).toFixed(1)}%"></div></div>
            </div>`).join('');
    }

    /* -- Validación de fechas-- */
    function fechaRealValida(s) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
        const [y, m, d] = s.split('-').map(Number);
        if (y < 2020 || y > 2100) return false;
        const dt = new Date(y, m - 1, d);
        return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
    }
    function validarRango(idDesde, idHasta, idError) {
        const elD = $(idDesde), elH = $(idHasta), elErr = $(idError);
        let ok = true, msg = '';
        if (!fechaRealValida(elD.value)) { ok = false; msg = 'La fecha "Desde" no es válida.'; }
        else if (!fechaRealValida(elH.value)) { ok = false; msg = 'La fecha "Hasta" no es válida.'; }
        else if (elH.value > HOY || elD.value > HOY) { ok = false; msg = 'No se pueden pedir fechas futuras.'; }
        else if (elD.value > elH.value) { ok = false; msg = '"Desde" no puede ser posterior a "Hasta".'; }
        elErr.classList.toggle('d-none', ok);
        if (!ok) elErr.textContent = msg;
        return ok;
    }
    function limitarFechas(...ids) {
        ids.forEach(id => { $(id).min = FECHA_MIN; $(id).max = HOY; });
    }

    /* ==NAVEGACIÓN ENTRE SECCIONES== */
    let tabActual = 'registro';
    function irATab(tab) {
        tabActual = tab;
        document.querySelectorAll('.tab-panel').forEach(s => s.classList.toggle('d-none', s.id !== 'tab-' + tab));
        document.querySelectorAll('#tabsAdmin button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
        if (tab === 'registro') gestorRegistro.cargar();
        if (tab === 'ventas') cargarVentas();
        if (tab === 'informe') cargarInforme();
    }
    $('#tabsAdmin').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-tab]');
        if (b) irATab(b.dataset.tab);
    });

    /* ==CATÁLOGO DE PRODUCTOS== */
    let catalogo = [];
    async function cargarCatalogo() {
        try {
            const r = await fetch(`${API}/productos`);
            catalogo = r.ok ? await r.json() : [];
        } catch { catalogo = []; }
    }

    /* ==COMPONENTE REUTILIZABLE: lista de pedidos editable. Lo usan tanto "Registro" como "Control de Ventas".== */
    function crearGestorPedidos({ contenedorId, endpoint, obtenerFiltros, enVivo }) {
        const contenedor = $(contenedorId);
        let pedidos = [];
        let edicionNum = null;
        let borrador = null;
        let mayorVisto = null;

        function filaEdicion(idProd, nombre, precio, cantidad) {
            return `
                <div class="fila" data-id="${idProd}">
                    <span>${esc(nombre)} <small class="text-secondary">(${dinero(precio)} c/u)</small></span>
                    <span class="cantidad-ctl">
                        <button type="button" data-accion="menos" data-id="${idProd}" aria-label="Quitar uno">−</button>
                        <strong>${cantidad}</strong>
                        <button type="button" data-accion="mas" data-id="${idProd}" aria-label="Agregar uno">+</button>
                    </span>
                    <button type="button" class="btn btn-sm text-danger" data-accion="quitar" data-id="${idProd}"><i class="bi bi-trash3"></i></button>
                </div>`;
        }

        function pintarEdicion(numPedido) {
            const filas = [...borrador.entries()].map(([id, cant]) => {
                const p = catalogo.find(x => x.id_producto === id);
                return p ? filaEdicion(id, p.nombre_producto, p.precio, cant) : '';
            }).join('') || '<p class="text-secondary small">Sin productos. Agrega uno abajo.</p>';

            const disponibles = catalogo.filter(p => !borrador.has(p.id_producto));
            const opciones = disponibles.map(p => `<option value="${p.id_producto}">${esc(p.nombre_producto)} — ${dinero(p.precio)}</option>`).join('');
            const total = [...borrador.entries()].reduce((s, [id, cant]) => {
                const p = catalogo.find(x => x.id_producto === id);
                return s + (p ? p.precio * cant : 0);
            }, 0);

            return `
                <div class="edicion" data-num="${numPedido}">
                    ${filas}
                    <div class="agregar">
                        <select class="form-select form-select-sm" data-rol="nuevoProducto">
                            <option value="">${disponibles.length ? 'Agregar producto…' : 'No hay más productos para agregar'}</option>
                            ${opciones}
                        </select>
                        <button type="button" class="btn btn-sm btn-outline-warning" data-accion="agregarProducto">Agregar</button>
                    </div>
                    <div class="d-flex justify-content-between align-items-center mt-3">
                        <strong>Nuevo total: <span class="text-warning">${dinero(Math.round(total * 100) / 100)}</span></strong>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-sm btn-warning fw-bold" data-accion="guardarEdicion">Guardar cambios</button>
                            <button type="button" class="btn btn-sm btn-outline-light" data-accion="cancelarEdicion">Cancelar</button>
                        </div>
                    </div>
                </div>`;
        }

        function tarjeta(p) {
            const enEdicion = edicionNum === p.num_pedido;
            return `
                <article class="pedido est-${CLASE[p.estado]}" data-num="${p.num_pedido}">
                    <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                        <div>
                            <span class="num">#${p.num_pedido}</span>
                            <span class="text-secondary ms-2">${p.fecha_pedido.split('-').reverse().join('/')} · ${esc(p.hora_pedido)}</span>
                        </div>
                        <select class="form-select form-select-sm sel-estado" data-num="${p.num_pedido}" aria-label="Estado del pedido ${p.num_pedido}">
                            ${ESTADOS.map(e => `<option ${e === p.estado ? 'selected' : ''}>${e}</option>`).join('')}
                        </select>
                    </div>
                    <div class="mt-1"><strong>${esc(p.nombre_cliente)}</strong> · <a class="text-warning" href="tel:${esc(p.telefono_cliente)}">${esc(p.telefono_cliente)}</a></div>
                    <div class="mt-1">
                        <span class="chip ${p.tipo_entrega === 'Delivery' ? 'delivery' : ''}">${esc(p.tipo_entrega)}</span>
                        <span class="chip">${esc(p.metodo_pago)}</span>
                        ${p.direccion ? `<small class="text-secondary"><i class="bi bi-geo-alt"></i> ${esc(p.direccion)}</small>` : ''}
                    </div>

                    ${enEdicion ? pintarEdicion(p.num_pedido) : `
                        <ul class="items">
                            ${p.items.map(i => `<li><span><span class="cant">${i.cantidad}×</span>${esc(i.nombre_producto)}</span><span class="text-secondary">${dinero(i.subtotal)}</span></li>`).join('')}
                        </ul>
                        ${p.notas ? `<div class="small text-warning mb-2"><i class="bi bi-chat-left-text"></i> ${esc(p.notas)}</div>` : ''}
                        <div class="text-end fs-5 fw-bold">Total: <span class="text-warning">${dinero(p.total)}</span></div>
                        <div class="pedido-acciones">
                            <button type="button" class="btn btn-sm btn-outline-warning" data-accion="editarPedido" data-num="${p.num_pedido}"><i class="bi bi-pencil"></i> Editar productos</button>
                            <button type="button" class="btn btn-sm btn-outline-danger" data-accion="eliminarPedido" data-num="${p.num_pedido}"><i class="bi bi-trash3"></i> Eliminar pedido</button>
                        </div>
                    `}
                </article>`;
        }

        function pintar() {
            contenedor.innerHTML = pedidos.length
                ? pedidos.map(tarjeta).join('')
                : '<div class="panel vacio">No hay pedidos para mostrar.</div>';
        }

        async function cargar() {
            const qs = obtenerFiltros ? obtenerFiltros() : '';
            if (qs === null) return; // fechas inválidas: no se consulta
            try {
                pedidos = await api(endpoint + (qs ? '?' + qs : ''));
                if (edicionNum === null) pintar();
                if (enVivo) {
                    const mayor = pedidos.reduce((m, p) => Math.max(m, p.num_pedido), 0);
                    if (mayorVisto !== null && mayor > mayorVisto) aviso('¡Llegó un pedido nuevo! #' + mayor);
                    mayorVisto = Math.max(mayorVisto ?? 0, mayor);
                }
            } catch (e) {
                if (e.message !== 'Sesión vencida') contenedor.innerHTML = `<div class="panel vacio text-danger">${esc(e.message)}</div>`;
            }
            return pedidos;
        }

        function empezarEdicion(num) {
            const p = pedidos.find(x => x.num_pedido === num);
            if (!p) return;
            edicionNum = num;
            borrador = new Map(p.items.map(i => [i.id_producto, i.cantidad]));
            pintar();
        }
        function cancelarEdicion() { edicionNum = null; borrador = null; pintar(); }

        async function guardarEdicion(num) {
            if (borrador.size === 0) return aviso('El pedido debe tener al menos un producto.');
            try {
                await api(`/pedidos/${num}/items`, {
                    method: 'PUT',
                    body: JSON.stringify({ items: [...borrador.entries()].map(([id_producto, cantidad]) => ({ id_producto, cantidad })) })
                });
                aviso(`Pedido #${num} actualizado`);
                edicionNum = null; borrador = null;
                await sincronizarTodo();
            } catch (e) { aviso(e.message); }
        }
        async function eliminar(num) {
            if (!confirm(`¿Eliminar el pedido #${num}? Esta acción no se puede deshacer.`)) return;
            try {
                await api(`/pedidos/${num}`, { method: 'DELETE' });
                aviso(`Pedido #${num} eliminado`);
                if (edicionNum === num) { edicionNum = null; borrador = null; }
                await sincronizarTodo();
            } catch (e) { aviso(e.message); }
        }

        contenedor.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-accion]');
            if (!b) return;
            const num = Number(b.dataset.num || b.closest('.edicion')?.dataset.num);
            const idProd = Number(b.dataset.id);

            if (b.dataset.accion === 'editarPedido') return empezarEdicion(num);
            if (b.dataset.accion === 'cancelarEdicion') return cancelarEdicion();
            if (b.dataset.accion === 'eliminarPedido') return eliminar(num);
            if (b.dataset.accion === 'guardarEdicion') return guardarEdicion(num);

            if (b.dataset.accion === 'mas') {
                if ((borrador.get(idProd) || 0) >= MAX_POR_PRODUCTO) return aviso(`Máximo ${MAX_POR_PRODUCTO} por producto`);
                borrador.set(idProd, (borrador.get(idProd) || 0) + 1);
                return pintar();
            }
            if (b.dataset.accion === 'menos' || b.dataset.accion === 'quitar') {
                const nueva = b.dataset.accion === 'quitar' ? 0 : (borrador.get(idProd) || 0) - 1;
                if (nueva <= 0) borrador.delete(idProd); else borrador.set(idProd, nueva);
                return pintar();
            }
            if (b.dataset.accion === 'agregarProducto') {
                const sel = b.parentElement.querySelector('[data-rol="nuevoProducto"]');
                const id = Number(sel.value);
                if (!id) return aviso('Elige un producto de la lista.');
                borrador.set(id, (borrador.get(id) || 0) + 1);
                return pintar();
            }
        });

        contenedor.addEventListener('change', async (e) => {
            const sel = e.target.closest('.sel-estado');
            if (!sel) return;
            try {
                await api(`/pedidos/${sel.dataset.num}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: sel.value }) });
                aviso(`Pedido #${sel.dataset.num}: ${sel.value}`);
            } catch (err) { aviso(err.message); }
            await sincronizarTodo();
        });

        return {
            cargar,
            estaEditando: () => edicionNum !== null,
            obtenerPedidos: () => pedidos
        };
    }

    /* ==DISPONIBILIDAD DEL MENÚ (marcar productos como agotados)== */
    function tarjetaDisponibilidad(p) {
        const agotado = !p.disponible;
        return `
            <div class="prod-disp ${agotado ? 'agotado' : ''}" data-id="${p.id_producto}">
                <div class="info">
                    <div class="nombre">${esc(p.nombre_producto)}</div>
                    <div class="precio">${dinero(p.precio)} · ${esc(p.nombre_categoria)}</div>
                </div>
                <label class="switch-disp" title="${agotado ? 'Marcar disponible' : 'Marcar agotado'}">
                    <input type="checkbox" data-id="${p.id_producto}" ${agotado ? '' : 'checked'}>
                    <span class="slider"></span>
                </label>
            </div>`;
    }
    async function cargarDisponibilidad() {
        try {
            const productos = await api('/productos');
            $('#gridDisponibilidad').innerHTML = productos.length
                ? productos.map(tarjetaDisponibilidad).join('')
                : '<div class="vacio">No hay productos en el menú.</div>';
            $('#ultimaActMenu').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            if (e.message !== 'Sesión vencida') aviso(e.message);
        }
    }
    $('#gridDisponibilidad').addEventListener('change', async (e) => {
        const chk = e.target.closest('input[type="checkbox"]');
        if (!chk) return;
        const id = Number(chk.dataset.id);
        const disponible = chk.checked;
        const tarjeta = chk.closest('.prod-disp');
        try {
            await api(`/productos/${id}/disponibilidad`, { method: 'PATCH', body: JSON.stringify({ disponible }) });
            tarjeta.classList.toggle('agotado', !disponible);
            aviso(disponible ? 'Producto marcado como disponible' : 'Producto marcado como agotado');
            cargarCatalogo(); // refresca la lista de "agregar producto" al editar pedidos
        } catch (err) {
            chk.checked = !disponible; // revertir el interruptor si falló
            aviso(err.message);
        }
    });

    /* ==SECCIÓN 1: REGISTRO== */
    const gestorRegistro = crearGestorPedidos({
        contenedorId: '#listaRegistro',
        endpoint: '/registro',
        enVivo: true,
        obtenerFiltros: () => {
            const q = new URLSearchParams();
            if ($('#filtroEstadoRegistro').value) q.set('estado', $('#filtroEstadoRegistro').value);
            return q.toString();
        }
    });
    $('#filtroEstadoRegistro').addEventListener('change', () => gestorRegistro.cargar());

    /* ==SECCIÓN 2: CONTROL DE VENTAS== */
    function ponerRangoVentas(rango) {
        const hoyD = new Date();
        $('#hastaVentas').value = HOY;
        if (rango === 'hoy') $('#desdeVentas').value = HOY;
        if (rango === '7') $('#desdeVentas').value = iso(new Date(hoyD.getTime() - 6 * 86400000));
        if (rango === 'mes') $('#desdeVentas').value = iso(new Date(hoyD.getFullYear(), hoyD.getMonth(), 1));
    }
    const ventasIncluyeHoy = () => $('#hastaVentas').value === HOY;

    const gestorVentas = crearGestorPedidos({
        contenedorId: '#listaVentas',
        endpoint: '/pedidos',
        enVivo: true,
        obtenerFiltros: () => {
            if (!validarRango('#desdeVentas', '#hastaVentas', '#errorFechaVentas')) return null;
            const q = new URLSearchParams({ desde: $('#desdeVentas').value, hasta: $('#hastaVentas').value });
            if ($('#estadoVentas').value) q.set('estado', $('#estadoVentas').value);
            return q.toString();
        }
    });

    function pintarResumenVentas(r) {
        $('#kpisVentas').innerHTML = [
            [dinero(r.vendido), 'Total vendido'],
            [r.pedidos, 'Pedidos (sin cancelados)'],
            [dinero(r.ticket_promedio), 'Ticket promedio'],
            [r.en_curso, 'En curso (pendientes / preparando)']
        ].map(([v, e]) => `<div class="col-6 col-lg-3"><div class="kpi"><div class="valor">${v}</div><div class="etiqueta">${e}</div></div></div>`).join('');
        $('#repMetodo').innerHTML = barras(r.porMetodo, dinero);
        $('#repTop').innerHTML = barras(r.topProductos, n => n + ' uds');
        $('#repDia').innerHTML = barras(r.porDia.map(d => ({ etiqueta: d.etiqueta.split('-').reverse().join('/'), valor: d.valor })), dinero);
    }

    async function cargarVentas() {
        if (!validarRango('#desdeVentas', '#hastaVentas', '#errorFechaVentas')) return;
        await gestorVentas.cargar();
        try {
            const q = new URLSearchParams({ desde: $('#desdeVentas').value, hasta: $('#hastaVentas').value });
            const resumen = await api('/resumen?' + q);
            pintarResumenVentas(resumen);
            const vivo = ventasIncluyeHoy() ? '🟢 En vivo · ' : '';
            $('#ultimaActVentas').textContent = vivo + 'Actualizado ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            if (e.message !== 'Sesión vencida') aviso(e.message);
        }
    }

    $('#filtrosVentas').addEventListener('submit', (e) => { e.preventDefault(); cargarVentas(); });
    document.querySelectorAll('[data-rango-ventas]').forEach(b => b.addEventListener('click', () => { ponerRangoVentas(b.dataset.rangoVentas); cargarVentas(); }));

    /* ==¡SECCIÓN 3: INFORME DE VENTAS== */
    function ponerRangoInforme() {
        $('#hastaInforme').value = HOY;
        $('#desdeInforme').value = HOY;
    }
    const informeIncluyeHoy = () => $('#hastaInforme').value === HOY;

    function pintarInforme(pedidos, resumen, desde, hasta) {
        $('#cabezaInforme').innerHTML = `
            <h2 class="h5 fw-bold mb-1">Informe de ventas</h2>
            <p class="text-secondary mb-0">Del ${desde.split('-').reverse().join('/')} al ${hasta.split('-').reverse().join('/')}</p>`;

        $('#kpisInforme').innerHTML = [
            [dinero(resumen.vendido), 'Total vendido'],
            [resumen.pedidos, 'Pedidos registrados'],
            [dinero(resumen.ticket_promedio), 'Ticket promedio']
        ].map(([v, e]) => `<div class="col-6 col-lg-4"><div class="kpi"><div class="valor">${v}</div><div class="etiqueta">${e}</div></div></div>`).join('');

        const filas = pedidos.length
            ? pedidos.slice().reverse().map(p => `
                <tr>
                    <td>#${p.num_pedido}</td>
                    <td>${p.fecha_pedido.split('-').reverse().join('/')}</td>
                    <td>${esc(p.hora_pedido)}</td>
                    <td>${esc(p.nombre_cliente)}</td>
                    <td>${esc(p.tipo_entrega)}</td>
                    <td>${esc(p.metodo_pago)}</td>
                    <td>${esc(p.estado)}</td>
                    <td class="num">${dinero(p.total)}</td>
                </tr>`).join('')
            : `<tr><td colspan="8" class="text-center text-secondary py-3">No hay ventas registradas en este periodo.</td></tr>`;

        $('#tablaInforme').innerHTML = `
            <thead><tr>
                <th>Pedido</th><th>Fecha</th><th>Hora</th><th>Cliente</th><th>Entrega</th><th>Pago</th><th>Estado</th><th class="num">Total</th>
            </tr></thead>
            <tbody>${filas}</tbody>
            <tfoot><tr><td colspan="7">Total del periodo</td><td class="num">${dinero(resumen.vendido)}</td></tr></tfoot>`;
    }

    async function cargarInforme() {
        if (!validarRango('#desdeInforme', '#hastaInforme', '#errorFechaInforme')) return;
        const desde = $('#desdeInforme').value, hasta = $('#hastaInforme').value;
        const q = new URLSearchParams({ desde, hasta });
        try {
            const [pedidos, resumen] = await Promise.all([api('/pedidos?' + q), api('/resumen?' + q)]);
            pintarInforme(pedidos, resumen, desde, hasta);
            const vivo = informeIncluyeHoy() ? '🟢 En vivo · ' : '';
            $('#ultimaActInforme').textContent = vivo + 'Actualizado ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        } catch (err) {
            if (err.message !== 'Sesión vencida') aviso(err.message);
        }
    }
    $('#filtrosInforme').addEventListener('submit', (e) => { e.preventDefault(); cargarInforme(); });
    $('#btnImprimir').addEventListener('click', () => window.print());

    /* ==SINCRONIZACIÓN: un cambio en cualquier sección refresca las otras dos.== */
    async function sincronizarTodo() {
        await Promise.allSettled([
            gestorRegistro.cargar(),
            cargarVentas(),
            cargarInforme()
        ]);
    }

    /* ==ARRANQUE== */
    $('#btnSalir').addEventListener('click', salir);
    limitarFechas('#desdeVentas', '#hastaVentas', '#desdeInforme', '#hastaInforme');
    ponerRangoVentas('hoy');
    ponerRangoInforme();

    (async () => {
        await cargarCatalogo();
        await cargarDisponibilidad();
        irATab('registro');
    })();

    // Actualización automática cada 15 s: Registro siempre; Ventas e Informe
    // solo cuando su rango de fechas incluye el día de hoy (eso es lo "en vivo").
    setInterval(() => {
        const enfocado = document.activeElement;
        const escribiendo = enfocado && (enfocado.tagName === 'SELECT' || enfocado.tagName === 'INPUT');
        if (escribiendo) return;

        if (tabActual === 'registro' && !gestorRegistro.estaEditando()) gestorRegistro.cargar();
        if (tabActual === 'ventas' && !gestorVentas.estaEditando() && ventasIncluyeHoy()) cargarVentas();
        if (tabActual === 'informe' && informeIncluyeHoy()) cargarInforme();
    }, 15000);
})();
