# Development plan May 2026

The purpose of this development plan is to trace the features, fixes, enhancements, and other actions that can be implemented from this month onwards.

## Features

### Ingestion panel v2

This panel will replace the one base on Django-templating forms (`mstdb_manager/dbgestor/templates/dbgestor`), including new features, a more flexible and streamlined ingestion process, and easy maintenance of forms and capture methods.

#### User Dashboard

A summary of the basic dashboard features and roles:

| feature | Staff and superadmins | colectores | reviewers | registered users |
| --- | --- | --- | --- | --- |
| See other users progress | X | | | |
| Invite new users | X | | | |
| Database summary | X | X | | |
| CRUD information (global) | X | X | | |
| Personal progress | X | X | X | |
| Set elements to public | X | X | X | |
| Send suggestions | X | X | X | |
| Edit personal information | X | X | X | X |
| Create personal collections with data available | X | X | X | X |

#### Capture forms

**Main Event Form**:

- Prototype in progress here: `mstdb_theme/src/routes/(app)/User/catalogar/+layout.svelte`

**Persona Esclavizada Form**:

Elements [TBD]

#### Relationships edit panel

**Trayectorias**:

- Prototype available at `mstdb_theme/src/routes/(app)/User/trayectoria/+page.svelte`
- Integrate with relevant forms (PersonaEsclavizada)

**PersonaRelaciones**:

- Similar to **Trayectorias**, create a visual panel where **colectores** can edit relationships by adding, removing or editing people associated with them. This can also allow to include orientation (for instance, in familial relationships, using the `persona_sujeto` as parent of son/daughter).
- Include `naturaleza_relacion` in this form as is very relevant to the project.

#### Places edit form

- This doesn't require a separate form. Just by including a button in `Detail/lugar/[id]` visible to **colectors** where they can change the coordinates of the place and include `es_parte_de` and add its type is enough.
- **place types**: Cause we're moving to a [model](#replace-controled-vocabularies-in-mstdb_managerdbgestormodelspy-with-models), include in that form the 'add new place type' avoiding duplicates.

### Merging elements

Implement a merging element feature that allows collectors to clean-up duplicate data. This involves:

- Adding a screen to select and merge possible duplicates.
- Pre-filter possible duplicates (fuzzy match + relevant elements —-e.g., shared paths in the trajectory, shared enslavers, shared people).
- Including a public user button to 'suggest merging' that allow non-collectors users to send suggestions.
- Those suggestions should be seen in the main screen of possible duplicates.
- Use case: merge all instances of Melchora de los Reyes (ids 6, 1762, 7825, 7887, 2711, and 1027)

## Enhancements

### Replace 'controled vocabularies' in `mstdb_manager/dbgestor/models.py` with models

**Depends on [Ingestion panel v2](#ingestion-panel-v2)**: Change 'controled vocabularies' currently hardcoded in `mstdb_manager/dbgestor/models.py` by models, same as with `SituacionLugar`, `TipoDocumental`, `RolEvento`, etc.

### Use instruction tooltips

- Add how to use tooltips (i) in `Detail/*` panels (*trayectoria*, *Red de Relaciones*).
- Enable all button titles as tooltips.

## Refactor

### Merge aso and tmp relationships in one

- Both categories are confusing, and `aso` is barely used. We can keep it all as `tmp`.

### Enable directionality in relationships

- Currently only `sub` relationships allow directionality. Include this in familial and `tmp` relationships as an option.

### Rename 'persona_sujeto' in `PersonaRelaciones` model

- `persona_sujeto` is understood as the 'source' not the 'target' of the relationship. Change for a more accurate term such as `persona_fuente`. This should be reflected in views, serializers, templates, etc.

## Maintenance

- **Simplify elements IDS**: Currently examples: `mx-sv-per-000000`, `mx-sv-doc-000000`. Replace for `P0`, `D0`, etc. Keep the older ids as legacy identifiers.
- **Vocabularies to lowercase**: Free text simple models, such as `Etonimos`, `Hispanizaciones`, `Calidades`, need to be transformed to lowercase. Transform new inputs in lowercase from the ingestion (in model or in the form). Merge elements with a fuzzines thresshold greater than 0.8 (this depends on [merging elements](#merging-elements) implementation).
- Revamp versions as necessary.
