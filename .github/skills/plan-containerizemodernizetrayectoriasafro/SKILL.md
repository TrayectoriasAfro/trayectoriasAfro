---
name: plan-containerizemodernizetrayectoriasafro
description: plan-containerizeModernizeTrayectoriasAfro
disable-model-invocation: true
---
# Plan: Containerize & Modernize TrayectoriasAfro Platform

This plan transforms your Django + Svelte applications into a fully containerized, self-contained system with PostgreSQL, migrates production data, and prepares for admin dashboard migration to Svelte. Based on your Docker Compose experience and phased approach preference, we'll tackle **containerization first** (with database migration), then the **admin dashboard recreation** second.

**Key Decisions:**
- **Database**: MySQL → PostgreSQL (better Docker support, similar Django ORM)
- **Search**: PostgreSQL full-text search + pg_trgm (fuzzy matching) for all environments
- **Auth**: Keep session-based (simpler, works well with your current flow)
- **Deployment**: Single Docker Compose setup, reproducible on any machine
- **Data**: Preserve existing production data through MySQL → PostgreSQL migration
- **No Elasticsearch**: Eliminated for simplicity; PostgreSQL handles search needs excellently at <100k rows

---

## PHASE 1: CONTAINERIZATION (Priority 1)

**TL;DR**: Create a Docker Compose setup with PostgreSQL, Django, and Svelte in a unified image. Migrate your MySQL data to PostgreSQL while preserving history and polymorphic relationships. Configure volumes for data persistence, and eliminate manual database setup. PostgreSQL's full-text search and pg_trgm extension replace Elasticsearch. (~3-5 days implementation)

### Steps

1. **Create Docker infrastructure**
   - Add `docker-compose.yml` at workspace root with services: `postgres`, `web` (Django+Svelte)
   - Add `docker-compose.dev.yml` override for development (hot-reload, debug mode)
   - Add `docker-compose.prod.yml` override for production (optimized settings)
   - Create `.dockerignore` files in both `mstdb_manager/` and `mstdb_theme/`

2. **Create Svelte production build**
   - Add Dockerfile in `mstdb_theme/` to build static assets
   - Configure SvelteKit adapter-static instead of adapter-node (serve from Django)
   - Update `vite.config.js` for base path configuration
   - Build output goes to `mstdb_theme/build/` → copied to Django static files

3. **Create Django + Svelte unified Dockerfile**
   - Multi-stage Dockerfile in `mstdb_manager/`:
     - Stage 1: Build Svelte app (Node.js base)
     - Stage 2: Python base, copy Django code + Svelte build
   - Install: Python dependencies, PostgreSQL client libraries
   - Configure `mdb/settings.py` to serve Svelte static files
   - Add health check endpoint in `api/urls.py`
   - Entrypoint script: wait-for-postgres, enable pg_trgm extension, run migrations, start Gunicorn

4. **Update Django configuration for PostgreSQL**
   - Modify `mdb/settings.py` database config:
     - Use `dj-database-url` library for DATABASE_URL parsing
     - Backend: `django.db.backends.postgresql`
     - Remove MySQL-specific settings
   - Update `requirements.txt`:
     - Remove `mysqlclient==2.2.0`
     - Remove all Elasticsearch packages (`elasticsearch`, `django-elasticsearch-dsl`, `django-elasticsearch-dsl-drf`)
     - Add `psycopg[binary]==3.1.18` and `dj-database-url==2.1.0`
   - Configure PostgreSQL search:
     - Enable `pg_trgm` and `unaccent` extensions
     - Add `django.contrib.postgres` to INSTALLED_APPS
     - Configure SearchVector fields for full-text search
     - Create GIN indexes on search fields
   - Update `dbgestor/models.py` if any MySQL-specific fields exist
   - Remove `dbgestor/documents.py` (Elasticsearch document definitions no longer needed)

