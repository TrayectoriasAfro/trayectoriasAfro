# TrayectoriasAfro - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Option 1: Docker (Recommended)

**Requirements**: Docker & Docker Compose installed

```bash
# 1. Setup environment
cp .env.example .env
# Edit .env with your settings (at minimum, change SECRET_KEY)

# 2. Build and start
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# 3. Initialize database
docker-compose exec web python manage.py migrate
docker-compose exec web python manage.py createsuperuser

# 4. Access the app
open http://localhost:8000
```

**Full Docker documentation**: See [DOCKER.md](DOCKER.md)

---

### Option 2: Local Development (Legacy)

**Requirements**: Python 3.11+, PostgreSQL 16+

```bash
# 1. Install system dependencies (Ubuntu/Debian)
sudo apt install postgresql-16 postgresql-contrib libpq-dev python3-dev

# 2. Setup Python environment
cd mstdb_manager
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env with your PostgreSQL connection details

# 4. Setup database
createdb trayectorias
python manage.py migrate
python manage.py createsuperuser

# 5. Build frontend
cd ../mstdb_theme
npm install
npm run build

# 6. Run development server
cd ../mstdb_manager
python manage.py runserver
```

---

## 📚 Documentation

- [DOCKER.md](DOCKER.md) - Complete Docker setup guide
- [DEPLOYMENT.md](mstdb_manager/DEPLOYMENT.md) - Production deployment
- [README.md](mstdb_manager/README.md) - Django application details
- [API Documentation](mstdb_manager/API_MIGRATION.md) - API versions and usage

## 🔄 Migrating from MySQL

If you have existing MySQL data:

```bash
# 1. Export from MySQL (while still connected)
cd mstdb_manager
./scripts/export_mysql_data.sh

# 2. Start PostgreSQL container
docker-compose up -d postgres

# 3. Import data
./scripts/import_postgres_data.sh backups/mysql_dump_TIMESTAMP.json
```

See [DOCKER.md](DOCKER.md#database-migration-mysql--postgresql) for detailed migration guide.

## 🏗️ Architecture

**Current Stack (Containerized)**:
- **Backend**: Django 5.1 + Django REST Framework
- **Frontend**: SvelteKit (served as static files)
- **Database**: PostgreSQL 16 with pg_trgm for search
- **Deployment**: Docker Compose

**Key Features**:
- Historical records tracking (simple_history)
- Polymorphic models for person types
- Full-text search with PostgreSQL
- RESTful API (v1 stable, v2 optimized)
- Bootstrap 5 + Svelte UI

## 📍 Important URLs

- **Frontend**: http://localhost:8000/
- **Admin**: http://localhost:8000/admin/
- **API v2**: http://localhost:8000/api/v2/
- **API v1**: http://localhost:8000/api/v1/ (legacy)
- **Health**: http://localhost:8000/api/v2/health/

## 🐳 Common Docker Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f web

# Access Django shell
docker-compose exec web python manage.py shell

# Access PostgreSQL
docker-compose exec postgres psql -U trayectorias_user -d trayectorias

# Stop services
docker-compose down

# Rebuild after code changes
docker-compose build web && docker-compose up -d web
```

## 🔧 Configuration

Key environment variables (`.env`):
- `SECRET_KEY` - Django secret (required)
- `DEBUG` - Debug mode (`True`/`False`)
- `DATABASE_URL` - PostgreSQL connection string
- `ALLOWED_HOSTS` - Comma-separated hostnames
- `EMAIL_HOST_PASSWORD` - SendGrid API key

See `.env.example` for all options.

## 📦 Project Structure

```
trayectoriasAfro/
├── mstdb_manager/          # Django backend
│   ├── api/                # REST API (v1 & v2)
│   ├── dbgestor/           # Core data models
│   ├── cataloguers/        # Authentication
│   ├── manage.py
│   └── requirements.txt
├── mstdb_theme/            # Svelte frontend
│   ├── src/
│   │   ├── routes/         # Pages
│   │   └── lib/            # Components
│   └── package.json
├── docker-compose.yml      # Base compose config
├── docker-compose.dev.yml  # Development overrides
├── docker-compose.prod.yml # Production overrides
├── .env                    # Environment config (create from .env.example)
└── DOCKER.md              # Docker documentation
```

## 🆘 Troubleshooting

**Container won't start?**
```bash
docker-compose logs web
```

**Database connection error?**
```bash
docker-compose ps postgres
docker-compose exec postgres pg_isready
```

**Permission errors?**
```bash
sudo chown -R $USER:$USER ./mstdb_manager ./mstdb_theme
```

**Port already in use?**
```bash
# Change port in docker-compose.yml
ports:
  - "8001:8000"  # Use 8001 instead of 8000
```

See [DOCKER.md#troubleshooting](DOCKER.md#troubleshooting) for more solutions.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with Docker: `docker-compose -f docker-compose.yml -f docker-compose.dev.yml up`
5. Submit a pull request

## 📄 License

[Add your license here]

## 🙏 Credits

**UC MRPI "Routes of Enslavement in the Americas"**

Developed for historical research on enslaved persons in colonial Mexico and the Americas.

---

**Need help?** Check [DOCKER.md](DOCKER.md) for comprehensive documentation.
