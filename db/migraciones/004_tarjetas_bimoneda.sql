-- Tarjetas con saldo en quetzales y en dólares: la parte en dólares es una cuenta hija (principal_id)
alter table cuentas add column principal_id int references cuentas(id);

insert into cuentas (nombre, banco, tipo, moneda, orden, principal_id)
select c.nombre || ' (US$)', c.banco, 'tarjeta', 'USD', c.orden, c.id
from cuentas c
where c.tipo = 'tarjeta' and c.moneda = 'GTQ' and c.principal_id is null
  and not exists (select 1 from cuentas h where h.principal_id = c.id);

create or replace view v_saldos_cuentas as
select c.id, c.nombre, c.banco, c.tipo, c.moneda, c.rol, c.orden, c.activo, c.saldo_inicial, c.fecha_saldo,
  c.saldo_inicial + coalesce(sum(t.monto) filter (where t.fecha >= c.fecha_saldo), 0) as saldo,
  c.principal_id
from cuentas c
left join transacciones t on t.cuenta_id = c.id
group by c.id;