5. **Implement PostgreSQL search**
   - Add migration to enable PostgreSQL extensions:
     ```sql
     CREATE EXTENSION IF NOT EXISTS pg_trgm;
     CREATE EXTENSION IF NOT EXISTS unaccent;
     ```
   - Add search fields to key models (Documento, Persona, Lugar, Corporacion):
     ```python
     from django.contrib.postgres.search import SearchVectorField
     from django.contrib.postgres.indexes import GinIndex
     
     search_vector = SearchVectorField(null=True)
     ```
   - Create GIN indexes on search fields and trigram fields
   - Replace Elasticsearch search in `api/v2/views.py`:
     - Convert `MultiMatch` ES queries to `SearchVector` + `SearchQuery`
     - Add trigram similarity searches using `TrigramSimilarity`
     - Implement ranking with `SearchRank` or trigram similarity scores
     - Maintain pagination and filtering
   - Configure search weights (title > description > notes)
   - Add database trigger or signal to auto-update search_vector fields
   - Test search quality with Spanish text and historical names

6. **Create database migration tooling**
   - Add `scripts/migrate_mysql_to_postgres.py` in `mstdb_manager/`:
     - Export MySQL data with `mysqldump`
     - Transform SQL for PostgreSQL compatibility (AUTO_INCREMENT → SERIAL, datetime formats)
     - Import to PostgreSQL via `pg_restore` or Django management command
   - Add `scripts/export_mysql_data.sh` - Export data as JSON fixtures using `dumpdata`
   - Add `scripts/import_postgres_data.sh` - Load fixtures into PostgreSQL using `loaddata`
   - Handle sequence resets for custom primary keys (`documento_id`, `persona_id`, etc.)
   - Preserve `HistoricalRecords` tables structure (same schema, different backend)

7. **Configure volumes and persistence**
   - PostgreSQL data: Named volume `postgres_data`
   - Media files: Bind mount or named volume `media_files` (uploaded archives/documents)
   - Backups: Bind mount `./backups` to `/backups` in container
   - Update `backups/msdbback.sh` for PostgreSQL (`pg_dump` instead of `mysqldump`)

8. **Environment configuration**
   - Create `.env.example` with all required variables:
     - `DATABASE_URL`, `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`
     - `EMAIL_HOST`, `EMAIL_PORT`, `SENDGRID_API_KEY`
     - `VITE_API_BASE_URL` for Svelte (optional, defaults to relative paths)
   - Add `.env` to `.gitignore`
   - Create `env.dev` and `env.prod` example files
   - Use Docker Compose `env_file` directive

9. **Update Svelte API configuration**
   - Modify `src/lib/api.js`:
     - Change base URL to relative path `/api/v2/` (served from same origin after build)
     - Remove `VITE_API_BASE_URL` dependency for production
     - Maintain CSRF token handling (works with Django sessions)
   - Update `src/config.js` if needed
   - Test CORS settings in `mdb/settings.py` (should not be needed for same-origin)

10. **Testing and validation**
   - Create `scripts/test_container.sh`:
     - Start containers with `docker-compose up`
     - Check PostgreSQL connection and extensions (pg_trgm, unaccent)
     - Verify migrations applied
     - Test API endpoints (`/api/v2/documentos/`, `/api/v2/csrf/`)
     - Test search endpoints with PostgreSQL full-text search
     - Test fuzzy search with pg_trgm
     - Verify Svelte frontend loads
     - Test autocomplete functionality (form widgets)
   - Document container commands in README:
     - `docker-compose up -d` (start)
     - `docker-compose logs -f` (logs)
     - `docker-compose exec web python manage.py shell` (Django shell)
     - `docker-compose exec postgres psql -U user -d dbname` (PostgreSQL shell)
     - `docker-compose down -v` (stop and remove volumes)

