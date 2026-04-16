# Metadata Dictionary

This dictionary documents all datasets in the data deposit for the project *The Circulation of Enslaved and Free Afro-descendants in New Spain*. Each section contains a description of the table's purpose and detailed documentation for each field, including the expected data type and a description.

---

## Conventions

### Stable identifiers

Records for persons, documents, and corporations use stable identifiers in the formats `mx-sv-per-XXXXXX`, `mx-sv-doc-XXXXXX`, and `mx-sv-cor-XXXXXX` respectively. Places use a numeric identifier (`lugar_id`). These identifiers serve as join keys across tables.

### Date conventions {#date-conventions}

Several date fields have accompanying `*_raw` and `*_factual` fields.

| Field | Description |
| :---- | :---- |
| `fecha_*` | Date in ISO 8601 format (`YYYY-MM-DD`). May be empty. |
| `fecha_*_raw` | Literal date text as it appears in the source document. |
| `fecha_*_factual` | `True` = date documented directly in the source. `False` or empty = estimated or inferred date. |

### Multi-value fields (M2M)

Fields that may contain more than one value (calidades, ethnonyms, occupations, etc.) are represented as text delimited by `|` (pipe) within the same cell. To join with the controlled vocabulary tables, split by `|` and look up the corresponding `cv_*.csv` file.

---

## Enslaved Persons — `personas_esclavizadas.csv`

