# EntryPointTrade - reconstrucción local

Esta es una reconstrucción independiente del Site de EntryPointTrade para poder seguir desarrollándolo sin depender de los mensajes de Work.

## Qué está incluido

- Potencial de entrada con los criterios vistos en el Site.
- Criterios: corto plazo, medio plazo, exploración amplia, impulso intradía, explosión en la sesión, personalizado e histórico/tendencia estrictos.
- Guardado del criterio personalizado en `localStorage`.
- **El filtro de precio mínimo está eliminado completamente**: no existe campo de UI ni condición de filtrado por precio mínimo.
- Potencial futuro colocado inmediatamente después de Potencial de entrada.
- Radar de acciones.
- Calendario y noticias.
- Catálogo Trade Republic, limitado a valores marcados como `tradeRepublicVerified: true`.
- Fuentes y cobertura con importación JSON.
- Interfaz responsive y modo oscuro similar al Site original.

## Importante

Esta versión no inventa cotizaciones ni noticias. Sin una fuente conectada aparecerán estados vacíos. El siguiente paso será conectar fuentes de mercado/noticias reales o un backend propio.

## Ejecutarlo

No requiere dependencias.

```bash
cd entrypointtrade-rebuild
python -m http.server 8080
```

Después abre `http://localhost:8080`.

También puede abrirse `index.html` directamente, aunque para futuras integraciones con APIs es mejor usar un servidor local.

## Importar datos

Ve a **Fuentes y cobertura -> Importar JSON**. El archivo debe tener esta estructura:

```json
{
  "stocks": [],
  "events": []
}
```

Consulta `data/example.json` para ver los campos admitidos. Ese fichero usa datos ficticios exclusivamente para documentar el formato.

## Campos principales de stocks

- `ticker`
- `name`
- `isin`
- `market`
- `tradeRepublicVerified`
- `price`
- `session`: `regular`, `premarket` o `previous`
- `changePct`
- `volume`
- `avgVolume`
- `relVolume`
- `adx`
- `rsi`
- `score`
- `trendOk`
- `liquidityRisk`
- `catalyst`
- `catalystConfirmed`
- `why`
- `risk`

No existe ningún campo `minPrice`, `minimumPrice` ni equivalente.

## Campos principales de events

- `ticker`
- `name`
- `date` (ISO 8601)
- `type`: `medical`, `earnings`, `contract`, `corporate`, `other`
- `tradeRepublicVerified`
- `confirmed`
- `potentialScore`
- `source`
- `fact`
- `hypothesis`

