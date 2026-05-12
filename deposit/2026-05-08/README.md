# Trayectorias Afro — Data Deposit

**Export date:** 2026-05-08  
**Cutoff date:** 2026-04-30 (records updated on or before this date)  
**Version:** 1.1.1  
**License:** [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)  
**Project website:** <https://www.trayectoriasafro.org>

---

## About the Project

*Trayectorias Afro: La circulación de afrodescendientes esclavizados y libres en la Nueva España* is a bilingual digital humanities database that documents the movement of enslaved and free people of African ancestry in colonial New Spain (present-day Mexico and parts of the southwestern United States), ca. 1500–1750. The project is a collaboration between historians in Mexico and the United States and is funded by the University of California Multicampus Research Programs and Initiatives and the UC-Alianza-MX Latino Studies Project Initiative.

The primary unit of record is the **individual person** — enslaved and free alike — as documented in notarial records (bills of sale, manumission letters, wills, inventories, and similar instruments) held in archives across Mexico.

---

## File Inventory

| File | Description | Rows |
|------|-------------|-----:|
| `personas_esclavizadas.csv` | Enslaved persons | 3,917 |
| `personas_no_esclavizadas.csv` | Non-enslaved persons (buyers, sellers, witnesses, etc.) | 4,957 |
| `documentos.csv` | Source documents (notarial and ecclesiastical records) | 3,339 |
| `lugares.csv` | Geographic places (gazetteer) | 339 |
| `corporaciones.csv` | Institutions and corporations (churches, convents, etc.) | 31 |
| `trayectorias.csv` | Trajectory points — person × place × document | 11,489 |
| `relaciones_personas.csv` | Person-to-person relationships | 9,701 |
| `roles_evento_personas.csv` | Roles of persons in documentary events | 6,335 |
| `roles_evento_instituciones.csv` | Roles of institutions in documentary events | 40 |
| `cv_calidades.csv` | Controlled vocabulary: socioethnic classifications | 62 |
| `cv_etnonimos.csv` | Controlled vocabulary: ethnonyms | 51 |
| `cv_agencia_adaptacion.csv` | Controlled vocabulary: agency/adaptation levels | 10 |
| `cv_estado_matrimonial.csv` | Controlled vocabulary: marital status | 7 |
| `cv_ocupaciones.csv` | Controlled vocabulary: occupations | 272 |
| `cv_roles_evento.csv` | Controlled vocabulary: event roles | 64 |
| `cv_situaciones_lugar.csv` | Controlled vocabulary: place situations | 16 |
| `cv_tipos_documentales.csv` | Controlled vocabulary: document types | 40 |
| `cv_tipos_institucion.csv` | Controlled vocabulary: institution types | 8 |
| `cv_tipos_lugar.csv` | Controlled vocabulary: place types | 15 |
| `metadata_elements.csv` | Schema reference: all files, fields, and data types | — |

Row counts reflect data through the cutoff date. A copy of this inventory with checksums is available in `MANIFEST.txt`.

---

## Schema Overview

All tables are UTF-8 encoded CSVs with a header row. Fields that can hold more than one value (calidades, ethnonyms, occupations, marital status) store them as `|`-delimited text within a single cell.

### Stable Identifiers

| Type | Format | Example |
|------|--------|---------|
| Person | `mx-sv-per-XXXXXX` | `mx-sv-per-000042` |
| Document | `mx-sv-doc-XXXXXX` | `mx-sv-doc-001138` |
| Corporation | `mx-sv-cor-XXXXXX` | `mx-sv-cor-000003` |
| Place | integer `lugar_id` | `147` |

### Table Relationships

```
documentos ─────────────────────────────────────────────────┐
    │                                                        │
    ├── roles_evento_personas   (persona_idno, rol_evento)   │
    ├── roles_evento_instituciones (corporacion_idno, rol)   │
    │                                                        │
personas_esclavizadas ──┐                                   │
personas_no_esclavizadas┤── trayectorias ── lugares          │
                        │      (lugar_id → lugares)          │
                        └── relaciones_personas              │
                               (persona_idno_1/2)            │
                                                             │
corporaciones ──────────────── lugar_corporacion_id ─────────┘
                                (→ lugares.lugar_id)
```

### Key Joins

| Goal | Join |
|------|------|
| Where a person was at each event | `trayectorias` on `persona_idno` and `documento_idno` |
| Roles of persons in a document | `roles_evento_personas` on `documento_idno` |
| Roles of institutions in a document | `roles_evento_instituciones` on `documento_idno` |
| Relationships between two persons | `relaciones_personas` on `persona_idno_1` / `persona_idno_2` |
| Archive location of a document | `documentos.archivo_ubicacion_lugar_id` → `lugares.lugar_id` |
| Calidad lookup | split `calidades` on `\|`, join to `cv_calidades.calidad` |
| Occupation lookup | split `ocupaciones` on `\|`, join to `cv_ocupaciones.ocupacion` |

---

## Metadata Dictionary

Full field-level documentation (type, description, and cross-references) is available in the repository metadata dictionaries:

- **English:** `METADATA_DICTIONARY_EN.md`
- **Spanish:** `METADATA_DICTIONARY_ES.md`
- **Machine-readable schema:** `metadata_elements.csv` (included in this deposit)

---

## Sources

Data in this deposit was extracted from notarial records held in the following Mexican archives:

1. Archivo Histórico del Estado de Aguascalientes (AHEA)
2. Archivo Histórico del Municipio de Colima (AHMC)
3. Archivo Histórico del Estado de Colima (AHEC)
4. Archivo de Instrumentos Públicos del Estado de Jalisco (AIPJ)
5. Archivo General de Notarías de la Ciudad de México, Acervo Histórico
6. Archivo General de la Nación (AGN), Fondo Jesuitas
7. Archivo Histórico de Notarías Oaxaca (AHNO)
8. Archivo Histórico del Poder Judicial del Estado de Oaxaca (AHPJEO)
9. Archivo General de Notarías del Estado de Puebla (AGNEP)
10. Archivo Notarial de Xalapa (Fondo incorporado a la USBI-Xalapa)
11. Archivos Notariales de Orizaba y Archivo Notarial de Córdova
12. Archivo Histórico del Estado de Zacatecas (AHEZ)

---
