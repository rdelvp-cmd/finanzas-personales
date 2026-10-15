-- Finanzas personales: esquema para Neon (Postgres 16+)
-- Moneda base GTQ; montos en numeric(12,2).

create type tipo_movimiento as enum ('ingreso', 'gasto', 'ahorro', 'deuda');
create type frecuencia as enum ('quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', 'unica');
create type cual_quincena as enum ('q15', 'fin_mes', 'ambas');
create type estado_periodo as enum ('abierta', 'cerrada');

-- Personas del hogar: quién paga y para quién es el gasto
create table personas (
  id         serial primary key,
  nombre     text not null unique,          -- Rodolfo, Raquel, Emilio, Fito
  activo     boolean not null default true
);

-- Cuentas de origen o destino del dinero
create table cuentas (
  id         serial primary key,
  nombre     text not null unique,          -- Monetaria BI, TC GyT, Efectivo, Ahorro USD
  tipo       text not null check (tipo in ('banco', 'tarjeta', 'efectivo', 'ahorro', 'inversion')),
  moneda     char(3) not null default 'GTQ',
  activo     boolean not null default true
);

-- Rubros y subrubros (Vivienda > Hipoteca)
create table categorias (
  id         serial primary key,
  nombre     text not null,
  padre_id   int references categorias(id),
  tipo       tipo_movimiento not null,
  unique (nombre, padre_id)
);

-- Catálogo normalizado: un concepto = un nombre, sin variantes
create table conceptos (
  id           serial primary key,
  nombre       text not null unique,        -- 'Teléfono Fito'
  categoria_id int not null references categorias(id),
  beneficiario_id int references personas(id)
);

-- Plantillas: lo que se repite y en qué quincena cae
create table plantillas (
  id            serial primary key,
  concepto_id   int not null references conceptos(id),
  tipo          tipo_movimiento not null,
  monto         numeric(12,2) not null check (monto >= 0),
  monto_variable boolean not null default false,   -- luz: se ajusta al pagar
  frecuencia    frecuencia not null,
  quincena      cual_quincena not null,
  meses         int[] check (meses <@ array[1,2,3,4,5,6,7,8,9,10,11,12]), -- null = todos
  pagador_id    int references personas(id),
  cuenta_id     int references cuentas(id),
  vigente_desde date not null default current_date,
  vigente_hasta date,
  activo        boolean not null default true
);

-- Cada quincena es un periodo con fecha real (28, 30 o 31)
create table periodos (
  id             serial primary key,
  anio           int not null,
  mes            int not null check (mes between 1 and 12),
  quincena       smallint not null check (quincena in (1, 2)),  -- 1 = día 15, 2 = fin de mes
  fecha          date not null,
  saldo_inicial  numeric(12,2) not null default 0,
  estado         estado_periodo not null default 'abierta',
  cerrado_en     timestamptz,
  unique (anio, mes, quincena)
);

-- Movimientos: plan y real en la misma fila
create table movimientos (
  id               bigserial primary key,
  periodo_id       int not null references periodos(id) on delete cascade,
  concepto_id      int not null references conceptos(id),
  plantilla_id     int references plantillas(id),
  tipo             tipo_movimiento not null,
  monto_plan       numeric(12,2) not null default 0,
  monto_real       numeric(12,2),
  pagado           boolean not null default false,
  fecha_pago       date,
  cuenta_id        int references cuentas(id),
  pagador_id       int references personas(id),
  fondo_id         int,                     -- si es aporte o retiro de un fondo
  deuda_id         int,                     -- si es pago a una deuda
  nota             text,
  creado_en        timestamptz not null default now()
);
create index on movimientos (periodo_id);
create index on movimientos (concepto_id);

-- Fondos: emergencia, provisiones (IUSI, seguros, colegio 2027, Navidad), ahorro USD
create table fondos (
  id          serial primary key,
  nombre      text not null unique,
  tipo        text not null check (tipo in ('emergencia', 'provision', 'meta', 'ahorro')),
  meta        numeric(12,2),
  fecha_meta  date,
  moneda      char(3) not null default 'GTQ'
);