Each row represents an enslaved person recorded in the database. The same person may appear in multiple documents; in that case the `documentos` field lists all document identifiers in which the person is mentioned.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `persona_idno` | Text | Stable person identifier (`mx-sv-per-XXXXXX`). Deposit primary key. |
| `nombres` | Text | First name(s) of the person, without honorifics, normalized. |
| `apellidos` | Text | Surname(s) of the person, normalized. May be empty. |
| `nombre_normalizado` | Text | Full normalized name (nombres + apellidos). |
| `sexo` | Text | Sex as recorded in the document. Values: `v` (Male), `m` (Female), `i` (Unknown). |
| `edad` | Integer | Age of the person at the time of the event. |
| `unidad_temporal_edad` | Text | Unit of the recorded age. Values: `d` (days), `m` (months), `a` (years). |
| `altura` | Text | Description of the person's height as stated in the document. |
| `cabello` | Text | Description of the person's hair as stated in the document. |
| `ojos` | Text | Description of the person's eyes as stated in the document. |
| `calidades` | Text `\|`\-delimited values | Socioethnic classification(s) (*calidad*) ascribed to the person. See `cv_calidades.csv`. |
| `agencia/adaptacion` | Text `\|`\-delimited values | Level(s) of agency or adaptation recorded. See `cv_agencia_adaptacion.csv`. |
| `etnonimos` | Text `\|`\-delimited values | Ethnonym(s) associated with the person. See `cv_etnonimos.csv`. |
| `procedencia_lugar_id` | Integer | Identifier of the place of African or other prior origin. Reference to `lugar_id` in `lugares.csv`. |
| `procedencia_adicional` | Text | Additional provenance information not captured by the place field (e.g., ship name or establishment). |
| `marcas_corporales` | Text | Description of body marks, brandings (*carimbos*), ritual scarifications, or other physical signs. |
| `conducta` | Text | Reports on the conduct of the enslaved person as noted in the document. |
| `salud` | Text | Temporary or permanent health condition of the enslaved person at the time of the event. May include pregnancy status. |
| `ocupaciones` | Text `\|`\-delimited values | Occupation(s) of the person. See `cv_ocupaciones.csv`. |
| `ocupacion_categoria` | Text | Occupation category (e.g., domestic service, craft, obraje). |
| `estado_matrimonial` | Text `\|`\-delimited values | Marital status of the person. See `cv_estado_matrimonial.csv`. |
| `lugar_nacimiento_id` | Integer | Identifier of the place of birth. Reference to `lugar_id` in `lugares.csv`. |
| `fecha_nacimiento` | Date (ISO 8601) | Computed date of birth. See [Date conventions](#date-conventions). |
| `fecha_nacimiento_raw` | Text | Literal birth-date text in the document. |
| `fecha_nacimiento_factual` | Boolean | `True` if the date is documented directly in the source. |
| `lugar_defuncion_id` | Integer | Identifier of the place of death. Reference to `lugar_id` in `lugares.csv`. |
| `fecha_defuncion` | Date (ISO 8601) | Computed date of death. |
| `fecha_defuncion_raw` | Text | Literal death-date text in the document. |
| `fecha_defuncion_factual` | Boolean | `True` if the date is documented directly in the source. |
| `documentos` | Text `\|`\-delimited values | Identifiers of the documents in which the person appears. Reference to `documento_idno` in `documentos.csv`. |
| `notas` | Text | Additional or clarifying notes entered by the transcriber for the event associated with the enslaved person. |

---

## Non-Enslaved Persons — `personas_no_esclavizadas.csv`

Each row represents a non-enslaved person associated with one or more documentary events. Includes buyers, sellers, witnesses, notaries, and other persons mentioned in the documents.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `persona_idno` | Text | Stable person identifier (`mx-sv-per-XXXXXX`). Deposit primary key. |
| `nombres` | Text | First name(s) of the person, without honorifics, normalized. |
| `apellidos` | Text | Surname(s) of the person, normalized. |
| `nombre_normalizado` | Text | Full normalized name. |
| `sexo` | Text | Sex as recorded. Values: `v` (Male), `m` (Female), `i` (Unknown). |
| `honorifico` | Text | Honorific associated with the person. Values: `nan` (N/A), `don` (Don), `dna` (Doña), `doc` (Doctor), `fra` (Fray). |
| `calidades` | Text `\|`\-delimited values | Socioethnic classification(s). See `cv_calidades.csv`. |
| `ocupaciones` | Text `\|`\-delimited values | Occupation(s). See `cv_ocupaciones.csv`. |
| `ocupacion_categoria` | Text | Occupation category. |
| `estado_matrimonial` | Text `\|`\-delimited values | Marital status. See `cv_estado_matrimonial.csv`. |
| `entidad_asociada` | Text | Corporation or institution the person is associated with. Reference to `corporacion_idno` in `corporaciones.csv`. |
| `lugar_nacimiento_id` | Integer | Reference to `lugar_id` in `lugares.csv`. |
| `fecha_nacimiento` | Date (ISO 8601) | See [Date conventions](#date-conventions). |
| `fecha_nacimiento_raw` | Text | Literal birth-date text in the document. |
| `fecha_nacimiento_factual` | Boolean | `True` if the date is documented directly. |
| `lugar_defuncion_id` | Integer | Reference to `lugar_id` in `lugares.csv`. |
| `fecha_defuncion` | Date (ISO 8601) |  |
| `fecha_defuncion_raw` | Text | Literal death-date text. |
| `fecha_defuncion_factual` | Boolean | `True` if the date is documented directly. |
| `documentos` | Text `\|`\-delimited values | Reference to `documento_idno` in `documentos.csv`. |
| `notas` | Text | Additional or clarifying notes entered by the transcriber for the event associated with the non-enslaved person. |

---

## Documents — `documentos.csv`

Each row represents a notarial or ecclesiastical document. Archive (physical repository) fields are incorporated directly into this table. A document may be associated with multiple persons and corporations; those relationships are found in the event role and trajectory tables.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `documento_idno` | Text | Stable document identifier (`mx-sv-doc-XXXXXX`). Deposit primary key. |
| `archivo_idno` | Text | Identifier of the archive holding the document. |
| `archivo_nombre` | Text | Full name of the archive. |
| `archivo_nombre_abreviado` | Text | Abbreviation or acronym of the archive. |
| `archivo_ubicacion_lugar_id` | Integer | Reference to the place where the archive is located. Reference to `lugar_id` in `lugares.csv`. |
| `fondo` | Text | Documentary collection (*fondo*) within the archive. |
| `subfondo` | Text | Sub-collection (*subfondo*), if applicable. |
| `serie` | Text | Documentary series, if applicable. |
| `subserie` | Text | Documentary subseries, if applicable. |
| `tipo_udc` | Text | Type of compound documentary unit. Values: `exp` (File/Expediente), `caj` (Box/Caja), `vol` (Volume/Volumen), `lib` (Book/Libro), `leg` (Bundle/Legajo). |
| `unidad_documental_compuesta` | Text | Number or identifier of the documentary unit (volume, box, file). |
| `tipo_documento` | Text | Document type (e.g., bill of sale, testament). See `cv_tipos_documentales.csv`. |
| `sigla_documento` | Text | Location code of the document within the documentary unit. |
| `titulo` | Text | Title or brief description of the document. |
| `descripcion` | Text | Summary or extended description of the document's contents. |
| `deteriorado` | Boolean | `True` if the document shows physical deterioration affecting legibility. |
| `fecha_inicial` | Date (ISO 8601) | Start date of the document. See [Date conventions](#date-conventions). |
| `fecha_inicial_raw` | Text | Literal start-date text in the document. |
| `fecha_inicial_aproximada` | Boolean | `True` if the start date is approximate. |
| `fecha_final` | Date (ISO 8601) | End date of the document (if it covers a range). |
| `fecha_final_raw` | Text | Literal end-date text. |
| `fecha_final_aproximada` | Boolean | `True` if the end date is approximate. |
| `lugar_de_produccion_id` | Integer | Place where the document was produced. Reference to `lugar_id` in `lugares.csv`. |
| `folio_inicial` | Text | First folio of the document within the documentary unit. |
| `folio_final` | Text | Last folio of the document, if available. |
| `evento_valor_sp` | Text | Value in pesos of the transaction recorded in the document, if applicable. |
| `evento_forma_de_pago` | Text |  |
| `evento_total` | Text |  |
| `notas` | Text | Additional or clarifying notes entered by the transcriber for the event associated with the document. |

---

## Places — `lugares.csv`

Each row represents a unique geographic place mentioned in the documents. The table functions as a controlled gazetteer for the project. Places are organized hierarchically: a town may be part of a province, which in turn is part of a governorate.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `lugar_id` | Integer | Unique place identifier. Table primary key. Used as a foreign reference in all other tables. |
| `nombre_lugar` | Text | Place name as used in the database (normalized form). |
| `otros_nombres` | Text | Spelling variants or alternative names for the place, separated by line breaks. |
| `tipo` | Text | Type of geographic entity. See `cv_tipos_lugar.csv`. |
| `es_parte_de_lugar_id` | Integer | `lugar_id` of the higher-level geographic entity this place belongs to (geographic hierarchy). Empty if it is the top-level entity. |
| `lat` | Decimal | Latitude in decimal degrees (WGS 84). May be empty. |
| `lon` | Decimal | Longitude in decimal degrees (WGS 84). May be empty. |

---

## Corporations — `corporaciones.csv`

Each row represents a corporation or institution (church, convent, obraje, merchant company, etc.) associated with documentary events. The category includes religious, civil, and commercial institutions alike.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `corporacion_idno` | Text | Stable corporation identifier (`mx-sv-cor-XXXXXX`). Deposit primary key. |
| `nombre_institucion` | Text | Name of the institution or corporation. |
| `nombres_alternativos` | Text | Name variants of the institution. |
| `tipo_institucion` | Text | Institution type. See `cv_tipos_institucion.csv`. |
| `lugar_corporacion_id` | Integer | Place associated with the corporation. Reference to `lugar_id` in `lugares.csv`. |
| `personas_asociadas` | Text `\|`\-delimited values | Persons associated with the corporation. Reference to `persona_idno` in `personas_esclavizadas.csv` or `personas_no_esclavizadas.csv`. |
| `documentos` | Text `\|`\-delimited values | Documents in which the corporation appears. Reference to `documento_idno` in `documentos.csv`. |
| `notas` | Text |  |

---

## Trajectories — `trayectorias.csv`

Each row represents a trajectory point of a person at a specific place, as recorded in a document. This table is the relational representation of the itineraries of enslaved and non-enslaved persons. The `ordinal` field allows reconstruction of each person's itinerary sequence. A single person may have multiple rows, ordered by `ordinal`. The `persona_x_lugares_id` field identifies groups of persons sharing the same trajectory point (e.g., persons sold together).

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `persona_idno` | Text | Person identifier. Reference to `personas_esclavizadas.csv` or `personas_no_esclavizadas.csv`. |
| `persona_x_lugares_id` | Integer | Internal trajectory-record identifier. Used to group persons sharing the same point. |
| `documento_idno` | Text | Document attesting this trajectory point. Reference to `documentos.csv`. |
| `lugar_id` | Integer | Place of the trajectory. Reference to `lugares.csv`. |
| `situacion_lugar` | Text | Person's situation relative to the place (e.g., vecino, residente, estante). See `cv_situaciones_lugar.csv`. |
| `ordinal` | Integer | Position of this point in the person's itinerary sequence. Lower values are earlier in time. |
| `fecha_inicial_lugar` | Date (ISO 8601) | Start date of the stay at the place. See [Date conventions](#date-conventions). |
| `fecha_inicial_lugar_raw` | Text | Literal start-date text in the document. |
| `fecha_inicial_lugar_factual` | Boolean | `True` if the date is documented directly. |
| `fecha_final_lugar` | Date (ISO 8601) | End date of the stay at the place. |
| `fecha_final_lugar_raw` | Text | Literal end-date text in the document. |
| `fecha_final_lugar_factual` | Boolean | `True` if the date is documented directly. |
| `notas` | Text |  |

---

## Person-to-Person Relations — `relaciones_personas.csv`

Each row represents a direct link between two persons (P1 ↔ P2). The table is in long/pairwise format: when an original relationship record involves N > 2 persons, C(N, 2) rows are generated, one per unique pair. The `persona_relacion_id` field identifies pairs originating from the same original record. This table is directly usable as an edge list for network analysis without prior transformation.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `persona_idno_1` | Text | Identifier of the first person in the pair. |
| `persona_idno_2` | Text | Identifier of the second person in the pair. |
| `persona_relacion_id` | Integer | Identifier of the original relationship record. Used to group pairs originating from the same relational event. |
| `documento_idno` | Text | Document attesting the relationship. Reference to `documentos.csv`. |
| `naturaleza_relacion` | Text | Relationship type. Values: `fam` (Family), `aso` (Associative), `tmp` (Temporal). |
| `descripcion_relacion` | Text | Free-text description of the relationship as stated in the document. |
| `fecha_inicial_relacion` | Date (ISO 8601) | See [Date conventions](#date-conventions). |
| `fecha_inicial_relacion_raw` | Text | Literal start-date text in the document. |
| `fecha_inicial_relacion_factual` | Boolean | `True` if the date is documented directly. |
| `fecha_final_relacion` | Date (ISO 8601) | Computed end date of the relationship between the persons. |
| `fecha_final_relacion_raw` | Text | Literal end-date text. |
| `fecha_final_relacion_factual` | Boolean | `True` if the date is documented directly. |
| `notas` | Text |  |

---

## Event Roles — Persons — `roles_evento_personas.csv`

Each row represents the role of a person in a specific documentary event. The same person may have different roles in different documents (e.g., buyer in one document, witness in another).

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `persona_idno` | Text | Person identifier. |
| `documento_idno` | Text | Document in which the person holds the role. |
| `rol_evento` | Text | Person's role in the event. See `cv_roles_evento.csv`. |

---

## Event Roles — Institutions — `roles_evento_instituciones.csv`

Each row represents the role of a corporation or institution in a documentary event.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `corporacion_idno` | Text | Corporation identifier. |
| `documento_idno` | Text | Document in which the corporation holds the role. |
| `rol_evento` | Text | Corporation's role in the event. See `cv_roles_evento.csv`. |

---

## Controlled Vocabularies

The following tables contain the allowed values for controlled-vocabulary fields.

### Calidades — `cv_calidades.csv`

Socioethnic classifications (*calidades*) used in the historical documentation to describe persons.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `calidad_id` | Integer | Unique identifier. |
| `calidad` | Text | *Calidad* term as normalized in the database. |
| `descripcion` | Text |  |

### Ethnonyms — `cv_etnonimos.csv`

Ascriptions to African regions, ports, or ethnic groups, or ethnonyms used in the slave trade.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `etnonimo_id` | Integer | Unique identifier. |
| `etnonimo` | Text | Ethnonym as normalized. |
| `descripcion` | Text |  |

### Agency / Adaptation — `cv_agencia_adaptacion.csv`

Categories of level of hispanicization or acculturation of enslaved persons as they appear in the documents.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `agencia_id` | Integer | Unique identifier. |
| `agencia/adaptacion` | Text | Term (e.g., Bozal, Ladino, Criollo). |
| `descripcion` | Text |  |

### Occupations — `cv_ocupaciones.csv`

Vocabulary of occupations.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `ocupacion_id` | Integer | Unique identifier. |
| `ocupacion` | Text | Occupation name. |
| `descripcion` | Text |  |

### Marital Status — `cv_estado_matrimonial.csv`

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `estado_matrimonial` | Text | Marital status (unique key). |
| `descripcion` | Text |  |

### Document Types — `cv_tipos_documentales.csv`

Types of documentary subject or event (e.g., bill of sale, letter of freedom, testament).

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `tipo_documental` | Text | Document type name. |
| `descripcion` | Text |  |

### Place Types — `cv_tipos_lugar.csv`

Types of geographic entity used in the `lugares` table. Derived from model values, not from a database table.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `tipo` | Text | Place-type code (e.g., `ciudad`, `pueblo`, `provincia`). |
| `etiqueta` | Text | Human-readable type name. |

### Place Situations — `cv_situaciones_lugar.csv`

Situations of a person relative to a place during a trajectory.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `situacion_id` | Integer | Unique identifier. |
| `situacion` | Text | Situation term (e.g., vecino, residente, estante). |
| `descripcion` | Text |  |

### Event Roles — `cv_roles_evento.csv`

Roles that persons and institutions can hold in a documentary event.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `rol_evento` | Text | Role name (e.g., comprador, vendedor, testigo, notario). |
| `descripcion` | Text |  |

### Institution Types — `cv_tipos_institucion.csv`

Types of corporation or institution.

| Property | Expected type | Description |
| :---- | :---- | :---- |
| `tipo_id` | Integer | Unique identifier. |
| `tipo` | Text | Institution type name. |
| `descripcion` | Text |  |