11. **Documentation**
    - Update `DEPLOYMENT.md` with Docker deployment
    - Create `DOCKER.md` with:
      - Architecture diagram (services, volumes, networks)
      - Environment variable reference
      - Development workflow (local changes, hot-reload)
      - Data migration instructions (MySQL → PostgreSQL)
      - PostgreSQL search configuration and indexing
      - Backup/restore procedures
      - Production deployment (compose prod profile)
      - Troubleshooting section
    - Update `README.md` prerequisites (remove MySQL + Elasticsearch install, add Docker)
    - Create `SEARCH.md` documenting PostgreSQL search implementation:
      - Full-text search configuration
      - Trigram fuzzy matching setup
      - Search query examples
      - Performance optimization tips

### Verification

- Run `docker-compose up` on a fresh machine with only Docker installed
- Import production MySQL dump successfully
- All 53 Django templates render correctly (forms, browse, detail pages)
- API V2 endpoints return expected data
- PostgreSQL full-text search returns relevant results
- Fuzzy search with pg_trgm handles typos correctly
- Search performance is fast (<100ms for typical queries)
- Create, update, delete operations succeed
- History tracking still functional
- Backup/restore operations work
- Run on macOS (your machine) and Linux (production server)

### Decisions

- **PostgreSQL over MySQL**: Better Docker ecosystem, similar Django support, official images
- **PostgreSQL search over Elasticsearch**: <100k rows don't justify ES complexity; pg_trgm + full-text provide excellent search with zero overhead
- **Unified container**: Simpler than separate containers; Django serves Svelte static files
- **adapter-static for Svelte**: Eliminates need for PM2/Node.js runtime in production
- **Session auth preserved**: Works seamlessly, no JWT complexity needed yet
- **dumpdata/loaddata for migration**: Safest for complex models (polymorphic, history) vs raw SQL
- **GIN indexes**: Optimal balance of insert performance and search speed for historical data

---

## PHASE 2: ADMIN DASHBOARD MIGRATION (Priority 2)

**TL;DR**: Recreate all Django templates/forms as a Svelte admin dashboard. Migrate 53 templates and 20+ forms to modern Svelte components using V2 API. Preserve autocomplete, validation, and history tracking. Django becomes API-only. (~5-10 days implementation)

### Steps

1. **Upgrade Svelte to V2 API**
   - Update `src/lib/api.js`:
     - Change all endpoints from `/api/v1/` to `/api/v2/`
     - Add new V2 endpoints (CSV export, history, relationships)
     - Handle reference-based serialization (10x smaller payloads)
   - Update existing routes in `src/routes/(app)/Detail/` to use V2 responses
   - Update `src/routes/(app)/Browse/personasesclavizadas/` to use V2

2. **Create admin routing structure**
   - Add `src/routes/(admin)/` layout with authentication guard
   - Create route structure mirroring Django templates:
     - `(admin)/add/archivo/`, `(admin)/add/documento/`, etc. (6 create forms)
     - `(admin)/browse/archivos/`, `(admin)/browse/documentos/`, etc. (6 list views)  
     - `(admin)/edit/[type]/[id]/` (generic edit route)
     - `(admin)/vocab/` (10 vocabulary management views)
     - `(admin)/relationships/` (relationship management)
   - Add admin navigation in sidebar

3. **Build form component library**
   - Create `src/lib/forms/`:
     - `FormField.svelte` - Base field wrapper with validation
     - `TextInput.svelte`, `TextArea.svelte`, `DateInput.svelte`
     - `AutocompleteField.svelte` - Replace Select2 (use `@sveltestrap/sveltestrap` or custom)
     - `CheckboxField.svelte`, `SelectField.svelte`
     - `FormErrors.svelte` - Display validation errors
   - Implement client-side validation matching Django forms
   - Add date validation (YYYY or YYYY-MM-DD formats)
   - Support "approximate date" checkbox logic

