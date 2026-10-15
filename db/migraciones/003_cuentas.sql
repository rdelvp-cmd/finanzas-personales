-- Cuentas con saldo: monetaria (salario), ahorro de provisiones, ahorros en otro banco y tarjetas
alter table cuentas add column banco text;
alter table cuentas add column rol text unique check (rol in ('salario', 'provisiones'));
alter table cuentas add column saldo_inicial numeric(12,2) not null default 0;  -- tarjetas: negativo = deuda
alter table cuentas add column fecha_saldo date not null default current_date;
alter table cuentas add column orden int not null default 0;

update cuentas set nombre = 'Monetaria', rol = 'salario', orden = 1 where nombre = 'Cuenta de nómina';
update cuentas set orden = 5 where nombre = 'TC GyT';
update cuentas set orden = 9, activo = false where nombre = 'Efectivo';
insert into cuentas (nombre, tipo, moneda, rol, orden) values
  ('Ahorro provisiones', 'ahorro', 'GTQ', 'provisiones', 2),
  ('Ahorro quetzales (otro banco)', 'ahorro', 'GTQ', null, 3),
  ('Ahorro dólares (otro banco)', 'ahorro', 'USD', null, 4),
  ('Tarjeta 2', 'tarjeta', 'GTQ', null, 6);

-- Concepto que se paga a una cuenta (pago de tarjeta): el pago sale de la monetaria y abona a la tarjeta
alter table conceptos add column cuenta_destino_id int references cuentas(id);
update conceptos set cuenta_destino_id = (select id from cuentas where nombre = 'TC GyT')
where nombre = 'TC GyT extrafinanciamiento';

-- Libro de cada cuenta: + entra, - sale. Las filas con movimiento_id las mantiene sincronizar_movimiento()
create table transacciones (
  id            bigserial primary key,
  cuenta_id     int not null references cuentas(id),
  fecha         date not null default current_date,
  monto         numeric(12,2) not null,
  tipo          text not null check (tipo in ('ingreso', 'gasto', 'transferencia', 'ajuste')),
  grupo         uuid,                       -- une las dos patas de una transferencia
  movimiento_id bigint references movimientos(id) on delete cascade,
  nota          text,
  creado_en     timestamptz not null default now()
);
create index on transacciones (cuenta_id, fecha);
create index on transacciones (movimiento_id);

-- Saldo = saldo inicial + transacciones desde la fecha de ese saldo
create view v_saldos_cuentas as
select c.id, c.nombre, c.banco, c.tipo, c.moneda, c.rol, c.orden, c.activo, c.saldo_inicial, c.fecha_saldo,
  c.saldo_inicial + coalesce(sum(t.monto) filter (where t.fecha >= c.fecha_saldo), 0) as saldo
from cuentas c
left join transacciones t on t.cuenta_id = c.id
group by c.id;

-- Reconstruye las transacciones de una fila de la quincena según su estado
create or replace function sincronizar_movimiento(p_id bigint) returns void language plpgsql as $$
declare
  m movimientos%rowtype;
  v_monto numeric(12,2);
  v_usado numeric(12,2);
  v_origen int;
  v_prov int;
  v_destino int;
  v_fecha date;
  v_grupo uuid;
begin
  select * into m from movimientos where id = p_id;
  if not found then return; end if;

  delete from transacciones where movimiento_id = p_id;

  v_monto := coalesce(m.monto_real, m.monto_plan);
  v_fecha := coalesce(m.fecha_pago, current_date);
  v_origen := coalesce(m.cuenta_id, (select id from cuentas where rol = 'salario'));
  v_prov := (select id from cuentas where rol = 'provisiones');
  v_destino := (select cuenta_destino_id from conceptos where id = m.concepto_id);
  -- Lo que este pago tomó de lo provisionado (retiro negativo en el fondo)
  v_usado := coalesce((select -sum(monto) from fondo_movimientos where movimiento_id = p_id and monto < 0), 0);

  -- El aporte a la provisión sigue al monto real
  update fondo_movimientos set monto = v_monto where movimiento_id = p_id and monto > 0;

  if m.pagado and m.tipo = 'ingreso' then
    insert into transacciones (cuenta_id, fecha, monto, tipo, movimiento_id) values (v_origen, v_fecha, v_monto, 'ingreso', p_id);
  elsif m.pagado then
    v_grupo := gen_random_uuid();
    insert into transacciones (cuenta_id, fecha, monto, tipo, grupo, movimiento_id)
    values (v_origen, v_fecha, -v_monto, case when v_destino is null then 'gasto' else 'transferencia' end, v_grupo, p_id);
    if v_destino is not null then
      insert into transacciones (cuenta_id, fecha, monto, tipo, grupo, movimiento_id) values (v_destino, v_fecha, v_monto, 'transferencia', v_grupo, p_id);
    end if;
    if v_usado > 0 and v_prov is not null then
      v_grupo := gen_random_uuid();
      insert into transacciones (cuenta_id, fecha, monto, tipo, grupo, movimiento_id, nota)
      values (v_prov, v_fecha, -v_usado, case when v_destino is null then 'gasto' else 'transferencia' end, v_grupo, p_id, 'Pago con lo provisionado');
      if v_destino is not null then
        insert into transacciones (cuenta_id, fecha, monto, tipo, grupo, movimiento_id, nota)
        values (v_destino, v_fecha, v_usado, 'transferencia', v_grupo, p_id, 'Pago con lo provisionado');
      end if;
    end if;
  elsif m.provisionado and v_prov is not null then
    v_grupo := gen_random_uuid();
    insert into transacciones (cuenta_id, fecha, monto, tipo, grupo, movimiento_id, nota) values
      (v_origen, v_fecha, -v_monto, 'transferencia', v_grupo, p_id, 'Provisión'),
      (v_prov, v_fecha, v_monto, 'transferencia', v_grupo, p_id, 'Provisión');
  end if;
end $$;
