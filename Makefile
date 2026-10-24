.PHONY: up down reset-db migrate test seed shell logs build-prod cleanup-uploads

up:
	docker compose up -d

down:
	docker compose down

reset-db:
	docker compose down -v

migrate:
	docker compose run --rm web python manage.py migrate

test:
	docker compose up -d db
	docker compose exec -T db dropdb -U postgres --if-exists test_propiedad_horizontal
	docker compose run --rm web pytest -q -p no:cacheprovider

seed:
	@if [ -z "$(DEMO_PASSWORD)" ]; then \
		echo "Error: debés indicar DEMO_PASSWORD (mínimo 10 caracteres). Ejemplo: make seed DEMO_PASSWORD=tu_clave_segura" >&2; \
		exit 1; \
	fi
	docker compose run --rm -e DEMO_PASSWORD="$(DEMO_PASSWORD)" web python manage.py seed_demo
	docker compose run --rm web python manage.py seed_demo_files

shell:
	docker compose run --rm web python manage.py shell

logs:
	docker compose logs -f

build-prod:
	docker build -f backend/Dockerfile -t gc-web:prod .

cleanup-uploads:
	docker compose run --rm web python manage.py cleanup_orphan_uploads
