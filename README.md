# Finanzas personales

App web para llevar el presupuesto por quincena (15 y fin de mes) sobre una base Postgres en Neon. Reemplaza el Excel "RV 2026".

## Qué hace

- **Quincena**: lista de ingresos y pagos agrupados por rubro, monto planeado y real, marcar pagado, agregar o quitar pagos, cerrar la quincena para que su saldo pase a la siguiente.
- **Provisiones**: un pago que no toca en la quincena se marca "Provisionado" (se aparta en la cuenta de ahorro). Al pagarlo después, la app ofrece usar lo provisionado de ese concepto.
- **Plantillas**: pagos recurrentes (quincenal, mensual, trimestral, anual) con los meses en que aplican. Cada quincena nueva se genera desde aquí con `generar_quincena()`.
- **Resumen anual**: disponible por quincena y gasto por rubro.

## Base de datos

Proyecto de Neon `finanzas-personales`, base `finanzas`. El esquema está en [`db/schema.sql`](db/schema.sql): tablas `periodos` (quincenas), `movimientos` (plan y real), `plantillas`, `conceptos`, `categorias`, `fondos`, `deudas`, `cuchubales` y la vista `v_resumen_quincena`.

Las 24 quincenas de 2026 ya están importadas de RV 2026; las plantillas aplican desde enero de 2027.

Los cambios posteriores están en [`db/migraciones/`](db/migraciones/): una base nueva se crea con `schema.sql` y luego cada migración en orden (002, 003…).

## Correr localmente

```bash
cp .env.example .env.local   # pegar DATABASE_URL de Neon y una APP_PASSWORD
npm install
npm run dev
```

## Desplegar en Vercel

1. Importar este repositorio en Vercel.
2. Agregar las variables `DATABASE_URL` (cadena de conexión de Neon, con `-pooler`) y `APP_PASSWORD`.
3. Desplegar. Al abrir la app el navegador pide usuario y contraseña: el usuario puede ser cualquiera, la contraseña es `APP_PASSWORD`.
