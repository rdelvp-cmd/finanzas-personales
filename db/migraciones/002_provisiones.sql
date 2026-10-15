-- Provisiones: lo que no toca pagar en la quincena se aparta en la cuenta de ahorro
alter table movimientos add column provisionado boolean not null default false;
alter table movimientos add constraint pagado_o_provisionado check (not (pagado and provisionado));

insert into fondos (nombre, tipo) values ('Provisiones', 'provision') on conflict (nombre) do nothing;

-- Saldo apartado por concepto: aportes (+) al provisionar, retiros (-) al pagar usando la provisión
create view v_provisiones as
select m.concepto_id, c.nombre as concepto, sum(fm.monto) as saldo, max(fm.fecha) as ultima_fecha
from fondo_movimientos fm
join fondos f on f.id = fm.fondo_id and f.nombre = 'Provisiones'
join movimientos m on m.id = fm.movimiento_id
join conceptos c on c.id = m.concepto_id
group by m.concepto_id, c.nombre;
