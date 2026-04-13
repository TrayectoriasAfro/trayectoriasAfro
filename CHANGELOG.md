# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] - 1.1.0

### Backend (`mstdb_manager`)

#### Search & Filtering
- Added `estado_civil` filter (labeled "Estado matrimonial") for both `PersonaEsclavizada` and `PersonaNoEsclavizada`
- Added `tipo_documental` faceted filter for both persona types
- Added `archivo` faceted filter for both persona types
- Added document date range filter (`fecha_documento__gte` / `fecha_documento__lte`) for both persona types
- Added individual free-text filters for `altura`, `cabello`, `ojos`, `marcas_corporales`, `conducta`, and `salud` (PE only) — filters combine with AND logic
- Added `procedencia` filter for `PersonaEsclavizada`
- Added `trayectoria_lugar` multi-value lugar filter for both persona types

#### Sorting
- Extended server-side ordering to cover all browsable columns
- Direct-field sorts: `marcas_corporales`, `conducta`, `salud` (PE); `procedencia` via FK traversal (`procedencia__nombre_lugar`)
- Annotation-based sorts using `Subquery` (first M2M value): `etnonimos`, `calidades`, `hispanizacion`, `estado_civil` (PE); `calidades`, `estado_civil`, `ocupaciones` (PNE)
- Annotation-based sorts using `Exists`: `has_relaciones`, `has_lugares` (PE + PNE)
- `Count`-based sort for `documento_list` (PE + PNE)
- Date-diff sort for `documented_span` (PE)
- Annotations are applied conditionally — only when the user requests the relevant ordering field
- Replaced `_validate_ordering` with `_resolve_ordering`, which returns both the ordering expression and any required annotation dict; `ORDERING_ANNOTATIONS` and `ORDERING_FIELD_MAP` class-level configs drive the resolution

#### API
- Added `estado_civil` and physical description fields (`altura`, `cabello`, `ojos`, `marcas_corporales`, `conducta`, `salud`) to `PersonaEsclavizadaListSerializer`
- Added `estado_civil` to `PersonaNoEsclavizadaListSerializer`
- Added `procedencia` as named lugar string to `PersonaEsclavizadaListSerializer`
- Expanded `_collect_facets` to generate `estados_civiles` and `tipos_documentales` buckets

---

### Frontend (`mstdb_theme`)

#### Browse Filters
- Reorganized filter sidebar into collapsible groups with scroll: *Categorías socioétnicas*, *Trayectorias*, *Biografía*, *Documento*
- Each group shows a badge with the count of active filters
- All groups collapsed by default; Nombre search remains always visible above groups

#### Columns & Sorting
- Added `estado_civil` column ("Estado matrimonial") to both persona type tables
- Added physical description columns to PE table (hidden by default): `altura`, `cabello`, `ojos`, `marcas_corporales`, `conducta`, `salud`
- All previously non-sortable columns now have sort controls: `etnonimos`, `hispanizacion`, `calidades`, `procedencia`, `estado_civil`, `has_relaciones`, `has_lugares`, `documento_list`, `documented_span`, `marcas_corporales`, `conducta`, `salud` (PE); `ocupaciones`, `calidades`, `estado_civil`, `has_relaciones`, `has_lugares`, `documento_list` (PNE)

#### Views
- Added *Mapa de trayectorias* view to `PersonaEsclavizada` search results, visualizing geographic trajectories for the current result set

---

## [1.0.0] - 2026-03-05

### Backend (`mstdb_manager`)

#### Search
- Replaced Elasticsearch with native PostgreSQL full-text search (GIN indexes + `search_vector` fields on `Lugar`, `Documento`, `Persona`, `Corporacion`)
- Unified global search API with faceted filtering, exact phrase matching, pagination, and entity-type counts

#### API
- New V2 API with authentication and logging endpoints
- Integrated `drf-spectacular` for OpenAPI documentation; deprecated V1 docs removed
- New detail serializers with nested prefetch for `Lugar`, `Persona`, `Documento`, and `Corporacion`
- Added `calidades`, `ocupaciones`, and event fields to enslaved/non-enslaved persona and documento endpoints

#### Infrastructure & Security
- Migrated database backend from MySQL to PostgreSQL
- Dockerized with multi-stage build and `gunicorn` entrypoint
- Whitenoise for static file serving
- Hardened CSRF/session cookie settings via environment variables

---

### Frontend (`mstdb_theme`)

#### Search & Browse
- Unified search store replacing legacy `BrowseView`/`FacetSidebar` components
- Entity-type tabs, control bar, and advanced filter panel with searchable selects
- Column configuration modal per entity type

#### Detail Views
- Revamped persona detail pages (enslaved and non-enslaved): marital status, relations network, trajectory map
- Paginated related personas in documento and lugar detail views

#### New Pages & Visualizations
- Visualization pages: *Mapa de trayectorias*, *Personas por lugar*, *Red de personas*
- New *Archivos* page
- *Memorias Afromexicanas* showcase card

#### UI Polish
- Hero sections with background images across About, Archivos, and Search pages
- Quick-browse row for entity exploration
- Navigation reorganized; dropdown alignment fixes
