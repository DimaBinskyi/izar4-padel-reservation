# izar4.es Reservation API — Reverse-Engineered Reference

This document captures the **izar4.es** REST API as used by its public *Reservas* page,
reverse-engineered by inspecting network traffic and the site's inline JavaScript, and
**verified with live create/cancel tests** (all test bookings were cancelled afterwards).

> izar4.es is a WordPress site. The "backend" is the standard **WordPress REST API**
> (`/wp-json/`) plus a custom plugin namespace `app/v1`. The *Reservas* module is public —
> **no authentication is required** to read slots or to create/cancel reservations.

- **Base URL:** `https://izar4.es/wp-json`
- **Standard namespace:** `wp/v2` (custom post types + taxonomy + media)
- **Custom namespace:** `app/v1` (auth, config, dwellings, booking actions)
- **Padel resource:** post id `104`, slug `padel`, **taxonomy term id `12`**

---

## 0. Authentication

The Reservas module is public (`configuracion.modulos[reservas].acceso = "publico"`).
Reading slots and creating/cancelling reservations needs **no token**.

Other modules (avisos, noticias, vecinos, etc.) use a Bearer token obtained from
`POST app/v1/login` and validated via `POST app/v1/validar-token`. **Our app does not use
login** — everything we need is public.

The site's own JS appends `?_token=<token>` to write URLs only to bypass its service
worker cache; the token is not required for the reservas endpoints.

---

## 1. Read endpoints

### 1.1 Site configuration
```
GET /wp-json/app/v1/configuracion
```
Returns site name, logo, module list and public permissions. Example (trimmed):
```json
{
  "ok": true,
  "nombre": "IZAR 4",
  "logo": "https://izar4.es/wp-content/uploads/2026/03/I4_512px_transparente.png",
  "modulos": [ { "id": "5", "nombre": "reservas", "acceso": "publico" }, ... ],
  "permisos_publico": { "noticias": ["leer"], "directorio": ["leer"], "inicio": ["leer"] }
}
```

### 1.2 Resources (bookable things)
```
GET /wp-json/wp/v2/recursos?per_page=100&_fields=id,slug,title,acf
```
```json
[
  { "id":104, "slug":"padel", "title":{"rendered":"Pádel"},
    "acf":{ "descripcion_recursos":"Pista de pádel acristalada",
            "imagen_recursos":205, "orden_recursos":1,
            "dias_antelacion_max_recursos":7,
            "minutos_antelacion_min_recursos":0,
            "reservas_max_por_semana_reservas":3,
            "dias_penalizacion_recursos":0,
            "limite_por_recursos":"vecino" } },
  { "id":105, "slug":"club-social", ... "dias_antelacion_max_recursos":30,
            "reservas_max_por_semana_reservas":7 }
]
```
**ACF rule fields (per resource):**

| Field | Padel | Meaning |
|---|---|---|
| `dias_antelacion_max_recursos` | `7` | Max days ahead the **website UI** lets you book |
| `minutos_antelacion_min_recursos` | `0` | Min minutes before slot start to allow booking |
| `reservas_max_por_semana_reservas` | `3` | Max reservations per **vivienda** per Mon–Sun week |
| `dias_penalizacion_recursos` | `0` | Cooldown days between bookings (0 = none) |
| `limite_por_recursos` | `vecino` | Limit is counted per dwelling/neighbour |
| `imagen_recursos` | `205` | Media id (resolve via `/wp/v2/media/{id}`) |

> ⚠️ **These limits are enforced only in the website's client JS, NOT on the server.**
> See §4 (verified findings).

### 1.3 Resource taxonomy term id (needed to filter slots/reservations)
```
GET /wp-json/wp/v2/recurso?slug=padel&_fields=id,slug
→ [ { "id": 12, "slug": "padel" } ]
```
`franjas`, `bloqueos`, `bloqueos-fecha` and `reservas` are filtered by the **taxonomy term
id** (`recurso=12`), not by the resource post id (104).

### 1.4 Time slots (franjas)
```
GET /wp-json/wp/v2/franjas?per_page=100&recurso=12&_fields=id,slug,title,acf
```
```json
[ { "id":106, "slug":"p1-1", "title":{"rendered":"P1-1"},
    "acf":{ "hora_inicio_franjas":"09:00:00", "hora_fin_franjas":"10:00:00", "orden_franjas":1 } }, ... ]
```
**Padel slots (sorted by `orden_franjas`):**

| Slot (title) | Start | End |
|---|---|---|
| P1-1 | 09:00 | 10:00 |
| P1-2 | 10:00 | 11:30 |
| P1-3 | 11:30 | 13:00 |
| P1-4 | 13:00 | 14:30 |
| P1-5 | 14:30 | 16:00 |
| P1-6 | 16:00 | 17:30 |
| P1-7 | 17:30 | 19:00 |
| P1-8 | 19:00 | 20:30 |
| P1-9 | 20:30 | 22:00 |

