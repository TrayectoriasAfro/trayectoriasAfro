# Lessons: fix uploads + add intro text to lessons page

## Goal
1. Fix lesson-editor uploads failing for non-staff owners/collaborators: Oaxaca manumission PDF in "5o de primaria" and Guerrero declaration image in "Educación superior" (also attempted as PDF).
2. Add Lola's "Introducción a las unidades didácticas" text to the public lessons page below the heading/subtitle, in ES and EN. No backend-managed CMS needed — static localized copy per Sabrina's "backend" = webpage clarification.

## Findings (verified in code)
- Public page: `mstdb_theme/src/routes/(app)/lessons/+page.svelte` — hero shows `m.lessons_title()` + `m.lessons_description()` ("Recursos educativos..."). Intro paragraphs go directly under `.lessons-hero`.
- ES/EN strings: `mstdb_theme/messages/es.json` / `en.json` (`lessons_description`). Paraglide: add `lessons_intro_p1`, `lessons_intro_p2` to both; no JS logic in values (repo constraint); render as two `<p>` or one block.
- Editor: `RichTextEditor.svelte` — images via `onUploadImage` → `uploadLeccionImagen`; PDFs via `onUploadPdf` (requires `file.type === 'application/pdf'`) → `uploadLeccionAdjunto`.
- Backend: `api/v2/views.py` `LeccionViewSet`:
  - `upload_imagen` IS in `get_permissions` gated list (`update, partial_update, destroy, upload_imagen`) → `[IsAuthenticated()]`, then object check `is_staff or _acceso(leccion)`. OK for owners.
  - `upload_adjunto` is MISSING from that list → falls through to default `BaseV2ViewSet` permissions (latent bug; fix for parity, but NOT the cause of a 500).
  - Key update: reported error is `HTTP error! status: 500`, i.e. the server throws during upload (traceback needed) — not a 400 validation or 403 permission failure. Prime suspects: media storage/volume misconfiguration, serializer exception, Pillow/image-validation crash.
  - Both upload actions validate strictly: image relies on `ImageField` (Pillow) validation; PDF requires `.pdf` extension AND `content_type == 'application/pdf'`. A renamed image (e.g. Guerrero declaration JPG→PDF) or browser sending `application/octet-stream` / `image/jpeg` with `.pdf` name fails with "El archivo debe ser un PDF."
- Model sanitization (`dbgestor/models.py`): `Leccion.save` bleaches body; `img`/`iframe` allowed. Uploaded absolute http(s) media URLs survive `sanitize_leccion_embed_urls`. No issue expected once upload succeeds.
- Permissions note: Lola gave "property privileges to Sabrina" = `LeccionAcceso` owner/collaborator grants — collaborators can edit content but only owners/staff can publish (enforced in `update`). No change needed.

## Plan (implementer tasks)

### A. Fix lesson upload 500 (backend — now top priority)
Reproduced: `POST /api/v2/lecciones/10/adjuntos/` with `temp/files/vicente.guerrero.pdf` (valid PDF 1.3, 1 page, ~230 KB) → `500 Internal Server Error`, Django HTML body (145 B, `Content-Language: en`), via nginx. No output in `web`/`frontend` container logs.
Code facts ruling things out:
- Permissions are NOT the 500 cause: `BaseV2ViewSet.permission_classes = [APIPerm]` with `has_permission → True`; `LeccionViewSet.get_permissions` falls through to `super(BaseV2ViewSet, …)` (i.e. DRF defaults) for `upload_adjunto`. An authenticated owner passes this either way; a permission failure would be 403, not 500.
- File itself is a valid PDF, so extension/content-type validation passes; the exception happens at or after `LeccionAdjunto.objects.create(...)` or in `LeccionAdjuntoSerializer` (both plain ModelSerializer — unlikely but unconfirmed without traceback).
- `objects.create()` does NOT run `validate_pdf_file` (no `full_clean`); the view's inline check is what guards.
Implementer tasks:
1. Capture the traceback (it exists — "no logs" likely means wrong compose file/service or log level). Immediately after reproducing the POST, run `docker compose logs` against the ACTUAL stack in use (dev: `docker-compose.yml` + `docker-compose.dev.yml`; check which file defines `web`/`frontend`, and whether logs were tailed on the right project name). If still silent, set `DEBUG=True` / `LOG_LEVEL=DEBUG` temporarily or add a temporary try/except with `logger.exception` around the `upload_adjunto` create+serialize block.
2. Prime suspects, in order:
   - `leccion_adjunto` table missing (migration `0017_leccionadjunto` not applied in this DB) → `OperationalError: relation does not exist` on create. Check `python manage.py showmigrations dbgestor` / `migrate`.
   - `MEDIA_ROOT` (`mdb/media`) not writable or missing volume in the `web` container → `PermissionError/OSError` saving `lecciones/adjuntos/%Y/%m/vicente.guerrero.pdf`. Check compose volumes and in-container writability.
   - Serializer/media-URL building failure (e.g. storage backend misconfigured) — read traceback.
   - Note: nginx `Server` header + 235 KB body is well under default `client_max_body_size`; proxy limits unlikely, but confirm `client_max_body_size` in the frontend/nginx config if traceback points at the proxy.