create table fondo_movimientos (
  id         bigserial primary key,
  fondo_id   int not null references fondos(id),
  fecha      date not null,
  monto      numeric(12,2) not null,        -- positivo aporte, negativo retiro
  origen     text,                          -- 'quincena', 'bono14', 'aguinaldo', 'cuchubal'
  movimiento_id bigint references movimientos(id),
  nota       text
);

-- Deudas: TC GyT extrafinanciamiento, hipoteca
create table deudas (
  id              serial primary key,
  nombre          text not null unique,
  saldo_inicial   numeric(12,2) not null,
  fecha_saldo     date not null,
  tasa_anual      numeric(6,3),
  cuota           numeric(12,2),
  cuotas_restantes int,
  cuenta_id       int references cuentas(id)
);

alter table movimientos
  add foreign key (fondo_id) references fondos(id),
  add foreign key (deuda_id) references deudas(id);

-- Cuchubal
create table cuchubales (
  id          serial primary key,
  nombre      text not null,
  aporte      numeric(12,2) not null,       -- 300 por quincena
  inicio      date not null,
  mi_turno    int,
  monto_cobro numeric(12,2)                 -- 7,800
);
create table cuchubal_turnos (
  cuchubal_id int not null references cuchubales(id) on delete cascade,
  turno       int not null,
  participante text not null,
  fecha_cobro date,
  primary key (cuchubal_id, turno)
);

-- Genera una quincena a partir de las plantillas vigentes
create or replace function generar_quincena(p_anio int, p_mes int, p_q smallint)
returns int language plpgsql as $$
declare
  v_fecha date;
  v_id int;
  v_saldo numeric(12,2);
begin
  v_fecha := case when p_q = 1 then make_date(p_anio, p_mes, 15)
             else (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date end;

  -- saldo final de la quincena anterior, si está cerrada
  select r.saldo_final into v_saldo
  from v_resumen_quincena r
  join periodos p on p.id = r.periodo_id
  where p.fecha < v_fecha and p.estado = 'cerrada'
  order by p.fecha desc limit 1;

  insert into periodos (anio, mes, quincena, fecha, saldo_inicial)
  values (p_anio, p_mes, p_q, v_fecha, coalesce(v_saldo, 0))
  on conflict (anio, mes, quincena) do nothing
  returning id into v_id;

  if v_id is null then
    return (select id from periodos where anio = p_anio and mes = p_mes and quincena = p_q);
  end if;

  insert into movimientos (periodo_id, concepto_id, plantilla_id, tipo, monto_plan, cuenta_id, pagador_id)
  select v_id, t.concepto_id, t.id, t.tipo, t.monto, t.cuenta_id, t.pagador_id
  from plantillas t
  where t.activo
    and v_fecha between t.vigente_desde and coalesce(t.vigente_hasta, 'infinity')
    and (t.quincena = 'ambas' or (t.quincena = 'q15' and p_q = 1) or (t.quincena = 'fin_mes' and p_q = 2))
    and (t.meses is null or p_mes = any (t.meses));

  return v_id;
end $$;

-- Resumen por quincena: lo que hoy es TOTAL GASTO / SALARIO / DISPONIBLE
create view v_resumen_quincena as
select p.id as periodo_id, p.anio, p.mes, p.quincena, p.fecha, p.estado, p.saldo_inicial,
  coalesce(sum(coalesce(m.monto_real, m.monto_plan)) filter (where m.tipo = 'ingreso'), 0) as ingresos,
  coalesce(sum(coalesce(m.monto_real, m.monto_plan)) filter (where m.tipo <> 'ingreso'), 0) as egresos,
  coalesce(sum(m.monto_plan) filter (where m.tipo <> 'ingreso'), 0) as egresos_plan,
  p.saldo_inicial
    + coalesce(sum(coalesce(m.monto_real, m.monto_plan)) filter (where m.tipo = 'ingreso'), 0)
    - coalesce(sum(coalesce(m.monto_real, m.monto_plan)) filter (where m.tipo <> 'ingreso'), 0) as saldo_final
from periodos p
left join movimientos m on m.periodo_id = p.id
group by p.id;
