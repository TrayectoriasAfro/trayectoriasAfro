# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