3. Regardless of traceback, also apply the latent-permission fix: add `'upload_adjunto'` to the gated tuple in `LeccionViewSet.get_permissions` for parity with `upload_imagen`.
4. Make invalid files return 400, not 500: ensure file-save/validation errors in both `upload_imagen` and `upload_adjunto` are caught and returned with the existing Spanish 400 messages.

### B. Files/context still needed from Sabrina
Sabrina mentioned "the attached error message" but it wasn't forwarded. Before changing validation, reproduce with real files:
1. Get from Sabrina: screenshot/exact error text, filename, size, and the file itself (Oaxaca PDF, Guerrero image/PDF).
2. Likely culprits to check in order:
   - Image-as-PDF: Guerrero declaration is an image; if uploaded via PDF button with `.pdf` name but image bytes/content-type → correctly rejected. Fix = upload via image button instead (no code change; tell user).
   - Pillow missing/oversized image → `upload_imagen` 400/500. Check server logs, `DATA_UPLOAD_MAX_MEMORY_SIZE` / `FILE_UPLOAD_MAX_MEMORY_SIZE`, nginx `client_max_body_size`, Pillow installed.
   - Browser content-type mismatch for PDFs (e.g. `application/octet-stream`). Consider relaxing check to accept `application/octet-stream` + `.pdf` extension + PDF magic bytes (`%PDF`), but only if reproduction confirms it. Keep strict by default.
3. Do NOT widen `validate_pdf_file` / view validation speculatively.

### C. Lessons page intro text (frontend, static localized)
1. Add to `mstdb_theme/messages/es.json`:
   - `lessons_intro_p1`: "Estas unidades didácticas están clasificadas por niveles educativos para educación básica, secundaria, preparatoria y educación superior en México y un AP course para EUA. Para cada una, se consultó el programa de la SEP y se ajustó la unidad al contenido sobre poblaciones afrodescendientes que se tiene que estudiar en cada nivel educativo."
   - `lessons_intro_p2`: "Estas unidades son herramientas de apoyo para los profesores para cubrir el contenido. Son lecciones cortas y muy específicas en su uso para que no tomen mucho tiempo lectivo y puedan llevarse a cabo en la mayoría de los contextos de aula. Sabiendo que el acceso a internet no es uniforme en todo el territorio mexicano, se han planteado las actividades para poder hacerlas con un sólo acceso a la página Trayectorias Afro desde un equipo para todo el grupo o para múltiples conexiones, formando equipos o de forma individual. Esperamos que sean de utilidad para los/as/es maestros/as/es de todos los niveles."
2. Add EN equivalents (`lessons_intro_p1`, `lessons_intro_p2`) to `messages/en.json` using the user-approved draft translation.
3. In `(app)/lessons/+page.svelte`, render both paragraphs under the existing `hero-sub` paragraph (inside `.lessons-hero`), e.g. `<p class="lessons-intro">{m.lessons_intro_p1()}</p><p ...>{m.lessons_intro_p2()}</p>`. Keep centered hero styling; reuse existing classes, no component-scoped `<style>` (repo rule → `custom.css` if styling needed).
4. Regenerate Paraglide messages (project's i18n build step) so `m.lessons_intro_p1/p2` exist.
5. a11y: plain paragraphs, no action needed beyond existing landmarks.

### D. Content follow-through (manual, no code)
1. After fix deploys: ask Lola/Sabrina to retry the two uploads (Oaxaca PDF via PDF button; Guerrero image via image button).
2. Confirm both lessons still `is_published`.

## Validation
- `upload_adjunto` as non-staff owner with real PDF → 201 and embed renders in lesson detail; `upload_imagen` unchanged.
- Lessons page in ES and EN shows heading → subtitle ("Recursos educativos...") → two intro paragraphs → filters → cards; locale switch updates text reactively.
- Run repo lint/typecheck per AGENTS.md; update CHANGELOG `[Unreleased]`.

## Out of scope / decisions
- No admin-editable CMS field for the intro (static copy; team has no CMS workflow and text is stable).
- No change to owner/collaborator publish rules.
- Still needed from Sabrina to reproduce: which lesson + which button (image or PDF), filename, size, and ideally the file itself; plus approximate date/time of a failed attempt to find the traceback in server logs.
- Frontend follow-up (only if traceback implicates it): `RichTextEditor.svelte` shows raw `e.message` ("HTTP error! status: 500") with no request id — consider surfacing the backend detail message when present.
