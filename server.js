
//  CRAZY CHICKEN - Servidor (Express + SQLite)

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Acceso del administrador
const ADMIN_USER = process.env.ADMIN_USER || 'admin@crazychicken';
const ADMIN_PASS = process.env.ADMIN_PASS || '12345';

app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

//  Base de datos
const db = new sqlite3.Database(path.join(__dirname, 'crazy_chicken.db'), (err) => {
    if (err) console.error('Error al conectar con SQLite:', err.message);
});
const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes });
    });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});
const exec = (sql) => new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
});

// Una transacción a la vez: si algo falla, no se guarda NADA del pedido.
let cola = Promise.resolve();
function enTransaccion(fn) {
    const trabajo = cola.then(async () => {
        await run('BEGIN');
        try {
            const resultado = await fn();
            await run('COMMIT');
            return resultado;
        } catch (e) {
            await run('ROLLBACK');
            throw e;
        }
    });
    cola = trabajo.catch(() => {});
    return trabajo;
}

class ErrorUsuario extends Error {
    constructor(mensaje, status = 400) { super(mensaje); this.status = status; }
}
function responderError(res, e) {
    if (e instanceof ErrorUsuario) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Error interno del servidor.' });
}

const redondear = (n) => Math.round(n * 100) / 100;
const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;
const hoy = () => {
    const d = new Date();
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
// Valida que la fecha exista de verdad en el calendario
const AÑO_MIN = 2020, AÑO_MAX = 2100;
function fechaValida(s) {
    if (!FECHA_OK.test(s || '')) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < AÑO_MIN || y > AÑO_MAX) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function leerRango(req) {
    let desde = fechaValida(req.query.desde) ? req.query.desde : hoy();
    let hasta = fechaValida(req.query.hasta) ? req.query.hasta : desde;
    if (hasta < desde) [desde, hasta] = [hasta, desde];
    return [desde, hasta];
}

const ESTADOS = ['Pendiente', 'En preparación', 'Listo', 'Entregado', 'Cancelado'];
const TIPOS = ['Recoger', 'Local', 'Delivery'];
const PAGOS = ['Efectivo', 'QR'];


//  API PÚBLICA (la usa la página web)
app.get('/api/categorias', async (req, res) => {
    try {
        res.json(await all('SELECT * FROM Categorias ORDER BY id_categoria'));
    } catch (e) { responderError(res, e); }
});
app.get('/api/productos', async (req, res) => {
    try {
        res.json(await all(`
            SELECT p.id_producto, p.nombre_producto, p.precio, p.id_categoria, c.nombre_categoria
            FROM Productos p
            JOIN Categorias c ON c.id_categoria = p.id_categoria
            WHERE p.disponible = 1
            ORDER BY p.id_producto`));
    } catch (e) { responderError(res, e); }
});

// Disponibilidad pública y liviana: para mostrar "Agotado" en el menú del cliente.
app.get('/api/menu-estado', async (req, res) => {
    try {
        res.json(await all('SELECT id_producto, disponible FROM Productos'));
    } catch (e) { responderError(res, e); }
});

// Crear un pedido desde la canasta
app.post('/api/pedidos', async (req, res) => {
    try {
        const b = req.body || {};
        const nombre = String((b.cliente && b.cliente.nombre) || '').trim();
        let telefono = String((b.cliente && b.cliente.telefono) || '').replace(/[\s\-+()]/g, '');
        if (telefono.startsWith('591') && telefono.length === 11) telefono = telefono.slice(3);
        const tipo = b.tipo_entrega || 'Recoger';
        const pago = b.metodo_pago || 'Efectivo';
        const direccion = String(b.direccion || '').trim();
        const notas = String(b.notas || '').trim().slice(0, 300);

        if (nombre.length < 2 || nombre.length > 80) throw new ErrorUsuario('Escribe tu nombre (2 a 80 letras).');
        if (!/^\d{7,12}$/.test(telefono)) throw new ErrorUsuario('Escribe un teléfono válido, solo números (ej. 71234567).');
        if (!TIPOS.includes(tipo)) throw new ErrorUsuario('Tipo de entrega no válido.');
        if (!PAGOS.includes(pago)) throw new ErrorUsuario('Método de pago no válido.');
        if (tipo === 'Delivery' && direccion.length < 5) throw new ErrorUsuario('Escribe la dirección para el delivery.');
        if (!Array.isArray(b.items) || b.items.length === 0) throw new ErrorUsuario('Tu canasta está vacía.');
        if (b.items.length > 50) throw new ErrorUsuario('Demasiados productos en un solo pedido.');

        const cantidades = new Map();
        for (const it of b.items) {
            const id = Number(it.id_producto);
            const cant = Number(it.cantidad);
            if (!Number.isInteger(id) || !Number.isInteger(cant) || cant < 1 || cant > 20) {
                throw new ErrorUsuario('Producto o cantidad no válidos (máximo 20 por producto).');
            }
            cantidades.set(id, (cantidades.get(id) || 0) + cant);
        }
        if ([...cantidades.values()].some(c => c > 20)) throw new ErrorUsuario('Máximo 20 unidades por producto.');

        const resultado = await enTransaccion(async () => {
            const ids = [...cantidades.keys()];
            const productos = await all(
                `SELECT id_producto, nombre_producto, precio FROM Productos
                 WHERE disponible = 1 AND id_producto IN (${ids.map(() => '?').join(',')})`, ids);
            if (productos.length !== ids.length) {
                throw new ErrorUsuario('Alguno de los productos ya no está disponible. Actualiza la página.');
            }

            let cliente = await get('SELECT id_cliente FROM Clientes WHERE telefono_cliente = ?', [telefono]);
            let idCliente;
            if (cliente) {
                idCliente = cliente.id_cliente;
                await run('UPDATE Clientes SET nombre_cliente = ? WHERE id_cliente = ?', [nombre, idCliente]);
            } else {
                idCliente = (await run(
                    'INSERT INTO Clientes (nombre_cliente, telefono_cliente) VALUES (?, ?)', [nombre, telefono])).lastID;
            }

            const lineas = productos.map(p => {
                const cantidad = cantidades.get(p.id_producto);
                return { ...p, cantidad, subtotal: redondear(p.precio * cantidad) };
            });
            const total = redondear(lineas.reduce((s, l) => s + l.subtotal, 0));

            const numPedido = (await run(
                `INSERT INTO Pedidos (id_cliente, tipo_entrega, direccion, metodo_pago, total, notas)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [idCliente, tipo, tipo === 'Delivery' ? direccion : null, pago, total, notas || null])).lastID;

            for (const l of lineas) {
                await run(
                    `INSERT INTO Detalle_Pedido (num_pedido, id_producto, cantidad, precio_unitario, subtotal)
                     VALUES (?, ?, ?, ?, ?)`,
                    [numPedido, l.id_producto, l.cantidad, l.precio, l.subtotal]);
            }
            return { num_pedido: numPedido, total, estado: 'Pendiente' };
        });

        res.status(201).json(resultado);
    } catch (e) { responderError(res, e); }
});


//  ADMINISTRADOR
const sesiones = new Map();
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();

app.post('/api/admin/login', async (req, res) => {
    const { usuario, password } = req.body || {};
    const okUser = crypto.timingSafeEqual(hash(usuario), hash(ADMIN_USER));
    const okPass = crypto.timingSafeEqual(hash(password), hash(ADMIN_PASS));
    if (!(okUser && okPass)) {
        await new Promise(r => setTimeout(r, 500));
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    sesiones.set(token, Date.now() + 8 * 60 * 60 * 1000);
    res.json({ token });
});
function requiereAdmin(req, res, next) {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const vence = sesiones.get(token);
    if (!vence || vence < Date.now()) {
        sesiones.delete(token);
        return res.status(401).json({ error: 'Sesión no válida. Inicia sesión otra vez.' });
    }
    next();
}

// Registro en vivo: pedidos de hoy 
app.get('/api/admin/registro', requiereAdmin, async (req, res) => {
    try {
        const filtroEstado = ESTADOS.includes(req.query.estado) ? req.query.estado : null;
        const params = [hoy()].concat(filtroEstado ? [filtroEstado] : []);
        const extra = filtroEstado ? 'AND p.estado = ?' : '';
        const pedidos = await all(`
            SELECT p.num_pedido, p.fecha_pedido, p.hora_pedido, p.tipo_entrega, p.direccion,
                   p.metodo_pago, p.estado, p.total, p.notas,
                   c.nombre_cliente, c.telefono_cliente
            FROM Pedidos p
            JOIN Clientes c ON c.id_cliente = p.id_cliente
            WHERE p.fecha_pedido = ? ${extra}
            ORDER BY p.num_pedido DESC`, params);
        const detalles = await all(`
            SELECT d.num_pedido, d.id_producto, pr.nombre_producto, d.cantidad, d.precio_unitario, d.subtotal
            FROM Detalle_Pedido d
            JOIN Pedidos p    ON p.num_pedido = d.num_pedido
            JOIN Productos pr ON pr.id_producto = d.id_producto
            WHERE p.fecha_pedido = ? ${extra}
            ORDER BY d.id_detalle`, params);
        const porPedido = new Map();
        detalles.forEach(d => {
            if (!porPedido.has(d.num_pedido)) porPedido.set(d.num_pedido, []);
            porPedido.get(d.num_pedido).push(d);
        });
        res.json(pedidos.map(p => ({ ...p, items: porPedido.get(p.num_pedido) || [] })));
    } catch (e) { responderError(res, e); }
});
function leerFiltroEstado(req) {
    return ESTADOS.includes(req.query.estado) ? req.query.estado : null;
}

// Lista de pedidos con sus productos, filtrable por rango de fechas y estado
app.get('/api/admin/pedidos', requiereAdmin, async (req, res) => {
    try {
        const [desde, hasta] = leerRango(req);
        const filtroEstado = leerFiltroEstado(req);
        const params = [desde, hasta].concat(filtroEstado ? [filtroEstado] : []);
        const extra = filtroEstado ? 'AND p.estado = ?' : '';

        const pedidos = await all(`
            SELECT p.num_pedido, p.fecha_pedido, p.hora_pedido, p.tipo_entrega, p.direccion,
                   p.metodo_pago, p.estado, p.total, p.notas,
                   c.nombre_cliente, c.telefono_cliente
            FROM Pedidos p
            JOIN Clientes c ON c.id_cliente = p.id_cliente
            WHERE p.fecha_pedido BETWEEN ? AND ? ${extra}
            ORDER BY p.num_pedido DESC
            LIMIT 500`, params);

        const detalles = await all(`
            SELECT d.num_pedido, d.id_producto, pr.nombre_producto, d.cantidad, d.precio_unitario, d.subtotal
            FROM Detalle_Pedido d
            JOIN Pedidos p    ON p.num_pedido = d.num_pedido
            JOIN Productos pr ON pr.id_producto = d.id_producto
            WHERE p.fecha_pedido BETWEEN ? AND ? ${extra}
            ORDER BY d.id_detalle`, params);

        const porPedido = new Map();
        detalles.forEach(d => {
            if (!porPedido.has(d.num_pedido)) porPedido.set(d.num_pedido, []);
            porPedido.get(d.num_pedido).push(d);
        });
        res.json(pedidos.map(p => ({ ...p, items: porPedido.get(p.num_pedido) || [] })));
    } catch (e) { responderError(res, e); }
});

// Cambiar el estado de un pedido
app.patch('/api/admin/pedidos/:num/estado', requiereAdmin, async (req, res) => {
    try {
        const num = Number(req.params.num);
        const estado = (req.body || {}).estado;
        if (!Number.isInteger(num)) throw new ErrorUsuario('Número de pedido no válido.');
        if (!ESTADOS.includes(estado)) throw new ErrorUsuario('Estado no válido.');
        const r = await run('UPDATE Pedidos SET estado = ? WHERE num_pedido = ?', [estado, num]);
        if (r.changes === 0) throw new ErrorUsuario('Ese pedido no existe.', 404);
        res.json({ num_pedido: num, estado });
    } catch (e) { responderError(res, e); }
});

// Modificar los productos de un pedido (cantidades, quitar o agregar productos)
app.put('/api/admin/pedidos/:num/items', requiereAdmin, async (req, res) => {
    try {
        const num = Number(req.params.num);
        if (!Number.isInteger(num)) throw new ErrorUsuario('Número de pedido no válido.');
        const items = (req.body || {}).items;
        if (!Array.isArray(items) || items.length === 0) throw new ErrorUsuario('El pedido debe tener al menos un producto.');
        if (items.length > 50) throw new ErrorUsuario('Demasiados productos en un solo pedido.');

        const cantidades = new Map();
        for (const it of items) {
            const id = Number(it.id_producto);
            const cant = Number(it.cantidad);
            if (!Number.isInteger(id) || !Number.isInteger(cant) || cant < 1 || cant > 20) {
                throw new ErrorUsuario('Producto o cantidad no válidos (máximo 20 por producto).');
            }
            cantidades.set(id, (cantidades.get(id) || 0) + cant);
        }

        const resultado = await enTransaccion(async () => {
            const existe = await get('SELECT num_pedido FROM Pedidos WHERE num_pedido = ?', [num]);
            if (!existe) throw new ErrorUsuario('Ese pedido no existe.', 404);

            const ids = [...cantidades.keys()];
            const productos = await all(
                `SELECT id_producto, precio FROM Productos WHERE id_producto IN (${ids.map(() => '?').join(',')})`, ids);
            if (productos.length !== ids.length) throw new ErrorUsuario('Alguno de esos productos ya no existe.');

            await run('DELETE FROM Detalle_Pedido WHERE num_pedido = ?', [num]);
            let total = 0;
            for (const p of productos) {
                const cantidad = cantidades.get(p.id_producto);
                const subtotal = redondear(p.precio * cantidad);
                total += subtotal;
                await run(
                    `INSERT INTO Detalle_Pedido (num_pedido, id_producto, cantidad, precio_unitario, subtotal)
                     VALUES (?, ?, ?, ?, ?)`, [num, p.id_producto, cantidad, p.precio, subtotal]);
            }
            total = redondear(total);
            await run('UPDATE Pedidos SET total = ? WHERE num_pedido = ?', [total, num]);
            return { num_pedido: num, total };
        });

        res.json(resultado);
    } catch (e) { responderError(res, e); }
});

// Eliminar un pedido por completo
app.delete('/api/admin/pedidos/:num', requiereAdmin, async (req, res) => {
    try {
        const num = Number(req.params.num);
        if (!Number.isInteger(num)) throw new ErrorUsuario('Número de pedido no válido.');
        await enTransaccion(async () => {
            await run('DELETE FROM Detalle_Pedido WHERE num_pedido = ?', [num]);
            const r = await run('DELETE FROM Pedidos WHERE num_pedido = ?', [num]);
            if (r.changes === 0) throw new ErrorUsuario('Ese pedido no existe.', 404);
        });
        res.json({ num_pedido: num, eliminado: true });
    } catch (e) { responderError(res, e); }
});

// Todos los productos, incluidos los agotados (para el panel de disponibilidad)
app.get('/api/admin/productos', requiereAdmin, async (req, res) => {
    try {
        res.json(await all(`
            SELECT p.id_producto, p.nombre_producto, p.precio, p.id_categoria, p.disponible, c.nombre_categoria
            FROM Productos p
            JOIN Categorias c ON c.id_categoria = p.id_categoria
            ORDER BY c.id_categoria, p.nombre_producto`));
    } catch (e) { responderError(res, e); }
});

// Marcar un producto como disponible o agotado
app.patch('/api/admin/productos/:id/disponibilidad', requiereAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) throw new ErrorUsuario('Producto no válido.');
        const disponible = (req.body || {}).disponible ? 1 : 0;
        const r = await run('UPDATE Productos SET disponible = ? WHERE id_producto = ?', [disponible, id]);
        if (r.changes === 0) throw new ErrorUsuario('Ese producto no existe.', 404);
        res.json({ id_producto: id, disponible: !!disponible });
    } catch (e) { responderError(res, e); }
});

// Resumen de ventas (los pedidos cancelados no cuentan)
app.get('/api/admin/resumen', requiereAdmin, async (req, res) => {
    try {
        const [desde, hasta] = leerRango(req);
        const p = [desde, hasta];
        const totales = await get(`
            SELECT COUNT(*) AS pedidos, COALESCE(SUM(total), 0) AS vendido
            FROM Pedidos WHERE fecha_pedido BETWEEN ? AND ? AND estado <> 'Cancelado'`, p);
        const activos = await get(`
            SELECT COUNT(*) AS n FROM Pedidos
            WHERE fecha_pedido BETWEEN ? AND ? AND estado IN ('Pendiente','En preparación')`, p);
        const porMetodo = await all(`
            SELECT metodo_pago AS etiqueta, SUM(total) AS valor FROM Pedidos
            WHERE fecha_pedido BETWEEN ? AND ? AND estado <> 'Cancelado'
            GROUP BY metodo_pago ORDER BY valor DESC`, p);
        const topProductos = await all(`
            SELECT pr.nombre_producto AS etiqueta, SUM(d.cantidad) AS valor
            FROM Detalle_Pedido d
            JOIN Pedidos p    ON p.num_pedido = d.num_pedido
            JOIN Productos pr ON pr.id_producto = d.id_producto
            WHERE p.fecha_pedido BETWEEN ? AND ? AND p.estado <> 'Cancelado'
            GROUP BY pr.id_producto ORDER BY valor DESC LIMIT 6`, p);
        const porDia = await all(`
            SELECT fecha_pedido AS etiqueta, SUM(total) AS valor FROM Pedidos
            WHERE fecha_pedido BETWEEN ? AND ? AND estado <> 'Cancelado'
            GROUP BY fecha_pedido ORDER BY fecha_pedido`, p);

        res.json({
            desde, hasta,
            pedidos: totales.pedidos,
            vendido: redondear(totales.vendido),
            ticket_promedio: totales.pedidos ? redondear(totales.vendido / totales.pedidos) : 0,
            en_curso: activos.n,
            porMetodo, topProductos, porDia
        });
    } catch (e) { responderError(res, e); }
});


//  Errores generales
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido.' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor.' });
});

//  Arranque: crea las tablas (si faltan) y enciende el servidor
(async () => {
    try {
        await exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
        console.log('Base de datos lista.');
        app.listen(PORT, () => console.log(`Crazy Chicken en http://localhost:${PORT}`));
    } catch (e) {
        console.error('No se pudo iniciar la base de datos:', e.message);
        process.exit(1);
    }
})();