The **slot id used in reservations** is the franja **title** (e.g. `"P1-1"`), not the numeric post id.

### 1.5 Recurring blocks (by weekday)
```
GET /wp-json/wp/v2/bloqueos?per_page=100&recurso=12&_fields=id,slug,title,acf
```
ACF: `id_franja_bloqueos` (e.g. `"P1-1"`), `dia_semana_bloqueos` (one of `D L M X J V S`).
A slot is blocked when `bloqueosSet[idFranja + "_" + diaSemana]` exists. (Empty `[]` for padel currently.)

### 1.6 Date blocks (whole-day closures)
```
GET /wp-json/wp/v2/bloqueos-fecha?per_page=100&recurso=12&_fields=id,acf
→ [ { "id":1175, "acf":{ "fecha_bloqueo_bloqueos-fecha":"08/05/2026",
                          "motivo_bloqueos-fecha":"Mantenimiento de pista" } } ]
```
Date may be `dd/mm/yyyy` **or** `YYYYMMDD` — normalize before comparing. If a date is blocked,
no slots are bookable that day (show the `motivo`).

### 1.7 Reservations (who booked what)
```
GET /wp-json/wp/v2/reservas?per_page=100&recurso=12&_fields=id,slug,acf
```
```json
[ { "id":1528, "slug":"20260628-padel-p1-2",
    "acf":{ "id_franja_reservas":"P1-2", "fecha_reservas":"20260628",
            "nombre_reservas":"Dmytro", "vivienda_reservas":"P3-7",
            "codigo_cancelacion_reservas":"<plaintext code>" } }, ... ]
```
| ACF field | Meaning |
|---|---|
| `id_franja_reservas` | slot title, e.g. `P1-2` |
| `fecha_reservas` | date `YYYYMMDD` |
| `nombre_reservas` | display name entered by booker |
| `vivienda_reservas` | dwelling ref, e.g. `P3-7` |
| `codigo_cancelacion_reservas` | cancellation code **(returned in plaintext to everyone)** |

`slug` = `YYYYMMDD-padel-<franja>` and is the **unique key** (one reservation per date+resource+slot).

> ⚠️ **Security note:** cancellation codes are public. Anyone reading this endpoint can cancel
> any booking. Our app deliberately does **not** harvest others' codes (see design spec).

### 1.8 Dwellings (viviendas) — for the apartment autocomplete
```
GET /wp-json/app/v1/inmuebles?tipo=vivienda
→ { "ok":true, "inmuebles":[
     { "id":"1","tipo":"vivienda","bloque":"1","escalera":"","planta":"1","puerta":"1",
       "referencia":"P1-1","notas":"Portal 1, puerta nº 1","label":"P1-1" }, ... ] }
```
98 dwellings. Use `label` for matching/autocomplete (e.g. `P3-7`).

### 1.9 Media (resource images)
```
GET /wp-json/wp/v2/media/{id}?_fields=source_url → { "source_url": "https://..." }
```

---

## 2. Write endpoints

### 2.1 Create a reservation
```
POST /wp-json/app/v1/reservar
Content-Type: application/json
```
Body:
```json
{
  "titulo":    "20260703 - PADEL P1-1",
  "idFranja":  "P1-1",
  "fecha":     "20260703",
  "nombre":    "Dmytro",
  "vivienda":  "P3-7",
  "codigo":    "sol24",
  "idTermino": 12
}
```
- `titulo` format: `"<YYYYMMDD> - <RESOURCE-UPPER> <franja>"`.
- `vivienda` is uppercased by the site before sending.
- **Response:** `{ "id": 1529, "ok": true }` — returns the new reservation post id.

### 2.2 Cancel a reservation
```
POST /wp-json/app/v1/cancelar
Content-Type: application/json
```
Body:
```json
{ "idReserva": 1529, "codigo": "sol24" }
```
- `codigo` must equal the reservation's `codigo_cancelacion_reservas`.
  (Logged-in staff send `"__autorizado__"`; not used by our app.)
- **Responses:**
  - `{ "ok": true }` — cancelled.
  - `{ "ok": false, "code": "codigo_incorrecto" }` — wrong code.

---

## 3. Full `app/v1` route inventory (discovered)

Only the bold routes are used by our app. The rest are listed for completeness.