4. **Implement autocomplete system**
   - Add autocomplete API endpoints in `api/v2/views.py`:
     - `/api/v2/autocomplete/lugares/`
     - `/api/v2/autocomplete/archivos/`
     - `/api/v2/autocomplete/personas/`
     - `/api/v2/autocomplete/corporaciones/`
   - Create `src/lib/forms/AutocompleteService.js` - Debounced search client
   - Build `AutocompleteField.svelte` with dropdown, keyboard navigation
   - Support multi-select for many-to-many relationships

5. **Create entity form components**
   - `src/routes/(admin)/add/lugar/+page.svelte` - Map integration (Leaflet)
   - `src/routes/(admin)/add/archivo/+page.svelte` - Archive form
   - `src/routes/(admin)/add/documento/+page.svelte` - Complex archival metadata
   - `src/routes/(admin)/add/persona-esclavizada/+page.svelte` - Enslaved person form
   - `src/routes/(admin)/add/persona-no-esclavizada/+page.svelte` - Non-enslaved person
   - `src/routes/(admin)/add/corporacion/+page.svelte` - Institution form
   - Each form posts to V2 API create endpoints
   - Handle CSRF tokens via `getCookie()` from `src/lib/csrf.ts`

6. **Implement relationship management**
   - Create `src/routes/(admin)/relationships/persona-lugar/+page.svelte`:
     - Add/edit PersonaLugarRel (person-place relationships)
     - Ordinal sequencing UI (drag-and-drop or up/down buttons)
     - Date range inputs
     - Situation selector
   - Create `src/routes/(admin)/relationships/persona-persona/+page.svelte`:
     - PersonaRelaciones (family/associate/temporal)
     - Bi-directional relationship handling
   - Add inline relationship widgets in entity forms (add-on-the-fly)

7. **Build vocabulary management UI**
   - Create generic `VocabManager.svelte` component:
     - List view with DataTable
     - Inline editing
     - Add/delete with confirmation
     - Used for: Calidades, Hispanizaciones, Etnónimos, EstadoCivil, Ocupaciones, etc.
   - Route for each vocabulary: `(admin)/vocab/calidades/`, etc.
   - Connect to V2 API vocab endpoints

8. **Implement browse/list views**
   - Enhance existing browse views with admin actions:
     - Edit buttons → navigate to `(admin)/edit/[type]/[id]/`
     - Delete buttons → confirmation modal → API DELETE request
     - Publish/unpublish toggle (`is_published` field)
   - Add bulk actions (select multiple, bulk delete/publish)
   - Maintain DataTables integration from `src/lib/datatable.js`

9. **Add history/audit views**
   - Create `src/routes/(admin)/history/[type]/[id]/+page.svelte`:
     - Fetch from `/api/v2/{model}/{id}/history/`
     - Display change log (simple_history data)
     - Show who changed what and when
     - Link to specific historical versions
   - Add "View History" button on edit forms

10. **Authentication and permissions**
    - Add login/logout UI in Svelte (forms post to Django auth endpoints)
    - Check authentication status with `api.whoami()` from `src/lib/api.js`
    - Implement route guards in `+layout.js` for admin routes
    - Display user info in navbar
    - Handle 401/403 responses → redirect to login
    - Support Django's built-in permissions system (check `user.is_staff`, `user.has_perm()`)

11. **Remove Django templates**
    - Once Svelte admin is verified working:
      - Delete `dbgestor/templates/` folder
      - Delete `cataloguers/templates/` folder  
      - Keep base templates if needed for email templates
    - Remove template-related dependencies from `requirements.txt`:
      - `django-bootstrap5`, `django-bootstrap-input-group`
    - Remove template context processors from `mdb/settings.py`
    - Update Django URL configs to remove template-based views
    - Make Django API-only (REST framework + admin site for superuser)

12. **Testing and documentation**
    - Test each form: create, edit, delete workflows
    - Verify validation messages appear correctly
    - Test autocomplete performance (debouncing, API calls)
    - Test relationship management (adding/removing relationships)
    - Test history views
    - Update `DEVELOPERS.md` with admin dashboard architecture
    - Document form component API
    - Add screenshots to documentation

