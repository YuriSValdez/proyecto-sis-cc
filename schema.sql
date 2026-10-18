
--  CRAZY CHICKEN - Esquema de base de datos (SQLite)
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS Categorias (
    id_categoria      INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_categoria  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS Productos (
    id_producto      INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_producto  TEXT NOT NULL,
    precio           REAL NOT NULL CHECK (precio >= 0),
    id_categoria     INTEGER NOT NULL REFERENCES Categorias(id_categoria),
    disponible       INTEGER NOT NULL DEFAULT 1 CHECK (disponible IN (0, 1))
);

CREATE TABLE IF NOT EXISTS Clientes (
    id_cliente        INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_cliente    TEXT NOT NULL,
    telefono_cliente  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS Pedidos (
    num_pedido    INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente    INTEGER NOT NULL REFERENCES Clientes(id_cliente),
    fecha_pedido  TEXT NOT NULL DEFAULT (date('now','localtime')),
    hora_pedido   TEXT NOT NULL DEFAULT (strftime('%H:%M','now','localtime')),
    tipo_entrega  TEXT NOT NULL DEFAULT 'Recoger'
                  CHECK (tipo_entrega IN ('Recoger','Local','Delivery')),
    direccion     TEXT,
    metodo_pago   TEXT NOT NULL DEFAULT 'Efectivo'
                  CHECK (metodo_pago IN ('Efectivo','QR')),
    estado        TEXT NOT NULL DEFAULT 'Pendiente'
                  CHECK (estado IN ('Pendiente','En preparación','Listo','Entregado','Cancelado')),
    total         REAL NOT NULL DEFAULT 0 CHECK (total >= 0),
    notas         TEXT
);

CREATE TABLE IF NOT EXISTS Detalle_Pedido (
    id_detalle       INTEGER PRIMARY KEY AUTOINCREMENT,
    num_pedido       INTEGER NOT NULL REFERENCES Pedidos(num_pedido) ON DELETE CASCADE,
    id_producto      INTEGER NOT NULL REFERENCES Productos(id_producto),
    cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
    precio_unitario  REAL NOT NULL CHECK (precio_unitario >= 0),
    subtotal         REAL NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_fecha    ON Pedidos(fecha_pedido);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente  ON Pedidos(id_cliente);
CREATE INDEX IF NOT EXISTS idx_detalle_pedido   ON Detalle_Pedido(num_pedido);

INSERT OR IGNORE INTO Categorias (id_categoria, nombre_categoria) VALUES
    (1, 'Económicos'),
    (2, 'Salchipapas'),
    (3, 'Alitas de Pollo'),
    (4, 'Pipocas de Pollo'),
    (5, 'Bebidas');

INSERT OR IGNORE INTO Productos (id_producto, nombre_producto, precio, id_categoria) VALUES
    (1,  'Combo Universitario',    20, 1),
    (2,  'Combo Popular',          25, 1),
    (3,  'Combo Dúo',              35, 1),
    (4,  'Combo Triple',           42, 1),
    (5,  'Salchipapa Clásica',     15, 2),
    (6,  'Salchipapa Dúo',         25, 2),
    (7,  'Alitas Buffalo',         40, 3),
    (8,  'Alitas BBQ / Picantes',  40, 3),
    (9,  'Pipocas de Pollo',       25, 4),
    (10, 'Coca-Cola 300 ml',        3, 5),
    (11, 'Coca-Cola 1/2 L',        12, 5),
    (12, 'Coca-Cola 2 L',          15, 5),
    (13, 'Fanta Naranja 2 L',      17, 5);