`/configuracion`*, `/inmuebles`*, **`/reservar`**, **`/cancelar`**, `/login`, `/logout`,
`/validar-token`, `/activar-cuenta`, `/bloquear-dia`, `/desbloquear-dia`, `/guardar-config-recurso`,
`/editar-bloqueo`, `/cambiar-password`, `/crear-noticia`, `/editar-noticia`, `/eliminar-noticia`,
`/subir-imagen`, `/subir-documento`, `/crear-evento`, `/editar-evento`, `/eliminar-evento`,
`/crear-aviso`, `/editar-aviso`, `/eliminar-aviso`, `/vecinos`, `/crear-vecino`, `/editar-vecino`,
`/eliminar-vecino`, `/crear-vecino-v2`, `/editar-vecino-v2`, `/encargos`, `/crear-encargo`,
`/actualizar-encargo`, `/directorio`, `/crear-directorio`, `/editar-directorio`, `/eliminar-directorio`,
`/generar-enlace`, `/inmuebles-vecinos`, `/asignar-inmueble`, `/desasignar-inmueble`, `/mi-perfil`,
`/mi-cuenta`, `/cambiar-mi-password`, `/inicio`, `/autorizaciones`, `/crear-autorizacion`,
`/cancelar-autorizacion`, `/validar-autorizacion`, `/confirmar-entrada`, `/instalaciones`,
`/crear-instalacion`, `/editar-instalacion`, `/borrar-instalacion`, `/notas`, `/crear-nota`,
`/borrar-nota`, `/roles-asignables`, `/mantenimientos`, `/crear-mantenimiento`,
`/editar-mantenimiento`, `/borrar-mantenimiento`, `/instalaciones-seguimiento`,
`/historial-instalacion`, `/informe-mantenimientos`

(* = used for read.)

---

## 4. Verified findings & gotchas (important for implementation)

All of the following were confirmed by live testing on 2026-06-27 (every test booking was
created with name `API TEST (auto)` / code `APITEST_DELETEME` and **cancelled immediately**;
a final scan confirmed zero leftovers).

1. **Server does NOT enforce the booking-rule limits.** The `dias_antelacion_max` (7-day),
   `reservas_max_por_semana` (3/week) and "1 per day" rules are applied **only in the website's
   client JS**. Direct API calls bypass them:
   - Created bookings at **+21 days** and **+60 days** ahead → both accepted (`ok:true`); the
     +60 one was visible in the list.
   - Created **4 bookings for one vivienda in the same Mon–Sun week** → all accepted; the 4th
     was **not** rejected.
   - ➜ Our app can offer a longer horizon (21 days) but must enforce the 3/week + 1/day rules
     **itself** (good-citizen policy).

2. **Read-after-write lag.** After `reservar` returns `ok:true`, an immediate `GET /reservas`
   sometimes does **not** include the new row (WordPress/CDN caching); sometimes it does.
   ➜ Use cache-busting (`cache:'no-store'` + a cache-bust query) and **optimistic UI**; reconcile
   on the next poll.

3. **CORS is unreliable for direct browser calls.** A cross-origin `fetch` from another origin
   returned data in an automation browser but with **no `Access-Control-Allow-Origin` header**,
   which a real browser would block; JSON POSTs would also need a working preflight.
   ➜ The PWA must call izar4 **through our Cloudflare Worker proxy**, not directly.

4. **Cancellation codes are public** (returned in plaintext by `/reservas`). izar4 itself is
   therefore open to anyone cancelling anyone. Our app restricts cancel to the user's own
   bookings and never displays/harvests others' codes.

5. **Date formats differ by post type.** `fecha_reservas` is `YYYYMMDD`; `bloqueos-fecha` may be
   `dd/mm/yyyy` or `YYYYMMDD`. Normalize with a regex (`/(\d{2})\/(\d{2})\/(\d{4})/ → $3$2$1`).

6. **Weekday codes** for recurring blocks: `['D','L','M','X','J','V','S']` indexed by JS
   `Date.getDay()` (Sunday = 0).

7. **Reservation identity** is `fecha + resource + franja` (the slug). Only one reservation can
   exist per slot; a freed slot = that slug disappearing from `/reservas`.

---

## 5. Status derivation (how the website builds the slot table)

For a chosen `slug` (padel) and `fechaYmd`:
1. Resolve term id (`recurso=12`).
2. Fetch `franjas`, `bloqueos`, `reservas` (filtered to the date), and `bloqueos-fecha`.
3. For each franja (sorted by `orden_franjas`):
   - **Bloqueado** if `bloqueosSet[franja + "_" + weekday]` or the whole day is blocked.
   - **Ocupado** if a reservation exists for that franja on that date.
   - **Libre** otherwise.
   - If the date is **today** and the slot's start time already passed → not bookable ("—",
     shown as Libre/past). If within `minutos_antelacion_min` of start → "Pronto".
   - If the date is in the **past** → read-only ("Fecha pasada — solo consulta").