### Verification

- All 53 Django templates successfully recreated in Svelte
- All 20+ forms functional with validation
- Autocomplete works for all foreign key fields
- Relationship management preserves data integrity (ordinal sequences, dates)
- History tracking visible in admin UI
- No broken authentication flows
- Django admin still accessible for superuser emergency access
- Performance is equal or better than Django templates

### Decisions

- **V2 API migration**: Smaller payloads, better performance, CSV export built-in
- **Single admin layout**: Consistent navigation and authentication guard
- **Generic VocabManager**: DRY approach for 10+ vocabulary types
- **Keep Django admin**: Safety net for superusers during transition
- **Reuse existing components**: Extend `src/lib/datatable.js`, `src/lib/documentTree.js` where possible
- **No template engine**: Pure Svelte components, no hybrid approach

---

## SUCCESS CRITERIA

### Phase 1 Complete When:

- ✅ Run `docker-compose up` on fresh machine with zero manual setup
- ✅ Production MySQL data successfully migrated to PostgreSQL
- ✅ All existing Django templates still work (backward compatibility)
- ✅ All API endpoints return correct data
- ✅ PostgreSQL search works correctly (full-text + fuzzy matching)
- ✅ Search performance meets requirements (<100ms typical queries)
- ✅ Backups/restores work with PostgreSQL
- ✅ No Elasticsearch dependencies remain

### Phase 2 Complete When:

- ✅ All data entry forms available in Svelte admin dashboard
- ✅ No need to access Django templates for normal operations
- ✅ Django templates deleted, app is API-only + admin site
- ✅ Authentication and permissions work correctly
- ✅ Relationship management fully functional
- ✅ History tracking visible and useful
- ✅ Performance better than or equal to Django templates

---

## NOTES

This plan addresses all three of your goals systematically:

1. **Containerization**: Phase 1 gives you the containerization and portability you need. Everything runs in Docker with zero manual database setup.

2. **Unified System**: Phase 2 eliminates the dual template system. Django becomes a pure API backend, Svelte handles all UI concerns.

3. **Foundation for New Features**: With containerization and a modern admin dashboard, you'll have a solid foundation for implementing your new frontend features.

The phased approach means you can validate containerization thoroughly before tackling the admin dashboard migration, reducing risk and allowing for course corrections.

### Why PostgreSQL-Only Search?

**Eliminated Elasticsearch** based on analysis:
- Database size <100k rows (well within PostgreSQL optimization range)
- Search needs: multi-field text + fuzzy matching (both excellent with pg_trgm + full-text)
- Current ES usage: Only 5% of capabilities (no aggregations, analytics, geospatial, or complex scoring)
- Benefits of removal:
  - **Simpler architecture**: 2 services instead of 3
  - **Lower resource usage**: Save 2+ GB RAM
  - **Immediate consistency**: No reindexing delays
  - **Easier maintenance**: One backup, one database to manage
  - **Cost savings**: ~$50-100/month in production hosting
  - **Faster development**: No ES container needed locally

PostgreSQL provides excellent search quality for historical text data and Spanish names at this scale.

**When to Reconsider Elasticsearch:**
- Database grows beyond 1 million rows
- Need real-time analytics dashboards with complex aggregations
- Require advanced ML-powered relevance tuning
- Building a commercial search product with multiple tenants

### Polymorphic Models Decision

**Keeping polymorphic models** (Persona → PersonaEsclavizada/PersonaNoEsclavizada) for now:
- They work fine and aren't a performance bottleneck at current scale
- Refactoring during database migration adds complexity and risk
- Can be revisited in Phase 3 after core migration is stable
- Benefits of keeping: proven code, type safety, separate concerns
- If refactored later: ~3-5 days effort to flatten to single table with type discriminator
