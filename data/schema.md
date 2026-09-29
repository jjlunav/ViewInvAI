# Esquema de datos

## stocks[]

Cada objeto representa un valor de mercado. `price` se muestra, pero **nunca se utiliza como precio mínimo de entrada en los filtros**.

## events[]

Cada objeto representa un evento futuro. Mantener separados:

- `fact`: hecho comprobado y fechado.
- `hypothesis`: posible impacto, explícitamente presentado como hipótesis.

Para la vista Trade Republic, usar `tradeRepublicVerified: true` únicamente cuando la disponibilidad se haya verificado.


## D1 v2

See docs/d1-architecture-v2.md for the normalized instrument/listing/venue/broker model and session persistence rules.
